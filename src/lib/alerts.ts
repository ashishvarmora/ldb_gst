import { matchedKeyword, stateFromLocation } from "@/lib/geo";
import type { AlertRule, AlertRuleKind, AppSettings } from "@/lib/types";

/**
 * Alert rule evaluation. Deliberately a pure function: given a truck, its new
 * crossings and its recent history, decide which alerts should fire. The worker
 * handles persistence, de-duplication against alert_logs, and delivery.
 */

export type EventLike = {
  seq_no: string;
  event_time: string | null;
  loc_name: string | null;
  direction: string | null;
  /** False when this crossing reports the same plaza as the one before it. */
  is_location_change?: boolean;
};

export type AlertDraft = {
  ruleId: string | null;
  kind: AlertRuleKind;
  title: string;
  message: string;
  /** Crossing that triggered it, when there is one. */
  event: EventLike | null;
  notifyTelegram: boolean;
  notifySheet: boolean;
  /**
   * Suppress an identical alert for this rule + truck if one already went out
   * inside this many minutes. 0 means "only suppress within the same sweep".
   */
  dedupeMinutes: number;
};

export const ALERT_KIND_LABEL: Record<AlertRuleKind, string> = {
  approaching_city: "Approaching city",
  state_entry: "Entered a state",
  state_exit: "Left a state",
  no_movement: "No movement",
  excessive_movement: "Excessive movement",
  watchlist_move: "Watchlist truck moved",
  night_travel: "Night travel",
  route_prediction: "Route prediction",
};

export const ALERT_KIND_HINT: Record<AlertRuleKind, string> = {
  approaching_city:
    "Fires when a truck crosses one of the toll plazas that ring a city you name.",
  state_entry: "Fires when a truck's toll plazas move into a different state.",
  state_exit: "Fires when a truck leaves the state you name.",
  no_movement: "Fires when a tracked truck records no crossing for N hours.",
  excessive_movement: "Fires when a truck crosses N plazas inside a few hours.",
  watchlist_move: "Fires on every crossing by a truck you marked as watchlist.",
  night_travel: "Fires on crossings inside your night window.",
  route_prediction:
    "You list a corridor of plazas in order; fires when a truck follows it, with the next expected stop.",
};

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

function str(config: Record<string, unknown>, key: string, fallback = ""): string {
  const value = config[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
}

function num(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = config[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function keywordList(config: Record<string, unknown>, key = "tolls"): string[] {
  const value = config[key];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/** Minutes past IST midnight for an ISO timestamp. */
function istMinutes(iso: string | null): number | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = date
    .toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour12: false })
    .split(":");
  return Number(parts[0]) * 60 + Number(parts[1]);
}

function parseClock(value: string, fallback: number): number {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return fallback;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Handles windows that wrap past midnight, e.g. 22:00 -> 06:00. */
export function isInNightWindow(iso: string | null, from: string, to: string): boolean {
  const minutes = istMinutes(iso);
  if (minutes === null) return false;
  const start = parseClock(from, 22 * 60);
  const end = parseClock(to, 6 * 60);
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (now.getTime() - then) / 3_600_000;
}

function place(event: EventLike | null): string {
  return event?.loc_name ?? "an unnamed plaza";
}

/** Corridor keywords are typed in lowercase; alerts read better capitalised. */
function titleCase(value: string): string {
  return value.replace(/[a-z]/g, (ch) => ch.toUpperCase());
}

/* -------------------------------------------------------------------------- */
/* evaluation                                                                  */
/* -------------------------------------------------------------------------- */

export type EvaluateInput = {
  truckNumber: string;
  isWatchlist: boolean;
  /** Crossings seen for the first time in this poll, newest first. */
  newEvents: EventLike[];
  /** Recent history including the new ones, newest first. */
  recentEvents: EventLike[];
  rules: AlertRule[];
  settings: AppSettings;
  now: Date;
};

export function evaluateRules(input: EvaluateInput): AlertDraft[] {
  const { truckNumber, isWatchlist, newEvents, recentEvents, rules, settings, now } = input;
  const drafts: AlertDraft[] = [];
  const newest = newEvents[0] ?? null;
  const latest = recentEvents[0] ?? null;

  for (const rule of rules) {
    if (!rule.is_active) continue;
    const config = rule.config ?? {};

    const base = {
      ruleId: rule.id,
      kind: rule.kind,
      notifyTelegram: rule.notify_telegram,
      notifySheet: rule.notify_sheet,
    };

    switch (rule.kind) {
      /* ------------------------------------------------------------------ */
      case "approaching_city": {
        if (!newest) break;
        const city = str(config, "city", "the city");
        const tolls = keywordList(config, "tolls");
        if (tolls.length === 0) break;

        const hit = newEvents.find((event) => matchedKeyword(event.loc_name, tolls));
        if (!hit) break;

        drafts.push({
          ...base,
          event: hit,
          title: `Approaching ${city}`,
          message: `${truckNumber} crossed ${place(hit)}${
            hit.direction ? ` heading ${hit.direction}` : ""
          }, on the approach to ${city}.`,
          dedupeMinutes: num(config, "cooldown_minutes", 120),
        });
        break;
      }

      /* ------------------------------------------------------------------ */
      case "state_entry":
      case "state_exit": {
        if (!newest) break;
        const watched = str(config, "state");
        const currentState = stateFromLocation(newest.loc_name);
        // The crossing before this one, to detect an actual change.
        const previous = recentEvents.find((event) => event.seq_no !== newest.seq_no) ?? null;
        const previousState = stateFromLocation(previous?.loc_name ?? null);

        if (!currentState || currentState === previousState) break;

        if (rule.kind === "state_entry") {
          if (watched && currentState !== watched) break;
          drafts.push({
            ...base,
            event: newest,
            title: `Entered ${currentState}`,
            message: `${truckNumber} crossed ${place(newest)}${
              previousState ? `, previously in ${previousState}` : ""
            }.`,
            dedupeMinutes: num(config, "cooldown_minutes", 180),
          });
        } else {
          if (!previousState) break;
          if (watched && previousState !== watched) break;
          drafts.push({
            ...base,
            event: newest,
            title: `Left ${previousState}`,
            message: `${truckNumber} crossed ${place(newest)} in ${currentState}, leaving ${previousState}.`,
            dedupeMinutes: num(config, "cooldown_minutes", 180),
          });
        }
        break;
      }

      /* ------------------------------------------------------------------ */
      case "no_movement": {
        const hours = num(config, "hours", settings.noActivityHours);
        const idleFor = hoursSince(latest?.event_time ?? null, now);
        if (idleFor === null || idleFor < hours) break;
        // A brand new crossing means it is moving again.
        if (newEvents.length > 0) break;

        drafts.push({
          ...base,
          event: latest,
          title: `No movement for ${Math.floor(idleFor)}h`,
          message: `${truckNumber} has not crossed a toll plaza since ${place(latest)}, about ${Math.floor(
            idleFor,
          )} hours ago.`,
          dedupeMinutes: Math.max(hours * 60, 60),
        });
        break;
      }

      /* ------------------------------------------------------------------ */
      case "excessive_movement": {
        if (newEvents.length === 0) break;
        const tolls = num(config, "tolls", settings.excessiveTolls);
        const hours = num(config, "hours", settings.excessiveWindowHours);
        const cutoff = now.getTime() - hours * 3_600_000;

        const inWindow = recentEvents.filter((event) => {
          if (!event.event_time) return false;
          const time = new Date(event.event_time).getTime();
          return !Number.isNaN(time) && time >= cutoff;
        });
        if (inWindow.length < tolls) break;

        drafts.push({
          ...base,
          event: newest,
          title: `${inWindow.length} plazas in ${hours}h`,
          message: `${truckNumber} crossed ${inWindow.length} toll plazas in the last ${hours} hours, latest ${place(
            newest,
          )}.`,
          dedupeMinutes: num(config, "cooldown_minutes", hours * 60),
        });
        break;
      }

      /* ------------------------------------------------------------------ */
      case "watchlist_move": {
        if (!isWatchlist || !newest) break;
        drafts.push({
          ...base,
          event: newest,
          title: "Watchlist truck moved",
          message: `${truckNumber} crossed ${place(newest)}${
            newest.direction ? ` heading ${newest.direction}` : ""
          }.`,
          dedupeMinutes: num(config, "cooldown_minutes", 0),
        });
        break;
      }

      /* ------------------------------------------------------------------ */
      case "night_travel": {
        const from = str(config, "from", settings.nightFrom);
        const to = str(config, "to", settings.nightTo);
        const hit = newEvents.find((event) => isInNightWindow(event.event_time, from, to));
        if (!hit) break;

        drafts.push({
          ...base,
          event: hit,
          title: "Night movement",
          message: `${truckNumber} crossed ${place(hit)} inside the ${from}–${to} window.`,
          dedupeMinutes: num(config, "cooldown_minutes", 120),
        });
        break;
      }

      /* ------------------------------------------------------------------ */
      case "route_prediction": {
        if (!newest) break;
        const sequence = keywordList(config, "sequence");
        if (sequence.length < 2) break;
        const destination = str(config, "destination", sequence[sequence.length - 1]);

        // Where on the corridor is the newest crossing?
        const index = sequence.findIndex(
          (keyword) => matchedKeyword(newest.loc_name, [keyword]) !== null,
        );
        if (index < 0) break;

        // Confirm it came from an earlier point on the same corridor.
        const previous = recentEvents.find((event) => event.seq_no !== newest.seq_no) ?? null;
        const previousIndex = previous
          ? sequence.findIndex(
              (keyword) => matchedKeyword(previous.loc_name, [keyword]) !== null,
            )
          : -1;
        if (previousIndex < 0 || previousIndex >= index) break;

        const next = sequence[index + 1] ? titleCase(sequence[index + 1]) : null;
        drafts.push({
          ...base,
          event: newest,
          title: next ? `On corridor to ${destination}` : `Reached ${destination}`,
          message: next
            ? `${truckNumber} crossed ${place(newest)} after ${previous?.loc_name ?? "an earlier plaza"}. Next expected: ${next}. Likely heading to ${destination}.`
            : `${truckNumber} crossed ${place(newest)}, the last point on the ${destination} corridor.`,
          dedupeMinutes: num(config, "cooldown_minutes", 120),
        });
        break;
      }
    }
  }

  return drafts;
}

/** One-line summary of a rule's config, for the rules list in the UI. */
export function describeRule(rule: AlertRule, settings?: AppSettings): string {
  const config = rule.config ?? {};
  switch (rule.kind) {
    case "approaching_city": {
      const tolls = keywordList(config, "tolls");
      return `${str(config, "city", "city")} — watching ${tolls.length} toll keyword${
        tolls.length === 1 ? "" : "s"
      }`;
    }
    case "state_entry":
      return str(config, "state") ? `Entering ${str(config, "state")}` : "Entering any new state";
    case "state_exit":
      return str(config, "state") ? `Leaving ${str(config, "state")}` : "Leaving the current state";
    case "no_movement":
      return `Silent for ${num(config, "hours", settings?.noActivityHours ?? 6)}h`;
    case "excessive_movement":
      return `${num(config, "tolls", settings?.excessiveTolls ?? 5)} plazas in ${num(
        config,
        "hours",
        settings?.excessiveWindowHours ?? 2,
      )}h`;
    case "watchlist_move":
      return "Any crossing by a watchlist truck";
    case "night_travel":
      return `${str(config, "from", settings?.nightFrom ?? "22:00")} – ${str(
        config,
        "to",
        settings?.nightTo ?? "06:00",
      )}`;
    case "route_prediction": {
      const sequence = keywordList(config, "sequence");
      return sequence.length > 0 ? sequence.join(" → ") : "No corridor set";
    }
    default:
      return "";
  }
}
