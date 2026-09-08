import { matchPlaza, DEFAULT_PLAZA_MATCH_THRESHOLD } from "@/lib/plaza-match";
import { intervalLabel, intervalShort } from "@/lib/intervals";
import type { AlertRuleKind, TruckAlert, TruckAlertWithTemplate } from "@/lib/types";

/**
 * Alert evaluation, and the words used for it everywhere.
 *
 * The admin keeps a catalogue of rules; you attach as many as you like to a
 * truck and set each one's interval. Three kinds exist:
 *
 *   periodic_location  every N minutes, report where the truck is - even when
 *                      that is the same plaza as last time.
 *   location_change    every N minutes, report only if the plaza differs from
 *                      the one this alert last reported.
 *   plaza_crossing     every N minutes, report only if the truck is at one
 *                      named toll plaza.
 *
 * Evaluation is deliberately a pure function of the alert row, the truck's
 * position and the clock. The worker owns fetching, delivery and persistence.
 */

/**
 * Names say what lands on your phone, not what the machine watches. The old
 * "Location update" and "Location changed" were one word apart and nobody
 * could tell which was which in a dropdown - the difference people care about
 * is "every time" versus "only when it moves".
 *
 * These are also the admin catalogue's own kind names, so they have to read as
 * a rule name there as well as an answer here.
 */
export const ALERT_KIND_LABEL: Record<AlertRuleKind, string> = {
  periodic_location: "Every time we look",
  location_change: "Only when it moves",
  plaza_crossing: "When it reaches a plaza",
};

export const ALERT_KIND_HINT: Record<AlertRuleKind, string> = {
  periodic_location:
    "A message on every check, saying which toll plaza the truck is at - even if it has not moved.",
  location_change:
    "We check just as often, but you only hear from us when the truck has reached a different toll plaza.",
  plaza_crossing:
    "Name one toll plaza. You hear from us the first time the truck is recorded there.",
};

/** A sample of the message itself. Shorter than any explanation of it. */
export const ALERT_KIND_EXAMPLE: Record<AlertRuleKind, string> = {
  periodic_location: "GJ02AT8546 is at Nadiad Toll Plaza",
  location_change: "GJ02AT8546 moved to Nadiad Toll Plaza",
  plaza_crossing: "GJ02AT8546 reached Nadiad Toll Plaza",
};

/** Only this kind needs a plaza named, so only this kind shows the search box. */
export function needsPlaza(kind: AlertRuleKind): boolean {
  return kind === "plaza_crossing";
}

/* -------------------------------------------------------------------------- */
/* one alert of each kind                                                      */
/* -------------------------------------------------------------------------- */

/**
 * truck_alerts as the database stores it since migration 0048: the template's
 * kind mirrored onto the row.
 *
 * The mirror exists because a unique index can only see the table it is built
 * on, and the rule is per kind - not per template, which is a catalogue row an
 * admin can duplicate or rename without a deploy. Derived by a trigger on every
 * write, so this field is never something the app sets.
 */
/**
 * Kept as an alias now that template_kind lives on TruckAlert itself, so the
 * helpers below still accept the narrow shape a form has to hand.
 */
export type AlertKindMirror = Pick<TruckAlert, "template_kind">;

/**
 * What makes two alerts the same question, as one comparable string.
 *
 * DELIBERATELY THE SAME EXPRESSION AS truck_alerts_one_enabled_per_kind_idx in
 * migration 0048 - kind, then the plaza trimmed, space-collapsed and lower
 * cased. The index is the rule and this is the app agreeing with it in advance,
 * so a form can say "you already watch this" instead of letting the officer
 * fill it in and handing back a constraint violation.
 *
 * The plaza is in the key for every kind rather than only for plaza_crossing,
 * exactly as the index has it. That is not a shortcut: a kind that does not
 * name a plaza always stores null there, so all of its rows key on the empty
 * string and collide, while two plaza_crossing rows naming two different
 * plazas are two different questions and both are allowed.
 */
export function alertIdentity(kind: AlertRuleKind, plaza?: string | null): string {
  return `${kind}::${normaliseLocation(plaza) ?? ""}`;
}

/** The same, for a row that already exists. */
export function alertIdentityOf(alert: AlertKindMirror & Pick<TruckAlert, "plaza">): string {
  return alertIdentity(alert.template_kind, alert.plaza);
}

/**
 * One sentence for what this alert will actually do, in the order a person
 * asks it: how often we look, and when they hear from us. Takes loose parts
 * rather than a row so the add form can show it before the alert exists.
 */
export function alertSentence(
  kind: AlertRuleKind,
  minutes: number,
  plaza?: string | null,
): string {
  // "We look" matches describeCadence() in src/lib/intervals.ts - the two sit
  // next to each other in the form and should not sound like two features.
  const beat = `We look every ${intervalLabel(minutes)}`;
  switch (kind) {
    case "periodic_location":
      return `${beat} and message you every time with where the truck is.`;
    case "location_change":
      return `${beat} and message you only when the truck has reached a different toll plaza.`;
    case "plaza_crossing":
      return `${beat} and message you when the truck reaches ${plaza?.trim() || "the toll plaza you name"}.`;
    default:
      return `${beat}.`;
  }
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
  /**
   * The crossing that was reported. A truck can pass one plaza twice in a
   * day, so the plaza name alone cannot answer "is this new" - 11:00 Malvan
   * and 15:00 Malvan are two crossings with one name.
   */
  last_event_at?: string | null;
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
 * Is a reading at the same plaza a fresh crossing, or the previous one being
 * re-reported?
 *
 * A plaza reports one physical crossing under several sequence numbers, so the
 * same name arriving again usually means nothing. Usually - a truck that goes
 * out and comes back passes it twice, and those are two crossings sharing one
 * name. Time is the only thing that separates them.
 *
 * With no timestamp on either side there is nothing to judge by, and the safe
 * answer is no: treating an undated reading as a revisit would let a plaza that
 * reports without times insert a row on every single check.
 */
export function isRevisit(
  previousAt: string | null,
  eventAt: string | null,
  revisitMinutes: number,
): boolean {
  if (!previousAt || !eventAt) return false;
  const before = new Date(previousAt).getTime();
  const now = new Date(eventAt).getTime();
  if (Number.isNaN(before) || Number.isNaN(now)) return false;
  return now - before >= revisitMinutes * 60_000;
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
  plazaThreshold = DEFAULT_PLAZA_MATCH_THRESHOLD,
}: {
  truckNumber: string;
  alert: TruckAlertWithTemplate;
  position: Position;
  now: Date;
  /**
   * The similarity a typed plaza name must reach before its alert fires. The
   * caller passes the admin's `plaza_match_threshold`; the default is here so
   * that a caller who has no settings to hand still gets the measured number
   * rather than zero, which would fire on everything.
   */
  plazaThreshold?: number;
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
      // "Has the truck reached a toll plaza since I last told you?" - asked
      // about the crossing, because a return trip passes the same plaza again
      // and a name comparison would call that no change at all.
      if (current === null) return { draft: null, stateUpdate };

      const previous = normaliseLocation(alert.last_location);
      const seenAt = position.eventTime;
      const reportedAt = alert.last_event_at ?? null;

      const isNewCrossing =
        seenAt && reportedAt
          ? new Date(seenAt).getTime() > new Date(reportedAt).getTime()
          // Without both timestamps there is nothing better than the name.
          : current !== previous;

      if (!isNewCrossing) return { draft: null, stateUpdate };

      // No previous crossing means this is the first look, not a move. Record
      // the baseline quietly - otherwise switching the alert on fires once.
      stateUpdate.last_location = position.locName;
      stateUpdate.last_event_at = seenAt;
      if (previous === null && reportedAt === null) return { draft: null, stateUpdate };

      // Coming back to the plaza it was last seen at is a real move, and
      // "moved to Malvan, previously Malvan" would read as a glitch.
      const returned = previous !== null && current === previous;

      return {
        draft: {
          alertId: alert.id,
          kind: "location_change",
          title: returned
            ? `${truckNumber} is back at ${position.locName}`
            : `${truckNumber} moved to ${position.locName}`,
          message: returned
            ? `Passed ${place(position)}${heading(position)} again.`
            : `Now at ${place(position)}${heading(position)}, previously ${alert.last_location}.`,
          position,
        },
        stateUpdate,
      };
    }

    /* -------------------------------------------------------------------- */
    case "plaza_crossing": {
      const watched = normaliseLocation(alert.plaza);
      if (!watched || current === null) return { draft: null, stateUpdate };

      stateUpdate.last_location = position.locName;

      /*
       * WHY THIS IS NO LONGER `current !== watched`.
       *
       * It was, and that meant an alert on a plaza the officer TYPED could
       * never fire: they type "hathijan", the portal records "Hathijan Toll
       * Plaza", and those are not equal. 77% of the live catalogue carries that
       * furniture, so the form's confirm-and-watch path was almost always a
       * promise this line then broke - silently, at a credit a check.
       *
       * matchPlaza() owns the rules and the reasoning; the short version is
       * that both modes match on the folded name and on plaza_core() equality,
       * and only a typed plaza is additionally compared by similarity.
       *
       * plaza_match is null on an alert made before 0055 that the backfill has
       * not reached. "exact" is the safe reading of a missing value: it is what
       * this line did before, so a null can only ever behave as it always has.
       */
      const mode = alert.plaza_match ?? "exact";
      const hit = matchPlaza({
        watched: alert.plaza,
        seen: position.locName,
        mode,
        threshold: plazaThreshold,
      });
      if (!hit.matched) return { draft: null, stateUpdate };

      // Sitting at the watched plaza must not report on every interval, but
      // arriving a second time later that day must. So the guard is the
      // crossing, not the plaza: report once per crossing, every crossing.
      const seenAt = position.eventTime;
      const reportedAt = alert.last_event_at ?? null;
      const alreadyReported =
        seenAt && reportedAt
          ? new Date(seenAt).getTime() <= new Date(reportedAt).getTime()
          /*
           * The name fallback goes through the same matcher rather than
           * comparing to `watched` directly. With a typed plaza the last
           * recorded location is the portal's spelling and `watched` is the
           * officer's, so an equality test here would call every crossing new
           * and report the truck as arriving on every single check.
           */
          : matchPlaza({
              watched: alert.plaza,
              seen: alert.last_location,
              mode,
              threshold: plazaThreshold,
            }).matched;

      if (alreadyReported) return { draft: null, stateUpdate };
      stateUpdate.last_event_at = seenAt;

      /*
       * A similarity match is a judgement, not an identity, so it says so. The
       * officer asked about a name we have never recorded and we decided this
       * crossing was it; if we are wrong, the one thing that lets them notice
       * is seeing both names. An exact or core match needs no such note - the
       * message already names the plaza as recorded.
       */
      const guessed = hit.basis === "similar";

      return {
        draft: {
          alertId: alert.id,
          kind: "plaza_crossing",
          title: `${truckNumber} reached ${alert.plaza}`,
          message: guessed
            ? `Recorded at ${place(position)}${heading(position)}. You asked about "${alert.plaza}" and this is the closest name on record, so check it is the plaza you meant.`
            : `Recorded at ${place(position)}${heading(position)}.`,
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

/** One line describing an alert in a list: "Only when it moves · every 30m". */
export function describeAlert(alert: TruckAlertWithTemplate): string {
  const parts = [alert.template.name, `every ${intervalShort(alert.interval_minutes)}`];
  if (alert.plaza) parts.push(alert.plaza);
  return parts.join(" · ");
}

/**
 * Kept so nothing importing it breaks. Interval wording lives in
 * src/lib/intervals.ts now, where the minutes/hours arithmetic already is.
 */
export const intervalWords = intervalShort;
