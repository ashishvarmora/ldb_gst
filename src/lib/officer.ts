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
    return "Your free trial has ended, so its credits have finished with it. Choose a plan or top up to carry on.";
  }
  if (overview.credits <= 0) {
    return "You have run out of credits. Top up on the Plan and credits page.";
  }
  return null;
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
