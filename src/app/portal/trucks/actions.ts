"use server";

import type { PlazaMatchMode } from "@/lib/plaza-match";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { alertIdentity, alertIdentityOf, needsPlaza, type AlertKindMirror } from "@/lib/alerts";
import { reportError } from "@/lib/errors";
import { bool, done, fail, looksLikeTruckNumber, normalizeTruck, str } from "@/lib/forms";
import { intervalLabel, toMinutes, type IntervalUnit } from "@/lib/intervals";
import { runManualLookup } from "@/lib/manual-search";
import {
  assertPortalUser,
  liveBlockedByCredits,
  loadAutoCheckCost,
  loadOverview,
  truckSlotsLeft,
} from "@/lib/officer";
import {
  NO_MATCHES,
  NO_POSITION,
  PLAZA_LIST_LIMIT,
  PLAZA_UNLISTED_FIELD,
  didYouMean,
  unlistedPlazaError,
  type AheadBasis,
  type PlazaLookup,
  type PlazaSuggestion,
  type PlazasAhead,
} from "@/lib/plazas";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, AlertRuleTemplate, TrackedTruck } from "@/lib/types";

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

/* -------------------------------------------------------------------------- */
/* one alert of each kind per truck                                            */
/* -------------------------------------------------------------------------- */

/**
 * An alert already on the truck, as much of it as the uniqueness rule needs.
 *
 * template_kind is the mirror migration 0048 keeps on the row - see
 * alertIdentity() in src/lib/alerts.ts, which is the same expression as the
 * index that actually refuses the duplicate.
 */
type ExistingAlert = AlertKindMirror & {
  id: string;
  is_enabled: boolean;
  interval_minutes: number;
  plaza: string | null;
  template: { name: string } | null;
};

/** Every alert on one truck, for deciding what may still be added to it. */
async function loadTruckAlerts(truckId: string, userId: string): Promise<ExistingAlert[]> {
  const { data } = await getSupabaseAdmin()
    .from("truck_alerts")
    .select("id, is_enabled, interval_minutes, plaza, template_kind, template:alert_rule_templates(name)")
    .eq("tracked_truck_id", truckId)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  return (data ?? []) as unknown as ExistingAlert[];
}

/**
 * The alert on this truck that asks the same question, if there is one.
 *
 * A switched-on row wins over a switched-off one, because it is the one the
 * database will refuse a duplicate of and the one whose interval is worth
 * pointing at.
 */
function sameQuestion(alerts: ExistingAlert[], identity: string): ExistingAlert | null {
  const matches = alerts.filter((alert) => alertIdentityOf(alert) === identity);
  return matches.find((alert) => alert.is_enabled) ?? matches[0] ?? null;
}

/**
 * Why a second copy is refused, and where to go instead.
 *
 * Never "that already exists": the officer wanted a different interval, and the
 * answer is that the interval is a property of the alert they already have. The
 * truck's own page carries a Change how often fold on every row.
 */
function alreadyWatchedMessage(existing: ExistingAlert, name: string): string {
  return existing.is_enabled
    ? `You already watch this: ${name}, every ${intervalLabel(existing.interval_minutes)}. Change how often on that alert instead of adding a second one.`
    : `${name} is already on this truck, switched off. Turn it back on instead of adding a second one.`;
}

/* -------------------------------------------------------------------------- */
/* which toll plaza                                                            */
/* -------------------------------------------------------------------------- */

/**
 * A typed plaza name, matched fuzzily - and, separately, whether it is a name
 * an alert could ever fire on.
 *
 * Both come from match_plazas() in migration 0051 in one round trip, because
 * the form asks on every keystroke and the second answer is the one it gates
 * the submit on. Replaces search_plazas() from 0010, which compared the whole
 * name including the "Toll Plaza" that two thirds of the catalogue shares:
 * that scored 'qqqqq plaza' at 0.38 against eight real plazas and missed
 * 'waashi' for Vashi Toll Plaza altogether. See section 4 of the migration for
 * the measurements.
 */
export async function findPlazas(query: string): Promise<PlazaLookup> {
  await assertPortalUser();

  const { data, error } = await getSupabaseAdmin().rpc("match_plazas", {
    p_q: query,
    p_limit: PLAZA_LIST_LIMIT,
  });

  if (error) {
    reportError("searching toll plazas", error);
    return NO_MATCHES;
  }
  return readLookup(data);
}

/** The RPC envelope, which arrives as loose jsonb. */
function readLookup(data: unknown): PlazaLookup {
  const row = (data ?? {}) as {
    query?: string | null;
    exact?: string | null;
    matches?: PlazaSuggestion[] | null;
  };
  return {
    query: row.query ?? null,
    exact: row.exact ?? null,
    matches: (row.matches ?? []).map((match) => ({
      name: match.name,
      seen_count: match.seen_count,
      km: null,
      score: match.score,
    })),
  };
}

/**
 * The toll plazas one lorry is pointed at.
 *
 * Asked once when the picker appears rather than on every keystroke: the
 * truck's position does not change while somebody types, and the plaza box is
 * only shown for the one rule that names a plaza - so a truck page nobody adds
 * a plaza alert on never runs this at all.
 *
 * Everything about what "ahead" means, and what it degrades to when the data
 * will not support it, is in plazas_ahead() in migration 0051 and in
 * src/lib/plazas.ts. Nothing is inferred here.
 */
export async function plazasAhead(truckId: string): Promise<PlazasAhead> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  /* The truck has to be theirs before its crossings are read - the id arrives
     from a form field, and truck_events is per account. */
  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("truck_number")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle<{ truck_number: string }>();

  if (!truck) return NO_POSITION;

  const { data, error } = await admin.rpc("plazas_ahead", {
    p_user: session.id,
    p_truck: truck.truck_number,
    p_limit: PLAZA_LIST_LIMIT,
  });

  if (error) {
    reportError("looking up what is ahead of the truck", error);
    return NO_POSITION;
  }

  const row = (data ?? {}) as {
    basis?: AheadBasis;
    at?: string | null;
    heading?: string | null;
    heading_from?: PlazasAhead["headingFrom"];
    plazas?: PlazaSuggestion[] | null;
  };

  return {
    basis: row.basis ?? "none",
    at: row.at ?? null,
    heading: row.heading ?? null,
    headingFrom: row.heading_from ?? null,
    plazas: (row.plazas ?? []).map((plaza) => ({
      name: plaza.name,
      seen_count: plaza.seen_count,
      km: plaza.km,
      score: null,
    })),
  };
}

/**
 * Either the plaza to store, or the reason this alert is not being created.
 *
 * `match` travels with the name because only this function knows how the name
 * was arrived at, and that is what decides how a crossing is later compared to
 * it: a catalogue pick is matched on the name, a typed one is also matched on
 * similarity. Recovering it afterwards would mean asking the catalogue a second
 * time and getting a different answer once somebody's lorry has been through
 * the plaza. See src/lib/plaza-match.ts.
 */
type PlazaDecision =
  | { ok: true; plaza: string | null; match: PlazaMatchMode | null }
  | { ok: false; error: string };

/**
 * What goes in truck_alerts.plaza, and the one case where nothing does.
 *
 * Two jobs, and the first is the quiet one:
 *
 * 1. CANONICALISE. What gets stored is the CATALOGUE's spelling, not the
 *    officer's. The worker compares case- and space-insensitively, so
 *    "bhatia toll plaza" would have matched anyway - but the stored value is
 *    what the alert message quotes back ("GJ02ZZ8799 reached ..."), what the
 *    truck page prints, and what the duplicate warning names. Storing the
 *    officer's own lower-case typing means the platform reads their typo back
 *    to them for the life of the alert.
 *
 * 2. REFUSE A NAME NOTHING WILL EVER MATCH, unless they say otherwise. See
 *    unlistedPlazaError() in src/lib/plazas.ts for why this is a refusal and
 *    why it is not absolute. The form shows the same words and posts the
 *    confirmation; this is what makes a stale form, a second tab or a direct
 *    call to this action get the same answer.
 */
async function decidePlaza(fd: FormData, template: AlertRuleTemplate): Promise<PlazaDecision> {
  if (!needsPlaza(template.kind)) return { ok: true, plaza: null, match: null };

  const typed = str(fd, "plaza");
  if (!typed) {
    return { ok: false, error: `"${template.name}" watches one toll plaza. Type which plaza to watch.` };
  }

  const { data, error } = await getSupabaseAdmin().rpc("match_plazas", {
    p_q: typed,
    p_limit: 1,
  });

  /*
   * Fails open. If the catalogue cannot be read, the choice is between
   * refusing an alert on a plaza that is probably fine and accepting one that
   * might be misspelt - and the second is recoverable by the officer while the
   * first is just the platform being broken at them.
   */
  if (error) {
    reportError("checking the toll plaza name", error);
    /* "fuzzy", because the catalogue is exactly what could not be read: there
       is no evidence this name is in it, and the looser comparison is the one
       that still fires if it is not. */
    return { ok: true, plaza: typed, match: "fuzzy" };
  }

  const lookup = readLookup(data);
  if (lookup.exact) return { ok: true, plaza: lookup.exact, match: "exact" };
  if (bool(fd, PLAZA_UNLISTED_FIELD)) return { ok: true, plaza: typed, match: "fuzzy" };

  return { ok: false, error: unlistedPlazaError(typed, didYouMean(lookup)) };
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

  /*
   * The balance before the slot, because it is the stronger fact. Told to
   * pause another lorry to make room, an officer with an empty wallet would do
   * it and then find the new truck refused anyway - and pausing something is
   * exactly the wrong lesson to teach at that moment. A truck added now would
   * be paused as 'no_credits' by the first sweep that reached it.
   */
  const noCredits = liveBlockedByCredits(overview, await loadAutoCheckCost());
  if (noCredits) return fail(noCredits);

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

  let plaza: string | null = null;
  let plazaMatch: PlazaMatchMode | null = null;
  let minutes = 0;
  let clampedFrom: number | null = null;

  if (template) {
    const decided = await decidePlaza(fd, template);
    if (!decided.ok) return fail(decided.error);
    plaza = decided.plaza;
    plazaMatch = decided.match;

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
    /* The no-movement window counts from here, so going live has to reset it.
       Without this a lorry that was already parked would pause on its first
       sweep - see dueForAutoPause in pause.ts. */
    tracking_started_at: new Date().toISOString(),
  };

  // Re-activating a paused truck keeps its history instead of duplicating it.
  const { data: saved, error } = existing
    ? await admin.from("tracked_trucks").update(payload).eq("id", existing.id).select("id").maybeSingle()
    : await admin.from("tracked_trucks").insert(payload).select("id").maybeSingle();

  if (error) return fail(reportError("adding a truck", error, "Could not add that truck."));

  const truckId = saved?.id ?? existing?.id ?? null;

  if (template && truckId) {
    /*
     * Re-adding a paused truck keeps its alerts, so the "first" alert may not
     * be new at all - and a second row of one kind is refused by the database
     * since 0048. So the same question is UPDATED rather than inserted: the
     * officer just told this form how often to check, and that answer is the
     * one they meant. The row keeps its id and its bookkeeping, so nothing
     * re-announces a crossing it has already reported.
     *
     * Only looked up for a truck that already existed. A genuinely new one
     * cannot have an alert yet, and this is the hot path.
     */
    /* `plaza` is already null for the kinds that do not name one -
       decidePlaza() is what nulls it, so needsPlaza() is not asked twice. */
    const existingAlert = existing
      ? sameQuestion(await loadTruckAlerts(truckId, session.id), alertIdentity(template.kind, plaza))
      : null;

    const { error: alertError } = existingAlert
      ? await admin
          .from("truck_alerts")
          .update({ is_enabled: true, interval_minutes: minutes })
          .eq("id", existingAlert.id)
          .eq("user_id", session.id)
      : await admin.from("truck_alerts").insert({
          user_id: session.id,
          tracked_truck_id: truckId,
          template_id: template.id,
          is_enabled: true,
          interval_minutes: minutes,
          plaza,
          plaza_match: plazaMatch,
        });

    // The truck is already saved, so a failed alert is not worth throwing the
    // whole form away for. Its page says plainly that nothing is watching it.
    if (alertError) reportError("adding the first alert", alertError);
  }

  revalidatePath("/portal");
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
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
    /* Refused here as well as on the Pause/Resume button, because both save a
       truck live and the officer cannot tell which one they used - the same
       argument that put the failure-counter clear in both. */
    if (overview) {
      const noCredits = liveBlockedByCredits(overview, await loadAutoCheckCost());
      if (noCredits) return fail(noCredits);
    }
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
            /* Going live restarts the no-movement window. */
            tracking_started_at: new Date().toISOString(),
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
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done("Saved.");
}

/* -------------------------------------------------------------------------- */
/* alerts on one truck                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Attaches one of the admin's alert rules to a truck.
 *
 * At most one alert of each kind per truck, because two alerts of one kind are
 * one question polled on the union of both beats and charged for every check -
 * the owner's "single alert can be use only once". The exception is
 * plaza_crossing, which names the plaza it watches, so two plazas on one lorry
 * are two questions and both are allowed.
 *
 * The refusal here is advice that the database backs: migration 0048 carries a
 * partial unique index, so a stale form, a second tab or anything reaching this
 * action directly is refused by the row itself. This exists so the answer is a
 * sentence with somewhere to go rather than a constraint violation - and it is
 * stricter on purpose, refusing a second row of a kind even when the first is
 * switched off, because two rows of one kind in the list is confusing whatever
 * their state.
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

  const decided = await decidePlaza(fd, template);
  if (!decided.ok) return fail(decided.error);
  const plaza = decided.plaza;
  const plazaMatch = decided.match;

  const interval = readInterval(fd, template);
  if (!interval.ok) return fail(interval.error);

  /* The identity is computed from the CANONICAL plaza, which is what will be
     stored - so the duplicate this refuses is the duplicate the index would.
     It makes no difference to the comparison, since alertIdentity() normalises
     both sides, and every difference to what the refusal then quotes back. */
  const wanted = alertIdentity(template.kind, plaza);
  const existing = sameQuestion(await loadTruckAlerts(truckId, session.id), wanted);
  if (existing) {
    return fail(alreadyWatchedMessage(existing, existing.template?.name ?? template.name));
  }

  const { error } = await admin.from("truck_alerts").insert({
    user_id: session.id,
    tracked_truck_id: truckId,
    template_id: template.id,
    is_enabled: true,
    interval_minutes: interval.minutes,
    plaza,
    plaza_match: plazaMatch,
  });

  if (error) return fail(reportError("adding an alert", error, "Could not add that alert."));

  revalidatePath("/portal");
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done(alertAddedMessage(template, interval.minutes, interval.clampedFrom));
}

/**
 * Changes how often one alert already on a truck checks.
 *
 * The other half of the one-of-each-kind rule: refusing a second "Location
 * changed" is only reasonable if the interval on the first one can be changed,
 * and until now the only way was to delete the alert and add it again - which
 * threw away the bookkeeping that stops the new one re-reporting an old
 * crossing.
 *
 * Interval only. The kind and the plaza are what make an alert unique, so
 * changing either is a different question and belongs in a new alert.
 */
export async function updateTruckAlert(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const alertId = str(fd, "alert_id");
  if (!alertId) return fail("Missing alert id.");

  const { data: alert } = await admin
    .from("truck_alerts")
    .select("id, tracked_truck_id, template:alert_rule_templates(*)")
    .eq("id", alertId)
    .eq("user_id", session.id)
    .maybeSingle<{ id: string; tracked_truck_id: string; template: AlertRuleTemplate | null }>();

  if (!alert?.template) return fail("That alert is not on your list.");

  const interval = readInterval(fd, alert.template);
  if (!interval.ok) return fail(interval.error);

  const { error } = await admin
    .from("truck_alerts")
    .update({ interval_minutes: interval.minutes })
    .eq("id", alertId)
    .eq("user_id", session.id);

  if (error) return fail(reportError("changing an alert", error, "Could not change that alert."));

  revalidatePath("/portal");
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${alert.tracked_truck_id}`);

  return done(
    interval.clampedFrom !== null
      ? `This alert may run every ${intervalLabel(alert.template.min_interval_minutes)} at the fastest, so that is what was set.`
      : `Now checking every ${intervalLabel(interval.minutes)}.`,
  );
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

  /*
   * Switching one back on can collide with a live alert asking the same
   * question - a truck may keep a switched-off copy from before 0048, and the
   * index only constrains the enabled ones. Answered here in words: the raw
   * refusal would be "duplicate key value violates unique constraint", on a
   * button press whose only visible effect is a switch that did not move.
   */
  if (enabled) {
    const { data: target } = await admin
      .from("truck_alerts")
      .select("tracked_truck_id, plaza, template_kind")
      .eq("id", alertId)
      .eq("user_id", session.id)
      .maybeSingle<{ tracked_truck_id: string; plaza: string | null } & AlertKindMirror>();

    if (target) {
      const rival = sameQuestion(
        (await loadTruckAlerts(target.tracked_truck_id, session.id)).filter(
          (row) => row.id !== alertId && row.is_enabled,
        ),
        alertIdentityOf(target),
      );
      if (rival) {
        return fail(
          `Another ${rival.template?.name ?? "alert"} on this truck is already switched on, checking every ${intervalLabel(rival.interval_minutes)}. Turn that one off first, or remove this one.`,
        );
      }
    }
  }

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
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
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
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
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
    /*
     * WHY THE SWITCH REFUSES INSTEAD OF MOVING
     *
     * PAUSE_COPY marks 'no_credits' not resumable, which takes the switch off
     * the card and puts "Open to fix" there instead - but the truck's own page
     * still carries a Go live button, and this action is reachable from any
     * form. Without this test the button would work, the row would say live,
     * and the next sweep would refuse the check and pause the truck again. A
     * switch that undoes itself a quarter of an hour later is the thing this
     * whole feature exists to stop, so the honest answer is now, in words.
     *
     * Topping up lifts it with no further step: the moment the balance covers
     * one check this returns null and Go live works again.
     */
    if (overview) {
      const noCredits = liveBlockedByCredits(overview, await loadAutoCheckCost());
      if (noCredits) return fail(noCredits);
    }
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
            /* And the no-movement window, which counts from here. A lorry
               resumed after standing still for a day must not pause again on
               the very next sweep for the standing still it did while off. */
            tracking_started_at: new Date().toISOString(),
          }
        : { paused_reason: "manual" as const, paused_at: new Date().toISOString() }),
    })
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) {
    return fail(reportError("pausing a truck", error, "Could not change tracking on that truck."));
  }

  revalidatePath("/portal");
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);
  /* The saving is the point, so the confirmation says it. An automatic check
     costs a credit and the beat is fifteen minutes, so this one tap is worth
     about 96 credits a day - and "Tracking paused." on its own gave the officer
     no reason to do it to the other nine parked lorries on the list. */
  return done(
    active
      ? "This truck is live again."
      : "Tracking paused. It spends no credits until you take it live again.",
  );
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
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
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
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
  revalidatePath("/portal/trucks");
  redirect("/portal/trucks");
}
