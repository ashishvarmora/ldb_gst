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
  periodic_location: "Every check",
  location_change: "Only when it moves",
  plaza_crossing: "When it reaches a plaza",
  halt: "When the truck halts",
};

export const ALERT_KIND_HINT: Record<AlertRuleKind, string> = {
  periodic_location:
    "A message on every check with the truck's latest toll plaza — even if unchanged.",
  location_change:
    "Checked just as often, but you are notified only when the truck reaches a different toll plaza.",
  plaza_crossing:
    "Name one toll plaza. You are notified the first time the truck is recorded there.",
  halt:
    "Notified when no toll crossing is recorded for the hours you set, then every 1 hour until it moves.",
};

/** A sample of the message itself. Shorter than any explanation of it. */
export const ALERT_KIND_EXAMPLE: Record<AlertRuleKind, string> = {
  periodic_location: "GJ02AT8546 is at Nadiad Toll Plaza",
  location_change: "GJ02AT8546 moved to Nadiad Toll Plaza",
  plaza_crossing: "GJ02AT8546 reached Nadiad Toll Plaza",
  halt: "GJ02AT8546 has halted: no toll crossing for 4 hours",
};

/** The halt alert's reminder cadence, fixed by the owner (20 Nov 2026). */
export const HALT_REMINDER_MINUTES = 60;

/** "1 hour", "4 hours" - units always spelled out. */
export function hoursLabel(hours: number): string {
  const h = Math.round(hours * 10) / 10;
  return `${h} ${h === 1 ? "hour" : "hours"}`;
}

/** The halt alert's two hour fields: bounds shared by the form and the server. */
export const HALT_AFTER_MAX_HOURS = 72;
export const HALT_PAUSE_MAX_HOURS = 168;
export const HALT_PAUSE_ORDER_ERROR = "Pause time must be longer than the alert time.";

/** What an alert's row shows under the alert name - fully worded units. */
export function alertCadence(alert: {
  kind: AlertRuleKind;
  intervalMinutes: number;
  plaza?: string | null;
  haltAfterHours?: number | null;
  pauseAfterHours?: number | null;
}): string {
  if (alert.kind === "halt") {
    return [
      alert.haltAfterHours ? `after ${hoursLabel(alert.haltAfterHours)}` : null,
      alert.pauseAfterHours ? `pause after ${hoursLabel(alert.pauseAfterHours)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return [`every ${intervalLabel(alert.intervalMinutes)}`, alert.plaza ?? null]
    .filter(Boolean)
    .join(" · ");
}

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
  // "Checked every" matches describeCadence() in src/lib/intervals.ts - the two
  // sit next to each other in the form and should not sound like two features.
  const beat = `Checked every ${intervalLabel(minutes)}`;
  switch (kind) {
    case "periodic_location":
      return `${beat}; you get a message each time with the truck's latest toll plaza.`;
    case "location_change":
      return `${beat}; you get a message only when the truck reaches a different toll plaza.`;
    case "plaza_crossing":
      return `${beat}; you get a message when the truck reaches ${plaza?.trim() || "the toll plaza you name"}.`;
    case "halt":
      return "Checked every 1 hour; you get a message when the truck halts, every 1 hour while it stays halted, and when it moves again.";
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
  /** Halt alert only: which of its three messages this is. */
  phase?: HaltPhase;
  /** location_change: the plaza it was last reported at (null on a return to the same one). */
  previousLocation?: string | null;
  /** halt: how long without a crossing, worded ("4 hours"). */
  idleText?: string;
  /** plaza_crossing: the plaza name the customer asked about. */
  watchedPlaza?: string | null;
  /** plaza_crossing: matched by similarity, so the recorded name differs from the one asked about. */
  guessed?: boolean;
};

export type HaltPhase = "halted" | "still_halted" | "moving_again";

/*
 * WHICH ALERTS ARE WORTH A WHATSAPP MESSAGE (owner, 23 Nov 2026).
 *
 * Outside the 24-hour window a WhatsApp message is a paid template (about
 * Rs 0.12-0.15 each in India), and a truck on "every check" every 15 minutes
 * would be ~96 of them a day saying mostly the same thing. So WhatsApp
 * carries only the news a person acts on:
 *
 *   plaza_crossing     yes - the truck reached the plaza they named
 *   location_change    yes - it crossed a new plaza
 *   halt               the first "has halted" and "moving again" only; the
 *                      hourly "still halted" reminders stay on app + Telegram
 *   periodic_location  never - app push and Telegram only
 *
 * App push and Telegram are free and keep getting everything.
 */
export function alertGoesToWhatsApp(draft: Pick<AlertDraft, "kind" | "phase">): boolean {
  switch (draft.kind) {
    case "plaza_crossing":
    case "location_change":
      return true;
    case "halt":
      return draft.phase === "halted" || draft.phase === "moving_again";
    default:
      return false;
  }
}

/** The one-line channel note under an alert kind in the add-alert form. */
export const ALERT_KIND_WHATSAPP_NOTE: Record<AlertRuleKind, string> = {
  periodic_location: "Not sent on WhatsApp. Arrives in the app and on Telegram.",
  location_change: "Also sent on WhatsApp, if you have it on.",
  plaza_crossing: "Also sent on WhatsApp, if you have it on.",
  halt: "On WhatsApp: the first halt and moving again. Hourly reminders come in the app and on Telegram.",
};

/** The rule in one line, for the Notifications page. */
export const WHATSAPP_ALERTS_SCOPE = "WhatsApp: crossings, halt and moving again only.";

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
  /** Halt alert only. */
  halt_active?: boolean;
  halt_notified_at?: string | null;
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
          previousLocation: returned ? null : alert.last_location,
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
          watchedPlaza: alert.plaza,
          guessed,
        },
        stateUpdate,
      };
    }

    /* -------------------------------------------------------------------- */
    case "halt": {
      // Halted = no new toll crossing for halt_after_hours, measured from the
      // latest crossing on record. Nothing on record means nothing to judge.
      const haltHours = alert.halt_after_hours ?? null;
      const seenAt = position.eventTime;
      if (!haltHours || !seenAt) return { draft: null, stateUpdate };
      const seenMs = new Date(seenAt).getTime();
      if (Number.isNaN(seenMs)) return { draft: null, stateUpdate };

      const wasHalted = alert.halt_active ?? false;
      const reportedAt = alert.last_event_at ? new Date(alert.last_event_at).getTime() : null;
      const idleHours = (now.getTime() - seenMs) / 3_600_000;

      // 1. Halted earlier and a newer crossing has arrived: moving again.
      if (wasHalted && reportedAt !== null && seenMs > reportedAt) {
        stateUpdate.halt_active = false;
        stateUpdate.halt_notified_at = null;
        stateUpdate.last_event_at = seenAt;
        stateUpdate.last_location = position.locName;
        return {
          draft: {
            alertId: alert.id,
            kind: "halt",
            title: `${truckNumber} is moving again`,
            message: `Crossed ${place(position)}${heading(position)}.`,
            position,
            phase: "moving_again",
          },
          stateUpdate,
        };
      }

      // 2. Not halted (yet): keep the latest crossing as the baseline.
      if (idleHours < haltHours) {
        if (wasHalted) {
          stateUpdate.halt_active = false;
          stateUpdate.halt_notified_at = null;
        }
        stateUpdate.last_event_at = seenAt;
        stateUpdate.last_location = position.locName;
        return { draft: null, stateUpdate };
      }

      // 3. Halted: the first alert, then a reminder every HALT_REMINDER_MINUTES.
      const idleText = hoursLabel(Math.floor(idleHours));
      const lastSeen = `Last seen at ${place(position)}${heading(position)}.`;
      if (!wasHalted) {
        stateUpdate.halt_active = true;
        stateUpdate.halt_notified_at = stamp;
        stateUpdate.last_event_at = seenAt;
        stateUpdate.last_location = position.locName;
        return {
          draft: {
            alertId: alert.id,
            kind: "halt",
            title: `${truckNumber} has halted`,
            message: `No toll crossing for ${idleText}. ${lastSeen}`,
            position,
            phase: "halted",
            idleText,
          },
          stateUpdate,
        };
      }
      if (intervalElapsed(alert.halt_notified_at ?? null, HALT_REMINDER_MINUTES, now)) {
        stateUpdate.halt_notified_at = stamp;
        return {
          draft: {
            alertId: alert.id,
            kind: "halt",
            title: `${truckNumber} is still halted`,
            message: `No toll crossing for ${idleText}. ${lastSeen}`,
            position,
            phase: "still_halted",
            idleText,
          },
          stateUpdate,
        };
      }
      return { draft: null, stateUpdate };
    }

    /* -------------------------------------------------------------------- */
    default:
      return { draft: null, stateUpdate };
  }
}

/** One line describing an alert in a list: "Only when it moves · every 30m". */
export function describeAlert(alert: TruckAlertWithTemplate): string {
  if (alert.template.kind === "halt") {
    return [
      alert.template.name,
      alert.halt_after_hours ? `after ${hoursLabel(alert.halt_after_hours)}` : null,
      alert.pause_after_hours ? `pause after ${hoursLabel(alert.pause_after_hours)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const parts = [alert.template.name, `every ${intervalShort(alert.interval_minutes)}`];
  if (alert.plaza) parts.push(alert.plaza);
  return parts.join(" · ");
}

/**
 * Kept so nothing importing it breaks. Interval wording lives in
 * src/lib/intervals.ts now, where the minutes/hours arithmetic already is.
 */
export const intervalWords = intervalShort;
