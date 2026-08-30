import type { AlertRuleKind, TruckAlert, TruckAlertWithTemplate } from "@/lib/types";

/**
 * Alert evaluation.
 *
 * The admin keeps a catalogue of rules; an officer attaches as many as they
 * like to a truck and sets each one's interval. Three kinds exist:
 *
 *   periodic_location  every N minutes, report where the truck is - even when
 *                      that is the same plaza as last time.
 *   location_change    every N minutes, report only if the plaza differs from
 *                      the one this alert last reported.
 *   plaza_crossing     every N minutes, report only if the truck is at one
 *                      named toll plaza.
 *
 * Deliberately a pure function of the alert row, the truck's position and the
 * clock. The worker owns fetching, delivery and persistence.
 */

export const ALERT_KIND_LABEL: Record<AlertRuleKind, string> = {
  periodic_location: "Location update",
  location_change: "Location changed",
  plaza_crossing: "Reached a toll plaza",
};

export const ALERT_KIND_HINT: Record<AlertRuleKind, string> = {
  periodic_location:
    "Sends the truck's current toll plaza on a fixed beat, whether or not it has moved.",
  location_change:
    "Checks on a fixed beat and messages you only when the toll plaza is different from the one it last reported.",
  plaza_crossing:
    "Watches one toll plaza you name and messages you the moment the truck is recorded there.",
};

/** Only this kind needs a plaza chosen, so only this kind shows the dropdown. */
export function needsPlaza(kind: AlertRuleKind): boolean {
  return kind === "plaza_crossing";
}

/** The truck's latest known position. */
export type Position = {
  locName: string | null;
  direction: string | null;
  eventTime: string | null;
};

export type AlertDraft = {
  alertId: string;
  kind: AlertRuleKind;
  title: string;
  message: string;
  position: Position;
};

/**
 * What to write back on the alert row. Applied whether or not delivery
 * succeeded: if a failed send left the clock alone, one bad chat id would
 * produce an alert on every sweep for ever.
 */
export type AlertStateUpdate = {
  last_run_at: string;
  last_location?: string | null;
};

export type AlertOutcome = { draft: AlertDraft | null; stateUpdate: AlertStateUpdate };

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Plaza names arrive with inconsistent spacing and case ("Nadiad Toll Plaza",
 * " nadiad toll  plaza "). Compare on a normalised form so a formatting
 * difference is never mistaken for the truck having moved.
 */
export function normaliseLocation(name: string | null | undefined): string | null {
  if (!name) return null;
  const cleaned = name.trim().toLowerCase().replace(/\s+/g, " ");
  return cleaned === "" ? null : cleaned;
}

/**
 * True when `minutes` have passed since `last`. A never-run alert is due
 * immediately. The 30s of slack stops a 15-minute alert on a 15-minute sweep
 * drifting out to 30.
 */
export function intervalElapsed(last: string | null, minutes: number, now: Date): boolean {
  if (!last) return true;
  const then = new Date(last).getTime();
  if (Number.isNaN(then)) return true;
  return now.getTime() - then >= minutes * 60_000 - 30_000;
}

/** Is this alert ready to be evaluated? */
export function alertDue(alert: Pick<TruckAlert, "is_enabled" | "interval_minutes" | "last_run_at">, now: Date): boolean {
  return alert.is_enabled && intervalElapsed(alert.last_run_at, alert.interval_minutes, now);
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

export function evaluateAlert({
  truckNumber,
  alert,
  position,
  now,
}: {
  truckNumber: string;
  alert: TruckAlertWithTemplate;
  position: Position;
  now: Date;
}): AlertOutcome {
  const stamp = now.toISOString();
  const stateUpdate: AlertStateUpdate = { last_run_at: stamp };
  const current = normaliseLocation(position.locName);

  switch (alert.template.kind) {
    /* -------------------------------------------------------------------- */
    case "periodic_location": {
      // Nowhere on record means nothing to report. The clock still moves, so a
      // truck that has never been seen does not retry on every sweep.
      if (!position.locName) return { draft: null, stateUpdate };

      return {
        draft: {
          alertId: alert.id,
          kind: "periodic_location",
          title: `${truckNumber} is at ${position.locName}`,
          message: `Current toll plaza: ${place(position)}${heading(position)}.`,
          position,
        },
        stateUpdate,
      };
    }

    /* -------------------------------------------------------------------- */
    case "location_change": {
      const previous = normaliseLocation(alert.last_location);
      if (current === null || current === previous) return { draft: null, stateUpdate };

      // No previous plaza means this is the first look, not a move. Record the
      // baseline quietly - otherwise switching the alert on always fires once.
      stateUpdate.last_location = position.locName;
      if (previous === null) return { draft: null, stateUpdate };

      return {
        draft: {
          alertId: alert.id,
          kind: "location_change",
          title: `${truckNumber} moved to ${position.locName}`,
          message: `Now at ${place(position)}${heading(position)}, previously ${alert.last_location}.`,
          position,
        },
        stateUpdate,
      };
    }

    /* -------------------------------------------------------------------- */
    case "plaza_crossing": {
      const watched = normaliseLocation(alert.plaza);
      if (!watched || current === null) return { draft: null, stateUpdate };

      // A truck sitting at the watched plaza would otherwise be reported on
      // every interval. last_location remembers what was already announced, so
      // it is announced once per arrival.
      const announced = normaliseLocation(alert.last_location);
      stateUpdate.last_location = position.locName;

      if (current !== watched || announced === watched) return { draft: null, stateUpdate };

      return {
        draft: {
          alertId: alert.id,
          kind: "plaza_crossing",
          title: `${truckNumber} reached ${alert.plaza}`,
          message: `Recorded at ${place(position)}${heading(position)}.`,
          position,
        },
        stateUpdate,
      };
    }

    /* -------------------------------------------------------------------- */
    default:
      return { draft: null, stateUpdate };
  }
}

/** One line describing an alert in a list: "Location changed · every 30 min". */
export function describeAlert(alert: TruckAlertWithTemplate): string {
  const parts = [alert.template.name, `every ${intervalWords(alert.interval_minutes)}`];
  if (alert.plaza) parts.push(alert.plaza);
  return parts.join(" · ");
}

/** "45 min", "2 h", "1 h 30 min" - short enough for a badge. */
export function intervalWords(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "--";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
