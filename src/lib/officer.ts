import { cache } from "react";
import { redirect } from "next/navigation";

import { getSessionUser, type SessionUser } from "@/lib/auth";
import { CREDIT_ACTIONS, costOf, loadRate } from "@/lib/credits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview } from "@/lib/types";

export type PortalSession = SessionUser & { overview: OfficerOverview };

/**
 * What one manual search costs this account today, in credits.
 *
 * Lives here rather than in credits.ts because a Client Component imports that
 * file for formatCredits(), and the service-role client must not follow it into
 * a browser bundle.
 *
 * Cached per request: the layout shows the balance on every page and the page
 * under it usually shows it again, so both read the same rate off one query.
 */
export const loadSearchCost = cache(async (): Promise<number> => {
  return costOf(await loadRate(getSupabaseAdmin(), CREDIT_ACTIONS.manualSearch));
});

/**
 * What one AUTOMATIC check costs this account today, in credits.
 *
 * Its own loader rather than reusing the search cost, because they are two
 * rows an admin edits separately on the rate screen. They happen to be equal
 * today - both one credit since 0041 - and reading one for the other would be
 * a bug the day somebody changes either, which is a change that takes no
 * deploy and leaves no trace in this file.
 *
 * Wanted wherever a screen has to answer "would taking a truck live actually
 * work", which is a question about this rate and not about the search rate.
 */
export const loadAutoCheckCost = cache(async (): Promise<number> => {
  return costOf(await loadRate(getSupabaseAdmin(), CREDIT_ACTIONS.autoCheck));
});

/**
 * Gate for everything under /portal. Any active account can use the officer
 * dashboard, including the super admin — handy for testing a plan before you
 * hand it to a real officer.
 */
export const requirePortalSession = cache(async (): Promise<PortalSession> => {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.profile.status !== "active") redirect("/no-access?reason=suspended");

  const overview = await loadOverview(session.id);
  if (!overview) redirect("/no-access");
  return { ...session, overview };
});

/** Same check for Server Actions: returns an error instead of redirecting. */
export async function assertPortalUser(): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session) throw new Error("Please sign in again.");
  if (session.profile.status !== "active") {
    throw new Error("This account has been suspended. Contact support if you think that is wrong.");
  }
  return session;
}

/**
 * Effective limits + current consumption, for quota checks inside actions.
 *
 * Cached per request and keyed on the id, so the portal gate, a page that wants
 * the balance and an action checking a quota share one read. officer_overview
 * is a view over four tables; asking for it three times in one render was three
 * trans-Pacific round trips for an answer that cannot change mid-request.
 */
export const loadOverview = cache(async (userId: string): Promise<OfficerOverview | null> => {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("officer_overview")
    .select("*")
    .eq("id", userId)
    .maybeSingle<OfficerOverview>();
  return data ?? null;
});

/**
 * Days after a plan ends before its trucks are actually switched off.
 *
 * The mirror of plan_grace_days() in 0038, and it has to stay the mirror: the
 * database tears tracking down on this number and the portal promises it, so
 * two different sevens would be a promise one half could break.
 */
export const PLAN_GRACE_DAYS = 7;

/**
 * True when the free trial has ended and nothing has been bought since.
 *
 * The one account state where a balance exists and cannot be spent. A trial is
 * not a purchase - "only free trial expire all" - so when the seventh day
 * passes its credits finish with it.
 *
 * The `credits_purchased` escape is the same escape spend_credits() makes, and
 * for the same reason: the top-up panel is open to lapsed accounts on purpose,
 * and freezing credits somebody has just paid for would be taking their money.
 * The database tests "has this account any paid payment"; this tests the sum of
 * its 'purchase' ledger rows, which officer_overview already carries and which
 * is non-zero for exactly those accounts. Two readings of one rule, but only
 * this one is load-bearing on a screen - spend_credits() is what enforces it,
 * and it reads payments directly.
 */
export function trialSpentOut(overview: OfficerOverview): boolean {
  return overview.plan_is_trial && !overview.plan_active && overview.credits_purchased <= 0;
}

/**
 * Plain-language reason a MANUAL SEARCH would be refused, or null when it is
 * fine.
 *
 * NOT GATED ON THE PLAN, and that is the point of the change 0038 made and
 * 0041 keeps. Credits are a lifetime wallet: they are bought outright, they
 * never expire, and what they buy is manual search. Refusing a search because
 * a subscription lapsed would be confiscating something already paid for - and
 * it was the old behaviour, so an account with 440 credits and a finished plan
 * could not spend a single one of them.
 *
 * THE FREE TRIAL IS THE EXCEPTION, and the only one. It is checked before the
 * balance because it is the stronger fact: an ended trial with 14 credits left
 * would otherwise be told it has plenty and then refused at the tap.
 *
 * The balance itself is still not checked beyond empty: spend_credits() decides
 * affordability atomically at the moment of spending, and duplicating the test
 * would only add a second answer free to disagree with it. What is checked here
 * is what a screen can usefully say in advance.
 */
export function blockedReason(overview: OfficerOverview): string | null {
  if (trialSpentOut(overview)) {
    /* "or top up" was the way out until a top-up needed a plan, and this is
       the exact account it is now refused to - a finished trial that has
       bought nothing. Offering it would send them to a shop that turns them
       away. A plan is the one door left, and it can carry credits in the same
       payment. */
    return "Your free trial has ended, so its credits have finished with it. Choose a plan to carry on — a plan can bring credits with it.";
  }
  if (overview.credits <= 0) {
    return "You have run out of credits. Top up on the Plan and credits page.";
  }
  return null;
}

/**
 * Why a CREDIT TOP-UP cannot be bought, or null when it can.
 *
 * The owner has reversed the rule that let anyone buy credits: "there is Plan
 * must be needed for topup (if already have a plan then perfect !!) credit is
 * never expired". A top-up is an add-on to a plan again, not a product of its
 * own.
 *
 * Lives here rather than in the checkout action because two callers need the
 * same answer - startCheckout() refuses the sale, and the plan page has to say
 * so BEFORE the tap - and a "use server" module cannot export a plain function
 * for a page to import. Two copies of a money rule is how the two halves of a
 * screen end up disagreeing.
 *
 * A LAPSED PLAN COUNTS. The gate exists to stop somebody buying ten thousand
 * never-expiring credits, running manual search off them forever and never
 * paying for a plan at all - and a customer who has already bought a plan is
 * not that person. Their balance is spendable with no plan (blockedReason above
 * does not test one), so refusing them more of it would be refusing money for
 * a thing that works, and it would put a "buy a plan first" wall in front of
 * the customer most likely to come back.
 *
 * A LIVE TRIAL COUNTS. It is a plan row, it grants access, and the plan page
 * already offers a trial customer a top-up and explains what it does and does
 * not change ("Your trial still ends on ..."). Refusing it would break a screen
 * that was written on purpose.
 *
 * A FINISHED TRIAL DOES NOT, and that is the whole reason this is not simply
 * "has ever held a plan". A free trial that counted forever would reopen the
 * leak through the front door: take the trial, let it lapse, top up for life.
 * It is also the one account whose wallet is frozen (trialSpentOut), so the
 * route out is buying a plan - which is exactly where the owner wants it.
 *
 * NOT tested: credits_purchased. An account that bought credits during the
 * window when this gate was open would be refused more of them, which is a real
 * if theoretical unfairness - there are no payments at all in the live database
 * today, so nobody is in that state, and grandfathering an empty set would only
 * hand back the leak.
 *
 * A SUSPENDED account with a paid plan reads as holding one here. It cannot
 * reach this: assertPortalUser() throws and the portal gate redirects before
 * any of it runs, so adding status to the test would be a second answer to a
 * question already settled upstream.
 */
export function topUpBlockedReason(
  overview: Pick<OfficerOverview, "plan_active" | "plan_id" | "plan_is_trial">,
): string | null {
  /* Kept to one line, between these markers, because the gate check in
     .tmpwork pulls this expression straight out of this file and evaluates it
     against live officer_overview rows - so the proof tests the shipped rule
     rather than a copy of it that is free to drift. */
  // gate:begin
  const holdsPlan = overview.plan_active || (overview.plan_id !== null && !overview.plan_is_trial);
  // gate:end
  if (holdsPlan) return null;

  return (
    "Credits top up an account that has a plan. Pick a plan above — you can add credits to " +
    "the same payment, and credits you buy never expire."
  );
}

/**
 * Why TAKING A TRUCK LIVE would not hold, or null when it would.
 *
 * The other side of the empty-balance auto-pause. The worker asks
 * spend_credits() for a credit before every check, so a truck switched back on
 * with nothing in the wallet is refused and paused again on the next sweep -
 * the switch moves, fifteen minutes pass, and it moves back with no
 * explanation in between. That is the exact failure the officer reads as "the
 * button is broken", so the refusal has to be on the screen before the tap
 * rather than discovered a quarter of an hour later.
 *
 * NOT the same test as blockedReason(). That one is about spending the balance
 * on a search the officer is about to run once; this is about committing the
 * account to a check every few minutes, and it is priced off a different rate
 * row. They will usually agree, and they are allowed to stop agreeing.
 *
 * Takes the cost rather than looking it up, so it stays a pure function that
 * an action, a page or a test can call with today's rate - and so the caller
 * decides how often the rate is read. loadAutoCheckCost() is the reader.
 */
export function liveBlockedByCredits(
  overview: Pick<OfficerOverview, "credits">,
  autoCheckCost: number,
): string | null {
  /*
   * A rate of zero or less still means "included in the plan": spend_credits()
   * allows the check, charges nothing and deliberately never reads the balance.
   * An empty wallet must not block tracking then, or an admin who made
   * checking free would find it refused the moment somebody spent their last
   * credit. Dormant today - the rate is 1 - and it is the whole reason this
   * takes the cost instead of testing `credits <= 0`.
   */
  if (!(autoCheckCost > 0)) return null;

  /*
   * Written as `>=` so a null or NaN balance fails it and reads as blocked,
   * the same way creditStanding() is written. And it compares against the COST
   * rather than zero, because a balance of 1 where a check costs 2 is just as
   * refused - which is reachable the moment an admin rates a check above one
   * credit.
   */
  if (Number(overview.credits) >= autoCheckCost) return null;

  return (
    "Your balance does not cover one automatic check, so a truck taken live now would be " +
    "refused at its very next check and paused again. Top up on the Plan and credits page first."
  );
}

/**
 * Why automatic tracking is not running, or null when it is.
 *
 * The other half of the split. Tracking is the subscription: it needs a plan
 * that has not ended, and it stops the day the plan does. Nothing is deleted
 * when it stops - see the grace period below - so this is written as a pause
 * with a way back, not as a loss.
 */
export function trackingBlockedReason(overview: OfficerOverview): string | null {
  if (overview.plan_active) return null;

  const days = graceDaysLeft(overview);
  if (days === null) {
    return "Automatic checking needs a plan. Manual search still works, and your credits are safe.";
  }
  if (days > 0) {
    return (
      `Your plan ended on ${overview.plan_expires_on}, so automatic checking and alerts have ` +
      `paused. Your trucks are still here - renew within ${days} ${days === 1 ? "day" : "days"} ` +
      "and everything carries on exactly where it stopped."
    );
  }
  return (
    `Your plan ended on ${overview.plan_expires_on} and your trucks have been switched off. ` +
    "Nothing has been deleted - renew and switch them back on from My trucks."
  );
}

/**
 * Days left to renew before the trucks are switched off, or null when there is
 * no lapsed plan to count from.
 *
 * Null covers two different accounts that need the same answer here: one that
 * has never had a plan, and one whose plan has no expiry at all - which is the
 * state both founding customers are in, and they must never be counted down.
 */
export function graceDaysLeft(overview: OfficerOverview): number | null {
  const expires = overview.plan_expires_on;
  if (!expires) return null;
  const end = new Date(`${expires}T23:59:59+05:30`).getTime();
  if (Number.isNaN(end) || end >= Date.now()) return null;
  const gone = Math.floor((Date.now() - end) / 86_400_000);
  return Math.max(PLAN_GRACE_DAYS - gone, 0);
}

/**
 * Tracking slots still free. The plan's cap on trucks watched AT ONCE, minus
 * the ones already being watched - truck_limit is the column, tracking_slots
 * is the word for it.
 */
export function truckSlotsLeft(overview: OfficerOverview): number {
  if (overview.truck_limit === -1) return Number.POSITIVE_INFINITY;
  return Math.max(overview.truck_limit - overview.active_trucks, 0);
}
