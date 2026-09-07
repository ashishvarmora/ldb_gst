"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { needsPlaza } from "@/lib/alerts";
import { reportError } from "@/lib/errors";
import { bool, done, fail, looksLikeTruckNumber, normalizeTruck, str } from "@/lib/forms";
import { intervalLabel, toMinutes, type IntervalUnit } from "@/lib/intervals";
import { runManualLookup } from "@/lib/manual-search";
import { assertPortalUser, loadOverview, truckSlotsLeft } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ActionResult,
  AlertRuleTemplate,
  PlazaMatch,
  TrackedTruck,
} from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* shared bits of the alert forms                                              */
/* -------------------------------------------------------------------------- */

type IntervalRead =
  | { ok: true; minutes: number; clampedFrom: number | null }
  | { ok: false; error: string };

/**
 * Reads the number + minutes/hours pair the forms post, and holds it to the
 * rule's floor.
 *
 * Clamping rather than refusing: someone who asks for every 5 minutes on a
 * 15-minute rule wants "as often as possible", and being told the alert was
 * not created at all is a worse answer than being told it runs every 15.
 */
function readInterval(fd: FormData, template: AlertRuleTemplate): IntervalRead {
  const raw = str(fd, "interval_value");
  const unit: IntervalUnit = fd.get("interval_unit") === "hours" ? "hours" : "minutes";

  let requested: number | null = null;
  if (raw !== null) {
    const value = Number(raw);
    requested = Number.isInteger(value) ? toMinutes(value, unit) : null;
    if (requested === null) {
      return { ok: false, error: "Enter how often to check as a whole number of minutes or hours." };
    }
  }

  const minutes = Math.max(requested ?? template.default_interval_minutes, template.min_interval_minutes);
  return { ok: true, minutes, clampedFrom: requested !== null && minutes > requested ? requested : null };
}

/** The rule the person picked, or a reason it cannot be used. */
async function loadTemplate(templateId: string): Promise<AlertRuleTemplate | null> {
  const { data } = await getSupabaseAdmin()
    .from("alert_rule_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle<AlertRuleTemplate>();
  return data?.is_active ? data : null;
}

function alertAddedMessage(template: AlertRuleTemplate, minutes: number, clampedFrom: number | null): string {
  return clampedFrom !== null
    ? `${template.name} added. The fastest this alert may run is every ${intervalLabel(template.min_interval_minutes)}, so that is what was set.`
    : `${template.name} added, checking every ${intervalLabel(minutes)}.`;
}

/**
 * Toll plaza suggestions for the alert form, straight from what the platform
 * has recorded. Fuzzy, so a misspelling still finds the plaza - see
 * search_plazas() in migration 0010.
 */
export async function findPlazas(query: string): Promise<PlazaMatch[]> {
  await assertPortalUser();

  const q = query.trim();
  const { data, error } = await getSupabaseAdmin().rpc("search_plazas", {
    p_q: q === "" ? null : q,
    p_limit: 8,
  });

  if (error) {
    reportError("searching toll plazas", error);
    return [];
  }
  return (data ?? []) as PlazaMatch[];
}

/**
 * Adds a truck and its first alert together.
 *
 * These used to be two steps, and the gap between them was the single biggest
 * source of confusion: a truck with no alert is never checked, so people added
 * one, saw nothing happen for a day, and assumed the platform was broken. The
 * alert is part of adding a truck now, and this ends on the truck's own page
 * with that alert on screen.
 */
/* -------------------------------------------------------------------------- */
/* stopping by itself                                                          */
/* -------------------------------------------------------------------------- */

/** The longest a truck may be scheduled to run for. A year, as a typo guard. */
const MAX_AUTO_PAUSE_HOURS = 8760;

/**
 * "Stop checking in 6 hours" turned into the instant that lands on.
 *
 * A duration is what a person can answer; an instant is what the worker can
 * compare against. Converting here rather than storing the duration means the
 * clock starts when they said so, and cannot be silently restarted by an
 * unrelated edit to the same row later.
 *
 * Three answers, all of them legitimate:
 *   undefined  the form did not carry the field, so leave whatever is stored
 *   null       the officer cleared it - run until something else stops it
 *   Date       stop then
 */
function readAutoPauseAt(fd: FormData): Date | null | undefined | { error: string } {
  const amountRaw = str(fd, "auto_pause_amount");
  // A unit with no number is not an answer, and neither is the field being
  // absent. Both mean "no scheduled stop", which is a real choice to store.
  if (amountRaw === null) return fd.has("auto_pause_amount") ? null : undefined;

  const amount = Number(amountRaw);
  const unit = str(fd, "auto_pause_unit") === "days" ? "days" : "hours";
  const hours = unit === "days" ? amount * 24 : amount;

  if (!Number.isFinite(amount) || amount <= 0 || hours > MAX_AUTO_PAUSE_HOURS) {
    return {
      error:
        unit === "days"
          ? "Stop checking after how many days? Enter a number from 1 to 365, or leave it empty."
          : "Stop checking after how many hours? Enter a number from 1 to 8760, or leave it empty.",
    };
  }

  return new Date(Date.now() + hours * 3_600_000);
}

/**
 * The per-truck "pause once it has stopped moving for this long", in hours.
 *
 * Blank is null, meaning the platform setting applies - never a number copied
 * in from today's default, which would quietly opt this truck out of every
 * future change to it. Same rule as the failure budget above.
 */
function readInactiveHours(fd: FormData): number | null | { error: string } {
  const raw = str(fd, "inactive_pause_hours");
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_AUTO_PAUSE_HOURS) {
    return {
      error:
        "Pause after how many hours without movement? Enter a whole number from 1 to 8760, or leave it empty.",
    };
  }
  return parsed;
}

function isError(value: unknown): value is { error: string } {
  return typeof value === "object" && value !== null && "error" in value;
}

export async function addTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const raw = str(fd, "truck_number");
  if (!raw) return fail("Enter a truck number.");

  const truckNumber = normalizeTruck(raw);
  if (!looksLikeTruckNumber(truckNumber)) {
    return fail(`"${truckNumber}" does not look like a registration number. Example: GJ02AT8546`);
  }

  const overview = await loadOverview(session.id);
  if (!overview) return fail("Could not read your account. Sign in again.");
  if (!overview.plan_id) {
    return fail("No plan is assigned to your account yet. Ask your administrator to assign one.");
  }

  const { data: existing } = await admin
    .from("tracked_trucks")
    .select("id, is_active")
    .eq("user_id", session.id)
    .eq("truck_number", truckNumber)
    .maybeSingle();

  if (existing?.is_active) {
    return fail(`${truckNumber} is already under tracking.`);
  }

  if (truckSlotsLeft(overview) <= 0) {
    return fail(
      `Your plan allows ${overview.truck_limit} tracked truck${overview.truck_limit === 1 ? "" : "s"}. Pause or remove one first, or ask your administrator for more.`,
    );
  }

  /* The alert is settled before the truck exists, so a form with a missing
     plaza cannot leave a silent truck behind. */
  const templateId = str(fd, "template_id");
  const template = templateId ? await loadTemplate(templateId) : null;
  if (templateId && !template) return fail("That alert is no longer available. Pick another one.");

  const plaza = str(fd, "plaza");
  let minutes = 0;
  let clampedFrom: number | null = null;

  if (template) {
    if (needsPlaza(template.kind) && !plaza) {
      return fail(`"${template.name}" watches one toll plaza. Type which plaza to watch.`);
    }
    const interval = readInterval(fd, template);
    if (!interval.ok) return fail(interval.error);
    minutes = interval.minutes;
    clampedFrom = interval.clampedFrom;
  }

  /*
   * Blank means "work it out from the check interval", which is null in the
   * column - not zero, and not a number picked here. A typed value is bounded
   * to the same range the database checks, so a bad one is refused in words
   * rather than as a constraint violation.
   */
  const failuresRaw = str(fd, "max_consecutive_failures");
  let maxFailures: number | null = null;
  if (failuresRaw) {
    const parsed = Number(failuresRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      return fail("Stop after how many failures? Enter a whole number from 1 to 1000, or leave it empty.");
    }
    maxFailures = parsed;
  }

  const autoPauseAt = readAutoPauseAt(fd);
  if (isError(autoPauseAt)) return fail(autoPauseAt.error);

  const inactiveHours = readInactiveHours(fd);
  if (isError(inactiveHours)) return fail(inactiveHours.error);

  const payload = {
    user_id: session.id,
    truck_number: truckNumber,
    label: str(fd, "label"),
    is_active: true,
    max_consecutive_failures: maxFailures,
    auto_pause_at: autoPauseAt instanceof Date ? autoPauseAt.toISOString() : null,
    inactive_pause_hours: inactiveHours,
    /* Re-adding a paused truck is a fresh start: the old failure run and the
       reason it stopped must not follow it back onto the list. */
    consecutive_errors: 0,
    failure_warned_at: null,
    paused_reason: null,
    paused_at: null,
  };

  // Re-activating a paused truck keeps its history instead of duplicating it.
  const { data: saved, error } = existing
    ? await admin.from("tracked_trucks").update(payload).eq("id", existing.id).select("id").maybeSingle()
    : await admin.from("tracked_trucks").insert(payload).select("id").maybeSingle();

  if (error) return fail(reportError("adding a truck", error, "Could not add that truck."));

  const truckId = saved?.id ?? existing?.id ?? null;

  if (template && truckId) {
    const { error: alertError } = await admin.from("truck_alerts").insert({
      user_id: session.id,
      tracked_truck_id: truckId,
      template_id: template.id,
      is_enabled: true,
      interval_minutes: minutes,
      plaza: needsPlaza(template.kind) ? plaza : null,
    });

    // The truck is already saved, so a failed alert is not worth throwing the
    // whole form away for. Its page says plainly that nothing is watching it.
    if (alertError) reportError("adding the first alert", alertError);
  }

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");

  // Land on the truck itself: seeing the alert listed is the confirmation that
  // matters, and it is where a missing alert is impossible to miss.
  if (truckId) redirect(`/portal/trucks/${truckId}?added=1`);

  return done(
    template
      ? `${truckNumber} added. ${alertAddedMessage(template, minutes, clampedFrom)}`
      : `${truckNumber} added. Open it and add an alert to start checking it.`,
  );
}

export async function updateTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Missing truck id.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("is_active")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle<Pick<TrackedTruck, "is_active">>();

  if (!truck) return fail("That truck is not on your list.");

  const activating = bool(fd, "is_active");
  if (activating && !truck.is_active) {
    const overview = await loadOverview(session.id);
    if (overview && truckSlotsLeft(overview) <= 0) {
      return fail(
        `Resuming this truck would exceed your limit of ${overview.truck_limit}. Pause another one first.`,
      );
    }
  }

  /*
   * Same rule as adding: blank means "use the admin's number", which is null in
   * the column rather than a figure copied in here. Storing today's default
   * would quietly opt this truck out of every future change to it.
   */
  const failuresRaw = str(fd, "max_consecutive_failures");
  let maxFailures: number | null = null;
  if (failuresRaw) {
    const parsed = Number(failuresRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) {
      return fail("Stop after how many failures? Enter a whole number from 1 to 1000, or leave it empty.");
    }
    maxFailures = parsed;
  }

  /*
   * Switching a truck back on by hand is a fresh start, exactly as re-adding
   * one is. Without this, a truck paused at its budget would resume with the
   * counter still at the limit and be paused again by its very next failure -
   * and the officer would have no way to clear it from any screen.
   */
  const resuming = activating && !truck.is_active;

  const autoPauseAt = readAutoPauseAt(fd);
  if (isError(autoPauseAt)) return fail(autoPauseAt.error);

  const inactiveHours = readInactiveHours(fd);
  if (isError(inactiveHours)) return fail(inactiveHours.error);

  const { error } = await admin
    .from("tracked_trucks")
    .update({
      label: str(fd, "label"),
      is_active: activating,
      max_consecutive_failures: maxFailures,
      inactive_pause_hours: inactiveHours,
      /*
       * Resuming clears the deadline that stopped the truck. Without this, a
       * truck paused because its auto-pause time arrived still carries that
       * time, and the very next sweep sees a deadline already in the past and
       * stops it again - with nothing on any screen explaining why Resume
       * appeared to do nothing.
       */
      ...(resuming
        ? {
            consecutive_errors: 0,
            failure_warned_at: null,
            paused_reason: null,
            paused_at: null,
            auto_pause_at: null,
          }
        : {}),
      /*
       * The form's own answer, applied AFTER the resume clear so that resuming
       * and setting a fresh schedule in the same save keeps the schedule. The
       * order of these two spreads is the whole behaviour: the other way round,
       * an officer who switched a truck back on and asked for another six hours
       * would silently get no timer at all.
       *
       * A schedule is a countdown from when it was set, so re-saving with "6
       * hours" still in the box restarts it - which is what somebody editing a
       * truck and pressing save expects. undefined means the form never carried
       * the field, so whatever is stored is left alone.
       */
      ...(autoPauseAt === undefined
        ? {}
        : { auto_pause_at: autoPauseAt === null ? null : autoPauseAt.toISOString() }),
      ...(activating ? {} : { paused_reason: "manual" as const, paused_at: new Date().toISOString() }),
    })
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(reportError("saving a truck", error, "Could not save those changes."));

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done("Saved.");
}

/* -------------------------------------------------------------------------- */
/* alerts on one truck                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Attaches one of the admin's alert rules to a truck. Several rows may use the
 * same rule, so two plazas can be watched on the same vehicle.
 */
export async function addTruckAlert(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  const templateId = str(fd, "template_id");
  if (!truckId) return fail("Missing truck id.");
  if (!templateId) return fail("Choose an alert first.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("id")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle();

  if (!truck) return fail("That truck is not on your list.");

  const template = await loadTemplate(templateId);
  if (!template) return fail("That alert is no longer available. Pick another one.");

  const plaza = str(fd, "plaza");
  if (needsPlaza(template.kind) && !plaza) {
    return fail(`"${template.name}" watches one toll plaza. Type which plaza to watch.`);
  }

  const interval = readInterval(fd, template);
  if (!interval.ok) return fail(interval.error);

  const { error } = await admin.from("truck_alerts").insert({
    user_id: session.id,
    tracked_truck_id: truckId,
    template_id: template.id,
    is_enabled: true,
    interval_minutes: interval.minutes,
    plaza: needsPlaza(template.kind) ? plaza : null,
  });

  if (error) return fail(reportError("adding an alert", error, "Could not add that alert."));

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done(alertAddedMessage(template, interval.minutes, interval.clampedFrom));
}

export async function setTruckAlertEnabled(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const alertId = str(fd, "alert_id");
  const enabled = fd.get("is_enabled") === "true";
  if (!alertId) return fail("Missing alert id.");

  const { data: alert, error } = await admin
    .from("truck_alerts")
    .update({ is_enabled: enabled })
    .eq("id", alertId)
    .eq("user_id", session.id)
    .select("tracked_truck_id")
    .maybeSingle();

  if (error) return fail(reportError("switching an alert", error, "Could not change that alert."));
  if (!alert) return fail("That alert is not on your list.");

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${alert.tracked_truck_id}`);

  return done(enabled ? "Alert switched on." : "Alert switched off.");
}

export async function deleteTruckAlert(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const alertId = str(fd, "alert_id");
  if (!alertId) return fail("Missing alert id.");

  const { data: alert, error } = await admin
    .from("truck_alerts")
    .delete()
    .eq("id", alertId)
    .eq("user_id", session.id)
    .select("tracked_truck_id")
    .maybeSingle();

  if (error) return fail(reportError("removing an alert", error, "Could not remove that alert."));
  if (!alert) return fail("That alert is not on your list.");

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${alert.tracked_truck_id}`);

  return done("Alert removed.");
}

/* -------------------------------------------------------------------------- */
/* the truck itself                                                            */
/* -------------------------------------------------------------------------- */

export async function setTruckPaused(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  const active = fd.get("is_active") === "true";
  if (!truckId) return fail("Missing truck id.");

  if (active) {
    const overview = await loadOverview(session.id);
    if (overview && truckSlotsLeft(overview) <= 0) {
      return fail(
        `Resuming would exceed your limit of ${overview.truck_limit} tracked trucks. Pause another one first.`,
      );
    }
  }

  /*
   * This is the Pause/Resume button on the truck page - the one an officer
   * actually presses. updateTruck already cleared the failure run on resume;
   * this did not, so a truck the worker had paused at its budget came straight
   * back with the counter still at the limit and was paused again by its very
   * next failure. Both paths have to agree, because the officer cannot tell
   * which one they used.
   */
  const { error } = await admin
    .from("tracked_trucks")
    .update({
      is_active: active,
      ...(active
        ? {
            consecutive_errors: 0,
            failure_warned_at: null,
            paused_reason: null,
            paused_at: null,
            /*
             * And the schedule, for the same reason. A truck that stopped
             * because its auto-pause time arrived still has that time on the
             * row; resuming without clearing it would let the very next sweep
             * see a deadline already in the past and stop the truck again,
             * with nothing on any screen explaining why Resume did nothing.
             */
            auto_pause_at: null,
          }
        : { paused_reason: "manual" as const, paused_at: new Date().toISOString() }),
    })
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) {
    return fail(reportError("pausing a truck", error, "Could not change tracking on that truck."));
  }

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);
  /* Not "no credits are spent while paused" any more - automatic checking is
     part of the plan and costs nothing, so pausing saves no money. The slot is
     the thing the officer gets back. */
  return done(active ? "Tracking resumed." : "Tracking paused. Its slot is free for another lorry.");
}

/** A re-check asked for by hand. Spends a manual credit, same as a search. */
export async function checkTruckNow(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Missing truck id.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("truck_number")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle();

  if (!truck) return fail("That truck is not on your list.");

  const result = await runManualLookup({ userId: session.id, truckNumber: truck.truck_number });
  if (!result.ok) return fail(result.error);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done(
    result.newCount > 0
      ? `${result.newCount} new crossing${result.newCount === 1 ? "" : "s"} found.`
      : `No new crossings. The portal is showing ${result.found} recent crossing${result.found === 1 ? "" : "s"}.`,
  );
}

/**
 * Removes the truck and its alerts, and keeps the toll crossings. The history
 * is the case record; the truck row is only the instruction to keep checking.
 */
export async function removeTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Missing truck id.");

  const { error } = await admin
    .from("tracked_trucks")
    .delete()
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(reportError("removing a truck", error, "Could not remove that truck."));

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  redirect("/portal/trucks");
}
