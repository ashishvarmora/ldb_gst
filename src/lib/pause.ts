import type { BadgeTone } from "@/components/ui";
import type { AppSettings, PausedReason, TrackedTruck } from "@/lib/types";

/**
 * How long this truck may sit still before it is paused, in hours.
 *
 * Same two levels as the failure budget, and for the same reason: the officer
 * knows whether this particular lorry is expected to be parked for a week, and
 * anything they left blank should keep following the platform setting rather
 * than a number frozen onto the row the day they added it.
 *
 * Zero or a negative platform setting is treated as "switched off" rather than
 * as "pause everything immediately" - a misconfigured number must not silently
 * stop every truck on the platform.
 */
export function resolveInactiveWindow(
  truck: Pick<TrackedTruck, "inactive_pause_hours">,
  settings: Pick<AppSettings, "inactivePauseHours">,
): number | null {
  if (truck.inactive_pause_hours !== null && truck.inactive_pause_hours !== undefined) {
    return truck.inactive_pause_hours >= 1 ? truck.inactive_pause_hours : null;
  }
  const hours = settings.inactivePauseHours;
  return Number.isFinite(hours) && hours >= 1 ? hours : null;
}

/**
 * Has this truck reached a stop of its own?
 *
 * Two of them, checked in the order they are worth reporting. A truck past its
 * auto-pause time was going to stop anyway, so that is the honest reason even
 * if it also happens to have been sitting still.
 *
 * Inactivity is measured from the last crossing, falling back to when the
 * truck was added. Without that fallback a lorry that has never been seen -
 * a number typed a minute ago, a vehicle between journeys - would count as
 * infinitely inactive and be paused before its first check.
 */
export function dueForAutoPause(
  truck: Pick<
    TrackedTruck,
    "auto_pause_at" | "inactive_pause_hours" | "last_event_at" | "created_at"
  >,
  settings: Pick<AppSettings, "inactivePauseHours">,
  now: Date,
): { reason: "schedule" | "inactive"; hours?: number } | null {
  if (truck.auto_pause_at) {
    const due = new Date(truck.auto_pause_at).getTime();
    if (!Number.isNaN(due) && now.getTime() >= due) return { reason: "schedule" };
  }

  const window = resolveInactiveWindow(truck, settings);
  if (window === null) return null;

  const since = truck.last_event_at ?? truck.created_at;
  if (!since) return null;
  const at = new Date(since).getTime();
  if (Number.isNaN(at)) return null;

  const idleHours = (now.getTime() - at) / 3_600_000;
  if (idleHours >= window) return { reason: "inactive", hours: window };
  return null;
}

/**
 * Why a truck stopped being checked, in the words the officer reads.
 *
 * One table, because there are now five reasons and four screens that show
 * them - the truck card, the truck's own page, the fleet list and the admin's
 * view of somebody's trucks. Each of those had its own `paused_reason ===
 * "repeated_failures" ? … : "paused"` ternary, which meant a new reason
 * appeared as the word "paused" everywhere and the officer was told nothing.
 * That is the exact failure this feature exists to prevent: a truck that goes
 * quiet without saying why.
 *
 * Three fields because three different lengths are needed. `badge` fits beside
 * a registration number, `line` is the sentence under it, and `detail` is the
 * paragraph on the truck's own page that says what to do about it.
 *
 * The badges are capitalised and say what happened, not what the row is. They
 * used to read "paused", "time up", "stopped moving", "account off" - shorthand
 * that a reader has to already know the feature to decode, and which said the
 * same word for a decision the officer made and a fault they need to act on.
 * An officer scanning a list of forty lorries has to be able to tell, without
 * opening anything, which of these is their own doing and which is a problem.
 */
export type PauseCopy = {
  /** Two or three words, for a Badge next to the truck number. */
  badge: string;
  tone: BadgeTone;
  /** One line, for the card. Starts with "Paused" so it reads on its own. */
  line: string;
  /** What happened and what to do, for the truck's own page. */
  detail: string;
  /**
   * Whether the officer can simply switch it back on and expect it to stay on.
   * False for the two that will fire again immediately unless something else
   * changes - a suspended account, or a number the toll network cannot answer.
   */
  resumable: boolean;
  /**
   * Did the platform stop this, or did the officer?
   *
   * The distinction the list has to make at a glance. "I paused this last
   * Tuesday" needs no explanation; "the platform stopped this without me" is
   * the only case where the reason is worth screen space, and it is the thing
   * the owner asked to be labelled. One flag rather than each screen testing
   * `paused_reason !== "manual"`, which is the shape that goes stale the next
   * time a reason is added.
   */
  automatic: boolean;
};

/*
 * WHAT PAUSING ACTUALLY DOES, because this copy used to say the wrong thing.
 *
 * Every one of these details told the officer that a paused truck stops
 * spending credits. That was true until automatic checking became part of the
 * plan rather than something credits paid for: auto_check is rated 0, so a
 * checked truck costs nothing and pausing it saves nothing. Credits now buy
 * manual searches only.
 *
 * What pausing does do is hand back the truck's TRACKING SLOT - truckSlotsLeft
 * counts active trucks against the plan's limit - and stop the alerts. Both are
 * real reasons to pause a parked lorry; neither is money. Leaving the old
 * wording in place would have been worse than vague: an officer told that
 * pausing preserves their balance, while also being nudged to top up, would
 * reasonably conclude that pausing protects their search budget. It does not.
 */
export const PAUSE_COPY: Record<PausedReason, PauseCopy> = {
  manual: {
    badge: "Paused by you",
    tone: "neutral",
    line: "Paused by you — not being checked",
    detail:
      "You paused this truck. Nothing is being checked, so no alerts will reach you about it, and its tracking slot is free for another lorry. Its recorded crossings are all still here.",
    resumable: true,
    automatic: false,
  },
  schedule: {
    badge: "Time limit reached",
    tone: "brand",
    line: "Stopped automatically — the time limit you set has passed",
    detail:
      "This truck was set to stop being checked automatically after a set time, and that time has passed. Its tracking slot is free for another lorry, and everything it recorded is still here. Switch it back on to carry on — you can set a new stop time at the same moment.",
    resumable: true,
    automatic: true,
  },
  inactive: {
    badge: "No movement",
    tone: "warn",
    line: "Stopped automatically — no toll crossing for a long time",
    detail:
      "No new toll crossing has arrived for this truck for long enough that checking it was only ever going to return the same answer, so it was paused and its tracking slot handed back. That usually means the lorry is parked. Switch it back on when it is on the road again.",
    resumable: true,
    automatic: true,
  },
  repeated_failures: {
    badge: "Number not responding",
    tone: "bad",
    line: "Stopped automatically — the toll network keeps failing on this number",
    detail:
      "The toll network could not answer for this registration number several times in a row, so checking was paused rather than left asking a question with no answer. The usual cause is a typo in the number, or a lorry the network has stopped reporting. Check the number first — switching it back on without changing anything will most likely fail again.",
    resumable: false,
    automatic: true,
  },
  account_suspended: {
    badge: "Account suspended",
    tone: "bad",
    line: "Stopped — this account is suspended",
    detail:
      "Automatic checking is stopped for every truck on this account while it is suspended. Nothing has been lost. Contact support to have it switched back on.",
    resumable: false,
    automatic: true,
  },
};

/** The copy for a truck, or null while it is running. */
export function pauseCopyFor(
  truck: Pick<TrackedTruck, "is_active" | "paused_reason">,
): PauseCopy | null {
  if (truck.is_active) return null;
  // A paused truck with no reason recorded predates the column. "Paused" is
  // the honest answer there rather than a guess at which stop fired.
  return PAUSE_COPY[truck.paused_reason ?? "manual"] ?? PAUSE_COPY.manual;
}

/**
 * "in 6 hours", "in 3 days", "any moment now" - how long a scheduled stop has
 * left, for a truck that is still running.
 *
 * Returns null when there is no schedule, and when the deadline has already
 * passed without the sweep having caught up: saying "in -2 hours" is worse
 * than saying nothing, and the truck is about to be paused anyway.
 */
export function autoPauseCountdown(
  truck: Pick<TrackedTruck, "is_active" | "auto_pause_at">,
  now: Date = new Date(),
): string | null {
  if (!truck.is_active || !truck.auto_pause_at) return null;
  const due = new Date(truck.auto_pause_at).getTime();
  if (Number.isNaN(due)) return null;

  const minutes = Math.round((due - now.getTime()) / 60_000);
  if (minutes <= 0) return "any moment now";
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.round(minutes / 60);
  if (hours < 48) return `in ${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(hours / 24);
  return `in ${days} day${days === 1 ? "" : "s"}`;
}
