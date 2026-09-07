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
    | "auto_pause_at"
    | "inactive_pause_hours"
    | "last_event_at"
    | "created_at"
    | "tracking_started_at"
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

  /*
   * Counted from the LATER of the last crossing and the moment tracking began.
   *
   * It used to be `last_event_at ?? created_at`, which meant a lorry whose last
   * recorded crossing was a day old was already a day "idle" when it was added
   * - so it blew through an eight-hour window on its first sweep and paused
   * itself before it had been watched once. That is backwards for the case this
   * exists for: the truck you most want to start watching is the one that has
   * been standing still, because it is the one you are waiting to see move.
   *
   * Taking the later of the two gives both readings what they promise. A truck
   * parked for a week gets a full window of being watched from the moment it
   * goes live. A truck that has been live for days and then stops still pauses
   * a window after its last crossing.
   */
  const candidates = [truck.tracking_started_at, truck.last_event_at, truck.created_at]
    .map((value) => (value ? new Date(value).getTime() : Number.NaN))
    .filter((time) => !Number.isNaN(time));

  if (candidates.length === 0) return null;
  const since = Math.max(...candidates);

  const idleHours = (now.getTime() - since) / 3_600_000;
  if (idleHours >= window) return { reason: "inactive", hours: window };
  return null;
}

/**
 * Why a truck stopped being checked, in the words the officer reads.
 *
 * One table, because there are now seven reasons and four screens that show
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
 *
 * They are also the owner's own words, and deliberately dull ones: "Tracking
 * period ended" and "Portal not responding" are the labels an officer would
 * write in a file note, where "time up" and "number not responding" read as
 * this product's private shorthand.
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
   *
   * False for the four that will fire again immediately unless something else
   * changes first - a suspended account, a number the toll network cannot
   * answer, a lapsed plan, or an empty balance. Every one of those would let
   * the switch appear to work and then stop the truck again on the next sweep,
   * which teaches the officer that the switch is broken.
   *
   * It maps exactly onto the tone: `bad` is the set that needs something fixed
   * before going live means anything, and it is the same set as `resumable`
   * false. Keep the two in step when a reason is added.
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
 * WHAT PAUSING IS FOR: credits. This copy has now said both things and only
 * one of them is true, so the reasoning is written down rather than left to be
 * guessed at again.
 *
 * For a few days automatic checks were rated at zero, and every detail here was
 * rewritten to say that pausing saves no money and only hands back a TRACKING
 * SLOT. The owner has reversed that: an automatic check costs one credit again.
 *
 * At one credit a check and the platform's fifteen-minute beat, one tracked
 * lorry spends about 96 credits a day. Pausing a lorry that is parked in a yard
 * is therefore not a tidiness feature - it is the largest lever the officer has
 * on their balance, and it is why auto-pause exists at all. In the owner's
 * words: auto pause mainly credit save karneke liye hai.
 *
 * So every PER-TRUCK detail leads with the credits and mentions the slot
 * second, where the slot is the thing the reader actually needs (a plan that
 * looks full). Say it the other way round and an officer being nudged to top
 * up, while being told that pausing only frees a slot, would reasonably leave
 * forty parked lorries switched on.
 *
 * The three ACCOUNT-WIDE reasons - no_credits, plan_expired, account_suspended
 * - deliberately say nothing about slots, and that is not an omission to
 * tidy up. They stop every truck at once, so there is no lorry left to give a
 * freed slot to, and offering one would read as a suggestion to add another
 * truck at the exact moment none of them can be checked.
 */
export const PAUSE_COPY: Record<PausedReason, PauseCopy> = {
  manual: {
    badge: "Paused by you",
    tone: "neutral",
    line: "Paused by you — not being checked",
    detail:
      "You paused this truck, so it is not being checked and it is not spending credits. Its recorded crossings are all still here, and its tracking slot is free for another lorry. Go live again whenever it is back on the road.",
    resumable: true,
    automatic: false,
  },
  schedule: {
    badge: "Tracking period ended",
    tone: "brand",
    line: "Stopped automatically — the tracking period you set has ended",
    detail:
      "You set this truck to stop being checked automatically, and that time has passed — so it stopped spending credits at the moment you said it should, whether or not you were watching. Everything it recorded is still here and its tracking slot is free for another lorry. Go live to carry on, and set a new end time at the same moment.",
    resumable: true,
    automatic: true,
  },
  inactive: {
    badge: "No movement detected",
    tone: "warn",
    line: "Stopped automatically — no toll crossing for a long time",
    detail:
      "No new toll crossing has arrived for long enough that every further check would have cost a credit to be told the same thing again, so checking was paused. That usually means the lorry is parked. Nothing is deleted, and its tracking slot is free for another lorry meanwhile. Go live when it is back on the road.",
    resumable: true,
    automatic: true,
  },
  repeated_failures: {
    badge: "Portal not responding",
    tone: "bad",
    line: "Stopped automatically — the failure limit was reached on this number",
    detail:
      "The portal could not answer for this registration number often enough in a row to reach this truck's failure limit, so checking was paused rather than left paying a credit per error. The usual cause is a typo in the number, or a lorry the portal has stopped reporting. Check the number before going live again — nothing will have changed if the number is wrong, and each failed check still costs a credit.",
    /*
     * RESUMABLE, unlike no_credits, and the difference is whether the officer
     * can see the blocking condition clear.
     *
     * An empty balance is objectively checkable: either there are credits or
     * there are not, so refusing until there are is honest and the officer can
     * fix it themselves.
     *
     * A failure run is not. It is caused either by a typo, which the officer
     * CAN fix, or by the portal being down or having dropped that lorry, which
     * they cannot - and we have no way to detect the portal recovering, because
     * we stopped asking. Blocking "until the cause is gone" therefore means a
     * truck that is dead for ever whenever the cause was an outage rather than
     * a mistake.
     *
     * The analogy is a number that will not connect. A system that tells you it
     * has failed ten times and suggests checking the number is useful; one that
     * refuses to let you dial again is broken. So going live is allowed and the
     * warning is loud.
     *
     * The cost of being wrong is asymmetric and small. A retry is one credit,
     * and the failure budget re-pauses the truck after the same number of
     * failures again - so the loop is self-limiting at roughly ten credits,
     * which is precisely what the budget is for. A permanently unusable truck
     * costs the officer the reason they bought the product.
     */
    resumable: true,
    automatic: true,
  },
  account_suspended: {
    badge: "Account suspended",
    tone: "bad",
    line: "Stopped — this account is suspended",
    detail:
      "Automatic checking is stopped for every truck on this account while it is suspended, so nothing is being checked and no credits are being spent. Nothing has been lost. Contact support to have the account switched back on; going live before that will not hold.",
    resumable: false,
    automatic: true,
  },
  /*
   * ADDED WITH THE TYPE, NOT WITH THE FEATURE. 0041 taught the worker to write
   * 'plan_expired' and widened the check constraint to accept it, and this
   * table was never given the row - so PausedReason did not name it, the
   * Record could not hold it, and pauseCopyFor()'s `?? PAUSE_COPY.manual`
   * guard turned a truck the platform had switched off into "Paused by you".
   * Every account whose plan lapsed has been reading, for two releases, that
   * it paused its own lorries.
   *
   * Not resumable, and not as a matter of policy: the worker's candidate query
   * filters on plan_expires_on, so a truck taken live on a lapsed plan is
   * simply never picked up. The switch would move and nothing would happen.
   */
  plan_expired: {
    badge: "Plan ended",
    tone: "bad",
    line: "Stopped — the plan ended and the renewal window has passed",
    detail:
      "Your plan ran out and the days to renew in have passed, so automatic checking was switched off on every truck. It is spending nothing. Nothing has been deleted — the trucks, their alerts and every crossing they recorded are all still here, and so are your credits, which never expire and still pay for manual searches. Renew the plan, then take the trucks live again from My trucks.",
    resumable: false,
    automatic: true,
  },
  /*
   * WHY IT IS ITS OWN REASON AND NOT 'account_suspended'
   *
   * They are the two account-wide stops and they need opposite instructions. A
   * suspension is somebody's decision about the customer and only support can
   * lift it; an empty balance is a number the customer fixes themselves in
   * about forty seconds, from a panel that is open even to lapsed accounts.
   * Filing this under that one would send every officer who ran out of credit
   * to the support line.
   *
   * WHY IT IS NOT RESUMABLE
   *
   * Because going live would be a lie for one sweep. The worker asks
   * spend_credits() for a credit before it calls the toll network, and on an
   * empty balance that refusal is what paused the truck in the first place -
   * so a truck switched back on with nothing in the wallet is refused and
   * paused again fifteen minutes later, with a moving switch and no
   * explanation in between. `resumable: false` is what puts "Open to fix" on
   * the card instead of a switch that undoes itself.
   *
   * TOPPING UP IS THE FIX AND IT IS NOT AUTOMATIC. Buying credits clears the
   * refusal, so the switch works again the moment the balance covers one
   * check; it does NOT take the trucks live by itself. Deliberate - see the
   * note on top-ups in src/lib/tracking.ts.
   */
  no_credits: {
    badge: "No credits left",
    tone: "bad",
    line: "Stopped automatically — there are no credits left to check with",
    detail:
      "Your balance could not cover another check, so every truck that was live has been paused rather than left on the list claiming to be watched. That is the point at which tracking stops costing you anything: nothing is checked, nothing is spent, and nothing is lost — the trucks, their alerts and every crossing they recorded are all still here. Top up, then take the ones you still need live again. Going live before topping up will not hold, because the next check would be refused for the same reason.",
    resumable: false,
    automatic: true,
  },
};

/**
 * The one sentence the owner wants available wherever pausing is explained.
 *
 * A constant rather than a line of prose in five files: it is the promise the
 * whole feature rests on - your history is safe AND your balance is safe - and
 * the version of it that drifts is the one that stops being true.
 */
export const PAUSE_HELP_LINE =
  "Paused trucks keep their history but do not consume tracking credits. Resume anytime when tracking is needed again.";

/**
 * The situations that stop a truck by itself, as the officer meets them.
 *
 * Shared between the "Auto-pause rules" (i) on My trucks and the support page's
 * answer to the same question, because those two are read by the same person a
 * week apart and a difference between them reads as a change in the rules.
 *
 * DELIBERATELY UNCOUNTED. All three screens that render this list used to
 * introduce it with the number four written out in prose, and adding the empty
 * balance made all three wrong at once - which is the third time a hand-written
 * count of these has gone stale. The sentence now describes what the rules are
 * FOR, which is the thing that does not change when one is added.
 *
 * WHY THE EMPTY BALANCE IS HERE AND A SUSPENDED ACCOUNT IS NOT. Both stop every
 * truck at once and neither has anything to do with a lorry's own settings, so
 * the old rule for this list - per-truck settings only - excluded both. That
 * rule was wrong about the one that matters. Running out of credit is the stop
 * every customer meets, it is the only one they fix themselves, and it is the
 * whole reason the other four exist: they are all there to keep the balance
 * from reaching it. A suspension stays out because it is somebody's decision
 * about the customer, support lifts it, and nothing on this list would help.
 */
export const AUTO_PAUSE_RULES: { label: string; body: string }[] = [
  {
    label: "Paused by you",
    body: "Track a lorry for the day, pause it tonight, go live again whenever you need it. Nothing is re-added and no history is lost.",
  },
  {
    label: "Tracking period ended",
    body: "Set an end time when you add a truck — checking stops there even if you forget about it, so a forgotten lorry cannot quietly spend a fortnight of credits.",
  },
  {
    label: "No movement detected",
    body: "A parked lorry answers every check with yesterday's crossing. Once no crossing has arrived for the hours you allow, checking pauses instead of paying for the same answer.",
  },
  {
    label: "Portal not responding",
    body: "If the portal cannot answer for a number enough times in a row, checking pauses rather than paying a credit per error. Usually a typo in the number.",
  },
  {
    label: "No credits left",
    body: "An empty balance cannot pay for a check, so every truck that was live is paused at once rather than left on the list looking watched. Top up, then take the ones you still need live again.",
  },
];

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
 * Why THIS truck stopped, with its own numbers in it.
 *
 * PAUSE_COPY.detail explains the rule; this explains the instance. "No movement
 * detected" on a badge is a category, and the question it provokes is always
 * "detected for how long?" - a question the row already has the answer to. So
 * the (i) beside the badge says "no toll crossing arrived for 8 hours" rather
 * than repeating the paragraph the truck's own page carries.
 *
 * The failure count comes from consecutive_errors rather than from the truck's
 * budget, because it is the number that actually happened: the worker leaves the
 * counter standing when it pauses a truck, and the budget can be edited
 * afterwards - which would make this sentence describe a limit the truck never
 * hit.
 *
 * Null when there is nothing more specific to say than the badge already says,
 * so a caller can leave the (i) off entirely rather than open it onto a
 * restatement.
 */
export function pauseWhy(
  truck: Pick<
    TrackedTruck,
    | "is_active"
    | "paused_reason"
    | "consecutive_errors"
    | "inactive_pause_hours"
    | "last_event_at"
  >,
  settings: Pick<AppSettings, "inactivePauseHours">,
): string | null {
  if (truck.is_active) return null;

  switch (truck.paused_reason) {
    case "inactive": {
      const hours = resolveInactiveWindow(truck, settings);
      const window =
        hours === null
          ? "long enough"
          : hours % 24 === 0 && hours >= 24
            ? `${hours / 24} day${hours === 24 ? "" : "s"}`
            : `${hours} hour${hours === 1 ? "" : "s"}`;
      return truck.last_event_at
        ? `Paused because no toll crossing was recorded for ${window}.`
        : `Paused because no toll crossing was ever recorded for it, for ${window}.`;
    }
    case "repeated_failures":
      return truck.consecutive_errors > 0
        ? `Paused because ${truck.consecutive_errors} checks in a row could not be answered for this number.`
        : "Paused because the portal could not answer for this number often enough in a row to reach its failure limit.";
    case "schedule":
      return "Paused because the end time you set for it has passed.";
    case "account_suspended":
      return "Paused because this account is suspended — every truck on it is stopped.";
    /* The instance fact worth adding for both of the account-wide stops is
       that it was not this lorry: nothing about this number failed, and every
       other truck that was live stopped in the same moment. Without that, an
       officer reads a per-truck fault into an account-wide one and starts
       checking the registration number. */
    case "no_credits":
      return "Paused because the balance ran out — every truck that was live stopped at the same moment, and none of them is spending anything now.";
    case "plan_expired":
      return "Paused because the plan ended and the days to renew in have passed — every truck on the account was switched off together.";
    default:
      return null;
  }
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
