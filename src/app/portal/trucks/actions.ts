"use server";

import type { PlazaMatchMode } from "@/lib/plaza-match";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  HALT_AFTER_MAX_HOURS,
  HALT_PAUSE_MAX_HOURS,
  HALT_PAUSE_ORDER_ERROR,
  HALT_REMINDER_MINUTES,
  alertIdentity,
  alertIdentityOf,
  hoursLabel,
  needsPlaza,
  type AlertKindMirror,
} from "@/lib/alerts";
import { reportError } from "@/lib/errors";
import { bool, done, fail, looksLikeTruckNumber, normalizeTruck, str } from "@/lib/forms";
import { intervalLabel, toMinutes, type IntervalUnit } from "@/lib/intervals";
import { runManualLookup } from "@/lib/manual-search";
import {
  assertPortalUser,
  graceDaysLeft,
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
import { recordTruckActivity } from "@/lib/truck-activity";
import type { ActionResult, AlertRuleTemplate, PausedReason, TrackedTruck } from "@/lib/types";

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
 * Owner, 20 Nov 2026: REQUIRED, with no admin default to fall back on, and a
 * value under the rule's floor is refused in words ("Choose at least 15
 * minutes.") rather than silently raised - the form shows the same message.
 */
function readInterval(fd: FormData, template: AlertRuleTemplate): IntervalRead {
  const raw = str(fd, "interval_value");
  const unit: IntervalUnit = fd.get("interval_unit") === "hours" ? "hours" : "minutes";

  if (raw === null) return { ok: false, error: "Enter how often to check." };

  const value = Number(raw);
  const requested = Number.isInteger(value) ? toMinutes(value, unit) : null;
  if (requested === null) {
    return { ok: false, error: "Enter how often to check as a whole number of minutes or hours." };
  }
  if (requested < template.min_interval_minutes) {
    return { ok: false, error: `Choose at least ${intervalLabel(template.min_interval_minutes)}.` };
  }
  return { ok: true, minutes: requested, clampedFrom: null };
}

type HaltRead =
  | { ok: true; haltAfterHours: number; pauseAfterHours: number }
  | { ok: false; error: string };

/**
 * The halt alert's two required hour fields. No defaults: both must be typed,
 * and the pause must come after the alert (the database checks the ranges,
 * this says it in words first).
 */
function readHalt(fd: FormData): HaltRead {
  const haltRaw = str(fd, "halt_after_hours");
  const pauseRaw = str(fd, "pause_after_hours");
  const halt = haltRaw === null ? Number.NaN : Number(haltRaw);
  const pause = pauseRaw === null ? Number.NaN : Number(pauseRaw);

  if (!Number.isInteger(halt) || halt < 1 || halt > HALT_AFTER_MAX_HOURS) {
    return {
      ok: false,
      error: `Alert after how many hours? Enter a whole number from 1 to ${HALT_AFTER_MAX_HOURS} hours.`,
    };
  }
  if (!Number.isInteger(pause) || pause < 1 || pause > HALT_PAUSE_MAX_HOURS) {
    return {
      ok: false,
      error: `Pause after how many hours? Enter a whole number up to ${HALT_PAUSE_MAX_HOURS} hours.`,
    };
  }
  if (pause <= halt) return { ok: false, error: HALT_PAUSE_ORDER_ERROR };
  return { ok: true, haltAfterHours: halt, pauseAfterHours: pause };
}

/**
 * The halt alert owns the truck's "pause when it stops moving" window: its
 * pause_after_hours is mirrored onto tracked_trucks.inactive_pause_hours, which
 * the existing auto-pause reads. null switches that pause off (halt alert
 * deleted or turned off).
 */
async function mirrorHaltPause(truckId: string, userId: string, hours: number | null) {
  const { error } = await getSupabaseAdmin()
    .from("tracked_trucks")
    .update({ inactive_pause_hours: hours })
    .eq("id", truckId)
    .eq("user_id", userId);
  if (error) reportError("mirroring the halt alert's pause time", error);
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

function alertAddedMessage(
  template: AlertRuleTemplate,
  minutes: number,
  clampedFrom: number | null,
  halt?: { haltAfterHours: number; pauseAfterHours: number } | null,
): string {
  if (template.kind === "halt" && halt) {
    return `${template.name} added: alert after ${hoursLabel(halt.haltAfterHours)}, pause after ${hoursLabel(halt.pauseAfterHours)}.`;
  }
  return clampedFrom !== null
    ? `${template.name} added, checking every ${intervalLabel(template.min_interval_minutes)} (the fastest this alert allows).`
    : `${template.name} added, checking every ${intervalLabel(minutes)}.`;
}

/** Reads the cadence half of an alert form: hours for a halt alert, an interval otherwise. */
type CadenceRead =
  | {
      ok: true;
      minutes: number;
      clampedFrom: number | null;
      halt: { haltAfterHours: number; pauseAfterHours: number } | null;
    }
  | { ok: false; error: string };

function readCadence(fd: FormData, template: AlertRuleTemplate): CadenceRead {
  if (template.kind === "halt") {
    const halt = readHalt(fd);
    if (!halt.ok) return halt;
    return {
      ok: true,
      minutes: HALT_REMINDER_MINUTES,
      clampedFrom: null,
      halt: { haltAfterHours: halt.haltAfterHours, pauseAfterHours: halt.pauseAfterHours },
    };
  }
  const interval = readInterval(fd, template);
  if (!interval.ok) return interval;
  return { ...interval, halt: null };
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
    ? existing.template_kind === "halt"
      ? `${name} is already on this truck. Edit that alert instead of adding another.`
      : `${name} is already on this truck, checking every ${intervalLabel(existing.interval_minutes)}. Edit that alert instead of adding another.`
    : `${name} is already on this truck but switched off. Turn it back on instead of adding another.`;
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
    return { ok: false, error: `"${template.name}" needs a toll plaza. Enter the plaza to watch.` };
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

/*
 * The per-truck "pause once it has stopped moving" window is no longer read
 * from the truck forms (owner, 20 Nov 2026). It lives in the halt alert, which
 * mirrors its pause_after_hours onto tracked_trucks.inactive_pause_hours - see
 * mirrorHaltPause(). The truck forms neither read nor write that column.
 */

/** The largest "pause after this many failed checks" a customer may set. */
const MAX_FAILURE_LIMIT = 50;

/**
 * "Pause after this many failed checks" - REQUIRED on add and edit since
 * 20 Nov 2026, with no fallback written from the admin default.
 */
function readFailureLimit(fd: FormData): number | { error: string } {
  const raw = str(fd, "max_consecutive_failures");
  const parsed = raw === null ? Number.NaN : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_FAILURE_LIMIT) {
    return {
      error: `Pause after how many failed checks? Enter a whole number from 1 to ${MAX_FAILURE_LIMIT} failed checks.`,
    };
  }
  return parsed;
}

/** An alert's cadence in words, for the activity history. */
function cadenceWords(
  template: AlertRuleTemplate,
  minutes: number,
  plaza: string | null,
  halt: { haltAfterHours: number; pauseAfterHours: number } | null,
): string {
  if (template.kind === "halt" && halt) {
    return `alert after ${hoursLabel(halt.haltAfterHours)}, pause after ${hoursLabel(halt.pauseAfterHours)}`;
  }
  return plaza ? `${plaza}, every ${intervalLabel(minutes)}` : `every ${intervalLabel(minutes)}`;
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
    return fail(`"${truckNumber}" is not a valid registration number. Example: GJ02AT8546.`);
  }

  const overview = await loadOverview(session.id);
  if (!overview) return fail("Could not load your account. Please sign in again.");
  if (!overview.plan_id) {
    return fail("Choose a plan to start tracking trucks.");
  }

  const { data: existing } = await admin
    .from("tracked_trucks")
    .select("id, is_active")
    .eq("user_id", session.id)
    .eq("truck_number", truckNumber)
    .maybeSingle();

  if (existing?.is_active) {
    return fail(`${truckNumber} is already being tracked.`);
  }

  /*
   * The balance before the slot, because it is the stronger fact. Told to
   * pause another lorry to make room, an officer with an empty wallet would do
   * it and then find the new truck refused anyway - and pausing something is
   * exactly the wrong lesson to teach at that moment. A truck added now would
   * be paused as 'no_credits' by the first sweep that reached it.
   */
  const noCredits = liveBlockedByCredits(overview, await loadAutoCheckCost(overview.plan_id));
  if (noCredits) return fail(noCredits);

  if (truckSlotsLeft(overview) <= 0) {
    return fail(
      `Your plan allows ${overview.truck_limit} tracked truck${overview.truck_limit === 1 ? "" : "s"}. Pause or remove one first, or see Plan and credits for a higher limit.`,
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
  let halt: { haltAfterHours: number; pauseAfterHours: number } | null = null;

  if (template) {
    const decided = await decidePlaza(fd, template);
    if (!decided.ok) return fail(decided.error);
    plaza = decided.plaza;
    plazaMatch = decided.match;

    const cadence = readCadence(fd, template);
    if (!cadence.ok) return fail(cadence.error);
    minutes = cadence.minutes;
    clampedFrom = cadence.clampedFrom;
    halt = cadence.halt;
  }

  /* Required, 1-50, no admin fallback written (owner, 20 Nov 2026). */
  const maxFailures = readFailureLimit(fd);
  if (isError(maxFailures)) return fail(maxFailures.error);

  const autoPauseAt = readAutoPauseAt(fd);
  if (isError(autoPauseAt)) return fail(autoPauseAt.error);

  const payload = {
    user_id: session.id,
    truck_number: truckNumber,
    label: str(fd, "label"),
    is_active: true,
    max_consecutive_failures: maxFailures,
    auto_pause_at: autoPauseAt instanceof Date ? autoPauseAt.toISOString() : null,
    /* Only a halt alert sets the stopped-moving pause; otherwise the column is
       left as it is (null on a new truck). */
    ...(halt ? { inactive_pause_hours: halt.pauseAfterHours } : {}),
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

    const haltFields = halt
      ? { halt_after_hours: halt.haltAfterHours, pause_after_hours: halt.pauseAfterHours }
      : {};

    const { error: alertError } = existingAlert
      ? await admin
          .from("truck_alerts")
          .update({ is_enabled: true, interval_minutes: minutes, ...haltFields })
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
          ...(halt ? { ...haltFields, halt_active: false, halt_notified_at: null } : {}),
        });

    // The truck is already saved, so a failed alert is not worth throwing the
    // whole form away for. Its page says plainly that nothing is watching it.
    if (alertError) reportError("adding the first alert", alertError);
  }

  if (truckId) {
    await recordTruckActivity([
      {
        userId: session.id,
        truckId,
        truckNumber,
        kind: existing ? "readded" : "added",
      },
      ...(template
        ? [
            {
              userId: session.id,
              truckId,
              truckNumber,
              kind: "alert_added" as const,
              detail: { alert: template.name, summary: cadenceWords(template, minutes, plaza, halt) },
            },
          ]
        : []),
    ]);
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
      ? `${truckNumber} added. ${alertAddedMessage(template, minutes, clampedFrom, halt)}`
      : `${truckNumber} added. Open it and add an alert to start checking it.`,
  );
}

export async function updateTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Something went wrong. Refresh the page and try again.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("id, truck_number, label, max_consecutive_failures, auto_pause_at")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle<
      Pick<TrackedTruck, "id" | "truck_number" | "label" | "max_consecutive_failures" | "auto_pause_at">
    >();

  if (!truck) return fail("That truck is not on your list.");

  /*
   * Settings only (owner, 20 Nov 2026). This form no longer carries a
   * "Tracking active" box - Go live / Pause at the top of the truck page do
   * that through setTruckPaused() - so is_active, and everything a resume
   * clears, is not touched here. Nor is inactive_pause_hours, which belongs to
   * the halt alert now.
   */
  const maxFailures = readFailureLimit(fd);
  if (isError(maxFailures)) return fail(maxFailures.error);

  const autoPauseAt = readAutoPauseAt(fd);
  if (isError(autoPauseAt)) return fail(autoPauseAt.error);

  const { error } = await admin
    .from("tracked_trucks")
    .update({
      label: str(fd, "label"),
      max_consecutive_failures: maxFailures,
      /*
       * A schedule is a countdown from when it was set, so re-saving with "6
       * hours" still in the box restarts it. undefined means the form never
       * carried the field, so whatever is stored is left alone.
       */
      ...(autoPauseAt === undefined
        ? {}
        : { auto_pause_at: autoPauseAt === null ? null : autoPauseAt.toISOString() }),
    })
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(reportError("saving a truck", error, "Could not save those changes."));

  const label = str(fd, "label");
  const changes: string[] = [];
  if ((truck.label ?? null) !== label) changes.push(label ? `label set to "${label}"` : "label removed");
  if (truck.max_consecutive_failures !== maxFailures) {
    changes.push(`pause after ${maxFailures} failed check${maxFailures === 1 ? "" : "s"}`);
  }
  if (autoPauseAt instanceof Date) changes.push("end time set");
  else if (autoPauseAt === null && truck.auto_pause_at) changes.push("end time removed");
  if (changes.length > 0) {
    await recordTruckActivity({
      userId: session.id,
      truckId,
      truckNumber: truck.truck_number,
      kind: "settings_changed",
      detail: { changes },
    });
  }

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
  if (!truckId) return fail("Something went wrong. Refresh the page and try again.");
  if (!templateId) return fail("Choose an alert first.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("id, truck_number")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle<{ id: string; truck_number: string }>();

  if (!truck) return fail("That truck is not on your list.");

  const template = await loadTemplate(templateId);
  if (!template) return fail("That alert is no longer available. Pick another one.");

  const decided = await decidePlaza(fd, template);
  if (!decided.ok) return fail(decided.error);
  const plaza = decided.plaza;
  const plazaMatch = decided.match;

  const cadence = readCadence(fd, template);
  if (!cadence.ok) return fail(cadence.error);
  const halt = cadence.halt;

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
    interval_minutes: cadence.minutes,
    plaza,
    plaza_match: plazaMatch,
    ...(halt
      ? {
          halt_after_hours: halt.haltAfterHours,
          pause_after_hours: halt.pauseAfterHours,
          halt_active: false,
          halt_notified_at: null,
        }
      : {}),
  });

  if (error) return fail(reportError("adding an alert", error, "Could not add that alert."));

  if (halt) await mirrorHaltPause(truckId, session.id, halt.pauseAfterHours);

  await recordTruckActivity({
    userId: session.id,
    truckId,
    truckNumber: truck.truck_number,
    kind: "alert_added",
    detail: { alert: template.name, summary: cadenceWords(template, cadence.minutes, plaza, halt) },
  });

  revalidatePath("/portal");
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done(alertAddedMessage(template, cadence.minutes, cadence.clampedFrom, halt));
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
  if (!alertId) return fail("Something went wrong. Refresh the page and try again.");

  const { data: alert } = await admin
    .from("truck_alerts")
    .select(
      "id, tracked_truck_id, is_enabled, plaza, template:alert_rule_templates(*), truck:tracked_trucks(truck_number)",
    )
    .eq("id", alertId)
    .eq("user_id", session.id)
    .maybeSingle<{
      id: string;
      tracked_truck_id: string;
      is_enabled: boolean;
      plaza: string | null;
      template: AlertRuleTemplate | null;
      truck: { truck_number: string } | null;
    }>();

  if (!alert?.template) return fail("That alert is not on your list.");

  const cadence = readCadence(fd, alert.template);
  if (!cadence.ok) return fail(cadence.error);
  const halt = cadence.halt;

  const { error } = await admin
    .from("truck_alerts")
    .update({
      interval_minutes: cadence.minutes,
      ...(halt
        ? { halt_after_hours: halt.haltAfterHours, pause_after_hours: halt.pauseAfterHours }
        : {}),
    })
    .eq("id", alertId)
    .eq("user_id", session.id);

  if (error) return fail(reportError("changing an alert", error, "Could not change that alert."));

  /* A switched-off halt alert keeps the truck's stopped-moving pause off. */
  if (halt && alert.is_enabled) {
    await mirrorHaltPause(alert.tracked_truck_id, session.id, halt.pauseAfterHours);
  }

  if (alert.truck) {
    await recordTruckActivity({
      userId: session.id,
      truckId: alert.tracked_truck_id,
      truckNumber: alert.truck.truck_number,
      kind: "alert_edited",
      detail: {
        alert: alert.template.name,
        summary: cadenceWords(alert.template, cadence.minutes, alert.plaza, halt),
      },
    });
  }

  revalidatePath("/portal");
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${alert.tracked_truck_id}`);

  return done(
    halt
      ? `Saved: alert after ${hoursLabel(halt.haltAfterHours)}, pause after ${hoursLabel(halt.pauseAfterHours)}.`
      : `Now checking every ${intervalLabel(cadence.minutes)}.`,
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
  if (!alertId) return fail("Something went wrong. Refresh the page and try again.");

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
    .select(
      "tracked_truck_id, template_kind, pause_after_hours, template:alert_rule_templates(name), truck:tracked_trucks(truck_number)",
    )
    .maybeSingle<{
      tracked_truck_id: string;
      template_kind: string;
      pause_after_hours: number | null;
      template: { name: string } | null;
      truck: { truck_number: string } | null;
    }>();

  if (error) return fail(reportError("switching an alert", error, "Could not change that alert."));
  if (!alert) return fail("That alert is not on your list.");

  /* The halt alert carries the truck's stopped-moving pause: off with it, and
     back to its own hours when it is switched on again. */
  if (alert.template_kind === "halt") {
    await mirrorHaltPause(
      alert.tracked_truck_id,
      session.id,
      enabled ? (alert.pause_after_hours ?? null) : null,
    );
  }

  if (alert.truck) {
    await recordTruckActivity({
      userId: session.id,
      truckId: alert.tracked_truck_id,
      truckNumber: alert.truck.truck_number,
      kind: enabled ? "alert_on" : "alert_off",
      detail: { alert: alert.template?.name ?? "Alert" },
    });
  }

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
  if (!alertId) return fail("Something went wrong. Refresh the page and try again.");

  const { data: alert, error } = await admin
    .from("truck_alerts")
    .delete()
    .eq("id", alertId)
    .eq("user_id", session.id)
    .select(
      "tracked_truck_id, template_kind, template:alert_rule_templates(name), truck:tracked_trucks(truck_number)",
    )
    .maybeSingle<{
      tracked_truck_id: string;
      template_kind: string;
      template: { name: string } | null;
      truck: { truck_number: string } | null;
    }>();

  if (error) return fail(reportError("removing an alert", error, "Could not remove that alert."));
  if (!alert) return fail("That alert is not on your list.");

  /* No halt alert, no stopped-moving pause. */
  if (alert.template_kind === "halt") {
    await mirrorHaltPause(alert.tracked_truck_id, session.id, null);
  }

  if (alert.truck) {
    await recordTruckActivity({
      userId: session.id,
      truckId: alert.tracked_truck_id,
      truckNumber: alert.truck.truck_number,
      kind: "alert_removed",
      detail: { alert: alert.template?.name ?? "Alert" },
    });
  }

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


/** Every screen that shows a truck's state, so a change is on all of them at once. */
function revalidateTruckScreens(truckId?: string) {
  revalidatePath("/portal");
  revalidatePath("/portal/dashboard");
  revalidatePath("/portal/profile");
  revalidatePath("/portal/trucks");
  if (truckId) revalidatePath(`/portal/trucks/${truckId}`);
}

/**
 * Pause a truck, or take it live again - the switch and the ⋯ menu on My
 * trucks, and the Go live / Pause buttons on the truck's own page.
 *
 * Every state is handled (verified 20 Nov 2026):
 *   live   -> pause      paused_reason 'manual', paused_at now
 *   paused -> live       any reason, including the automatic ones: clears the
 *                        reason, the failure run, a passed end time, and
 *                        restarts the no-movement window
 *   already in the asked-for state (a second tab, a double tap) -> no write,
 *                        a plain answer, and no slot or credit refusal for a
 *                        truck that is already live
 *   not this account's truck -> refused
 * Going live is refused, in words, when it would not hold: no plan, a plan
 * past its renewal period, a balance that cannot pay for one check, or no free
 * tracking slot.
 */
export async function setTruckPaused(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  const active = fd.get("is_active") === "true";
  if (!truckId) return fail("Something went wrong. Refresh the page and try again.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("id, truck_number, is_active, paused_reason")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle<{
      id: string;
      truck_number: string;
      is_active: boolean;
      paused_reason: PausedReason | null;
    }>();

  if (!truck) return fail("That truck is not on your list.");

  if (truck.is_active === active) {
    revalidateTruckScreens(truckId);
    return done(active ? `${truck.truck_number} is already live.` : `${truck.truck_number} is already paused.`);
  }

  if (active) {
    const overview = await loadOverview(session.id);
    if (!overview) return fail("Could not load your account. Please sign in again.");
    /*
     * A plan past its renewal period: the worker's candidate query filters on
     * plan_expires_on, so a truck taken live now would never be checked. Inside
     * the renewal period trucks stay live (and resume when the plan is renewed),
     * so only the lapsed state is refused.
     */
    if (!overview.plan_id) return fail("Choose a plan to start tracking trucks.");
    if (graceDaysLeft(overview) === 0) {
      return fail("Your plan has ended. Renew it on Plan and credits, then take the truck live again.");
    }
    /*
     * An empty balance: the worker asks spend_credits() before every check, so
     * a truck switched on with nothing in the wallet would be refused and
     * paused again at its next check. Topping up lifts this at once.
     */
    const noCredits = liveBlockedByCredits(overview, await loadAutoCheckCost(overview.plan_id));
    if (noCredits) return fail(noCredits);
    if (truckSlotsLeft(overview) <= 0) {
      return fail(
        `Taking this truck live would exceed your plan’s limit of ${overview.truck_limit} tracked trucks. Pause another truck first.`,
      );
    }
  }

  const now = new Date().toISOString();
  const { data: changed, error } = await admin
    .from("tracked_trucks")
    .update({
      is_active: active,
      ...(active
        ? {
            /* Both resume paths clear the failure run, the reason and a passed
               end time, and restart the no-movement window - otherwise the
               very next sweep stops the truck again. */
            consecutive_errors: 0,
            failure_warned_at: null,
            paused_reason: null,
            paused_at: null,
            auto_pause_at: null,
            tracking_started_at: now,
          }
        : { paused_reason: "manual" as const, paused_at: now }),
    })
    .eq("id", truckId)
    .eq("user_id", session.id)
    /* Guarded on the state just read, so a sweep pausing it in the same second
       keeps its own reason instead of being overwritten. */
    .eq("is_active", !active)
    .select("id")
    .maybeSingle();

  if (error) {
    return fail(reportError("pausing a truck", error, "Could not change tracking on that truck."));
  }

  if (changed) {
    await recordTruckActivity({
      userId: session.id,
      truckId,
      truckNumber: truck.truck_number,
      kind: active ? "live" : "paused",
      detail: active ? { reason: truck.paused_reason ?? "manual" } : {},
    });
  }

  revalidateTruckScreens(truckId);
  return done(
    active
      ? `${truck.truck_number} is live again.`
      : `${truck.truck_number} paused. It uses no credits until you take it live again.`,
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
  if (!truckId) return fail("Something went wrong. Refresh the page and try again.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("truck_number")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle();

  if (!truck) return fail("That truck is not on your list.");

  const result = await runManualLookup({ userId: session.id, truckNumber: truck.truck_number });
  if (!result.ok) return fail(result.error);

  await recordTruckActivity({
    userId: session.id,
    truckId,
    truckNumber: truck.truck_number,
    kind: "manual_check",
    detail: { found: result.found, newCrossings: result.newCount },
  });

  revalidateTruckScreens(truckId);

  return done(
    result.newCount > 0
      ? `${result.newCount} new crossing${result.newCount === 1 ? "" : "s"} found.`
      : `No new crossings. ${result.found} recent crossing${result.found === 1 ? "" : "s"} on record.`,
  );
}

/**
 * Deletes the truck. Exactly this, and the confirmation (deleteTruckMessage in
 * src/lib/pause.ts) says the same:
 *   deleted   the tracked_trucks row, its alerts (truck_alerts cascade), its
 *             settings; the tracking slot is freed
 *   kept      toll crossings (truck_events, tracked_truck_id set null), alerts
 *             already sent (alert_logs), charges (credit_transactions), group
 *             membership and the activity history - all keyed by the number
 * Works the same for a live or a paused truck. Lands on My trucks.
 */
export async function removeTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Something went wrong. Refresh the page and try again.");

  const { data: removed, error } = await admin
    .from("tracked_trucks")
    .delete()
    .eq("id", truckId)
    .eq("user_id", session.id)
    .select("truck_number, is_active, label")
    .maybeSingle<{ truck_number: string; is_active: boolean; label: string | null }>();

  if (error) return fail(reportError("removing a truck", error, "Could not remove that truck."));
  if (!removed) return fail("That truck is not on your list any more. Refresh the page.");

  await recordTruckActivity({
    userId: session.id,
    truckId: null,
    truckNumber: removed.truck_number,
    kind: "deleted",
    detail: { wasLive: removed.is_active, ...(removed.label ? { summary: removed.label } : {}) },
  });

  revalidateTruckScreens();
  revalidatePath("/portal/activity");
  redirect("/portal/trucks");
}
