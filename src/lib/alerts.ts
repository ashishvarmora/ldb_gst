import type { AlertKind, TrackedTruck } from "@/lib/types";

/**
 * The platform has two alerts, both built in:
 *
 *   location_update  every X minutes, say where the truck is now - even when
 *                    that is the same plaza as last time.
 *   location_change  every Y minutes, compare the current plaza with the one
 *                    the last movement alert reported, and speak up only if it
 *                    changed.
 *
 * Neither is creatable. An officer switches them on for one truck at a time
 * and picks X and Y; the admin decides whether they may use alerts at all and
 * how fast the intervals may go.
 *
 * Evaluation is a pure function of the truck row and the clock, so the worker
 * can call it on a truck it did not poll this tick - which is what lets "every
 * 15 minutes" mean 15 minutes rather than "whenever the truck next gets
 * polled". Persistence and delivery live in the worker.
 */

export const ALERT_KIND_LABEL: Record<AlertKind, string> = {
  location_update: "Location update",
  location_change: "Location changed",
};

export const ALERT_KIND_HINT: Record<AlertKind, string> = {
  location_update:
    "Sends the truck's current toll plaza on a fixed beat, whether or not it has moved. Use it when you want a heartbeat.",
  location_change:
    "Checks on a fixed beat and messages you only when the toll plaza is different from the one it last told you about.",
};

/** What the truck row has to carry for an alert decision. */
export type AlertSettings = Pick<
  TrackedTruck,
  | "location_alert_enabled"
  | "location_alert_minutes"
  | "location_alert_last_at"
  | "movement_alert_enabled"
  | "movement_alert_minutes"
  | "movement_alert_last_at"
  | "movement_alert_last_location"
>;

/** The truck's latest known position, as stored on the truck row. */
export type Position = {
  locName: string | null;
  direction: string | null;
  eventTime: string | null;
};

export type AlertDraft = {
  kind: AlertKind;
  title: string;
  message: string;
  position: Position;
};

/**
 * Columns to write back on tracked_trucks. Applied whether or not delivery
 * succeeded: the interval has to move on regardless, or a broken Telegram
 * token turns into an alert on every single sweep.
 */
export type AlertStateUpdate = Partial<{
  location_alert_last_at: string;
  movement_alert_last_at: string;
  movement_alert_last_location: string | null;
}>;

export type AlertOutcome = {
  drafts: AlertDraft[];
  stateUpdate: AlertStateUpdate;
};

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Plaza names arrive with inconsistent spacing and case ("Nadiad Toll Plaza",
 * " nadiad toll  plaza "). Compare on a normalised form so a formatting
 * difference is never mistaken for the truck having moved.
 *
 * Kept identical to the worker's own comparison, deliberately.
 */
export function normaliseLocation(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name.trim().toLowerCase().replace(/\s+/g, " ");
  return cleaned === "" ? null : cleaned;
}

/**
 * True when `minutes` have passed since `last`. A never-run alert is due
 * immediately. The 30s of slack matches the polling check: without it a
 * 15-minute alert on a 15-minute sweep drifts to 30.
 */
export function intervalElapsed(last: string | null, minutes: number, now: Date): boolean {
  if (!last) return true;
  const then = new Date(last).getTime();
  if (Number.isNaN(then)) return true;
  return now.getTime() - then >= minutes * 60_000 - 30_000;
}

/**
 * Does this truck need looking at for an alert, regardless of whether it is
 * due a poll? The sweep uses this to widen its candidate list.
 */
export function alertDue(truck: AlertSettings, now: Date): boolean {
  if (
    truck.location_alert_enabled &&
    intervalElapsed(truck.location_alert_last_at, truck.location_alert_minutes, now)
  ) {
    return true;
  }
  return (
    truck.movement_alert_enabled &&
    intervalElapsed(truck.movement_alert_last_at, truck.movement_alert_minutes, now)
  );
}

/** True when either alert is switched on for this truck. */
export function anyAlertOn(truck: AlertSettings): boolean {
  return truck.location_alert_enabled || truck.movement_alert_enabled;
}

function place(position: Position): string {
  return position.locName ?? "an unnamed plaza";
}

function heading(position: Position): string {
  return position.direction ? ` heading ${position.direction}` : "";
}

/* -------------------------------------------------------------------------- */
/* evaluation                                                                  */
/* -------------------------------------------------------------------------- */

export type EvaluateInput = {
  truckNumber: string;
  truck: AlertSettings;
  /** Latest known position, from the truck row the worker just refreshed. */
  position: Position;
  now: Date;
};

export function evaluateTruckAlerts({
  truckNumber,
  truck,
  position,
  now,
}: EvaluateInput): AlertOutcome {
  const drafts: AlertDraft[] = [];
  const stateUpdate: AlertStateUpdate = {};
  const stamp = now.toISOString();

  /* ---------------------------------------------------------------------- */
  /* 1. Location update - the heartbeat.                                     */
  /* ---------------------------------------------------------------------- */
  if (
    truck.location_alert_enabled &&
    intervalElapsed(truck.location_alert_last_at, truck.location_alert_minutes, now)
  ) {
    stateUpdate.location_alert_last_at = stamp;

    // With nowhere on record there is nothing to report. The clock still moves
    // on, so a truck that has never been seen does not retry every sweep.
    if (position.locName) {
      drafts.push({
        kind: "location_update",
        title: `${truckNumber} is at ${position.locName}`,
        message: `Current toll plaza: ${place(position)}${heading(position)}.`,
        position,
      });
    }
  }

  /* ---------------------------------------------------------------------- */
  /* 2. Location change - only when the plaza is different.                  */
  /* ---------------------------------------------------------------------- */
  if (
    truck.movement_alert_enabled &&
    intervalElapsed(truck.movement_alert_last_at, truck.movement_alert_minutes, now)
  ) {
    stateUpdate.movement_alert_last_at = stamp;

    const current = normaliseLocation(position.locName);
    const previous = normaliseLocation(truck.movement_alert_last_location);

    if (current !== null && current !== previous) {
      // No previous plaza means this is the first look, not a move. Record the
      // baseline silently - otherwise switching the alert on always fires once.
      if (previous !== null) {
        drafts.push({
          kind: "location_change",
          title: `${truckNumber} moved to ${position.locName}`,
          message: `Now at ${place(position)}${heading(position)}, previously ${truck.movement_alert_last_location}.`,
          position,
        });
      }
      stateUpdate.movement_alert_last_location = position.locName;
    }
  }

  return { drafts, stateUpdate };
}

/** One-line summary of a truck's alert settings, for lists and detail rows. */
export function describeTruckAlerts(truck: AlertSettings): string {
  const parts: string[] = [];
  if (truck.location_alert_enabled) {
    parts.push(`location every ${intervalWords(truck.location_alert_minutes)}`);
  }
  if (truck.movement_alert_enabled) {
    parts.push(`changes every ${intervalWords(truck.movement_alert_minutes)}`);
  }
  return parts.length === 0 ? "No alerts" : parts.join(" · ");
}

/** "45 min", "2 h", "1 h 30 min" - short enough for a badge. */
export function intervalWords(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
