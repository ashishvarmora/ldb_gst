import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditPack, CreditRate, CreditVerdict, Plan } from "@/lib/types";

/**
 * One balance pays for everything.
 *
 * There used to be two allowances - manual searches per day, tracking queries
 * per month - and an officer had to hold both in their head to know whether a
 * search would work. Now there is a single number, and the admin sets what
 * each action draws from it.
 *
 * Rates are stored as "how many of this action one credit buys", because that
 * is how they are spoken and written: "1 credit = 1 search", "1 credit = 2
 * automatic checks". The cost per action is the reciprocal.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Actions the platform charges for. Adding one is a row in credit_rates. */
export const CREDIT_ACTIONS = {
  manualSearch: "manual_search",
  autoCheck: "auto_check",
} as const;

export type CreditAction = (typeof CREDIT_ACTIONS)[keyof typeof CREDIT_ACTIONS];

/** Cost in credits of doing `count` of an action at the given rate. */
export function costOf(unitsPerCredit: number, count = 1): number {
  if (!Number.isFinite(unitsPerCredit) || unitsPerCredit <= 0) return count;
  // Rounded up to the paisa, matching spend_credits() in the database. A
  // part-used credit is a used credit.
  return Math.ceil((count / unitsPerCredit) * 100) / 100;
}

/** "1 credit = 2 checks", or "2 credits = 1 check" when a rate is below one. */
export function describeRate(rate: Pick<CreditRate, "units_per_credit">): string {
  const units = rate.units_per_credit;
  if (units >= 1) {
    return `1 credit = ${formatCredits(units)} ${units === 1 ? "use" : "uses"}`;
  }
  return `${formatCredits(1 / units)} credits = 1 use`;
}

/** Credits read better without trailing zeros: 12, 12.5, 0.25. */
export function formatCredits(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "0";
  const n = Number(value);
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

/* -------------------------------------------------------------------------- */
/* when a balance is worth mentioning                                          */
/* -------------------------------------------------------------------------- */

/**
 * How many manual searches' worth of credit counts as running low.
 *
 * A bare number would be a lie here. The admin sets what an action draws from
 * the balance, so 100 credits is nearly empty on an account where a search
 * costs 40 and months of work on one where it costs 1 - and the rate is edited
 * in the console without anybody redeploying this file. So "low" is measured in
 * work, and the number of credits it corresponds to is worked out per account
 * from the rate in force.
 *
 * Five is one sitting: enough to notice before the next tap is refused, few
 * enough that it is not warning somebody with a fortnight of credit left.
 *
 * STILL MEASURED IN SEARCHES, and 0041 makes that a choice rather than the only
 * option. Automatic checks cost a credit again, so a balance could now be
 * quoted in those too - and it would be a worse number, not a better one. A
 * truck on the default fifteen-minute beat is 96 checks a day, so any balance
 * worth having is "under a day of tracking" and any balance under a hundred is
 * "none", which would put an alarm on every screen permanently. Worse, the
 * figure would depend on how many trucks are switched on, which this function
 * is not told.
 *
 * A search is the unit the officer controls one tap at a time, so it is the one
 * where "five left" is a fact they can act on. What tracking is costing is a
 * different question and belongs where the trucks are.
 */
export const LOW_CREDIT_SEARCHES = 5;

/**
 * Which of the three things a balance can be saying.
 *
 * "empty" is not a stronger "low": it is a different fact. Low is a nudge with
 * work left in it, empty means the next search is already being refused.
 */
export type CreditStanding = "ok" | "low" | "empty";

/**
 * Where a nudge sends somebody: the top-up panel on the plan page, not the top
 * of it. The panel carries id="topup" and is never folded away.
 *
 * Both branches of that page render it - with a plan and without one. That is
 * load-bearing rather than tidy: this is the only destination any nudge uses,
 * and a lapsed account is now one of the accounts that can be nudged.
 */
export const TOPUP_HREF = "/portal/plan#topup";

/** Guards a rate that has gone missing, the way costOf() does. */
function perSearch(searchCost: number): number {
  return Number.isFinite(searchCost) && searchCost > 0 ? searchCost : 1;
}

/** The balance below which a top-up link appears, at today's search rate. */
export function lowCreditFloor(searchCost: number): number {
  return perSearch(searchCost) * LOW_CREDIT_SEARCHES;
}

/** Whole searches the balance still covers. Rounded down - a part is none. */
export function searchesLeft(credits: number, searchCost: number): number {
  return Math.floor(Math.max(Number(credits) || 0, 0) / perSearch(searchCost));
}

export function creditStanding(credits: number, searchCost: number): CreditStanding {
  const balance = Number(credits);

  /*
   * Written as !(> 0) so a null or a NaN balance reads as empty rather than
   * slipping through as healthy.
   *
   * Anything under the price of one search is empty too, not low. A balance of
   * 1 where a search costs 2 is a blocker however encouraging the number looks
   * - spend_credits() is going to refuse the next one - and rates above one
   * credit per search are exactly what makes that reachable.
   */
  if (!(balance > 0) || balance < perSearch(searchCost)) return "empty";
  return balance < lowCreditFloor(searchCost) ? "low" : "ok";
}

/**
 * The balance in the unit that decides anything: searches. "12 credits left"
 * only answers the question if you also know the rate, and nobody does.
 *
 * A lowercase fragment, so the one phrasing works as a line of its own after
 * "Only" and in the middle of a sentence. Takes the count rather than the
 * balance because the account sheet is a Client Component and is handed the
 * count already worked out.
 */
export function searchesLeftLabel(left: number): string {
  // Only ever reached for a "low" balance, where at least one search is
  // affordable. The zero case is a fallback, not a state anything renders.
  if (left <= 0) return "nothing left to search with";
  if (left === 1) return "one more search";
  return `about ${left.toLocaleString("en-IN")} more searches`;
}

export async function loadCreditRates(admin: Admin): Promise<CreditRate[]> {
  const { data } = await admin.from("credit_rates").select("*").order("action");
  return (data ?? []) as CreditRate[];
}

export async function loadRate(admin: Admin, action: CreditAction): Promise<number> {
  const { data } = await admin
    .from("credit_rates")
    .select("units_per_credit")
    .eq("action", action)
    .maybeSingle<{ units_per_credit: number }>();
  return data?.units_per_credit ?? 1;
}

/**
 * Debits the officer's balance for one action.
 *
 * The whole check-and-decrement happens inside spend_credits(), under a row
 * lock, so two tabs cannot both spend the last credit.
 */
export async function spendCredits({
  admin,
  userId,
  action,
  count = 1,
  truckNumber,
}: {
  admin: Admin;
  userId: string;
  action: CreditAction;
  count?: number;
  truckNumber?: string | null;
}): Promise<CreditVerdict> {
  const { data, error } = await admin.rpc("spend_credits", {
    p_user: userId,
    p_action: action,
    p_count: count,
    p_truck: truckNumber ?? null,
  });

  if (error) return { allowed: false, reason: "unknown_action" };
  return (data ?? { allowed: false }) as CreditVerdict;
}

/** Plain-language version of a refusal, for a form or an alert log. */
export function creditRefusalMessage(verdict: CreditVerdict): string {
  switch (verdict.reason) {
    case "out_of_credits":
      return `Not enough credits. This needs ${formatCredits(verdict.cost ?? 0)} and you have ${formatCredits(verdict.balance ?? 0)}.`;
    case "account_suspended":
      return "This account has been suspended. Contact support if you think that is wrong.";
    case "trial_ended":
      /*
       * Says what ended and what to do, and deliberately does not quote the
       * leftover balance. Those credits are not coming back - the trial was
       * free and it is over - so printing "you still have 14" alongside a
       * refusal reads as a fault to report rather than a trial that finished.
       */
      return "Your free trial has ended, so its credits have finished with it. Choose a plan or top up to carry on.";
    case "unknown_action":
      return "That is not something this account can be charged for yet. Contact support.";
    default:
      return "That could not be completed. Contact support if it keeps happening.";
  }
}

/** Adds credits. The only way a balance goes up. */
export async function grantCredits({
  admin,
  userId,
  amount,
  reason = "admin_topup",
  actorId,
  note,
}: {
  admin: Admin;
  userId: string;
  amount: number;
  reason?: string;
  actorId?: string | null;
  note?: string | null;
}): Promise<{ ok: boolean; balance?: number; error?: string }> {
  /*
   * Refused here rather than left to the database, because of how far it gets
   * before anything stops it.
   *
   * JSON has no NaN and no Infinity, so a non-finite amount is serialised as
   * null on the way out. grant_credits then evaluates `p_amount = 0` as NULL
   * rather than false, falls straight through its own zero guard, and computes
   * `greatest(credits + null, 0)` - which is greatest(null, 0), which is zero.
   * The balance is set to nothing.
   *
   * What saves the account is two statements later and entirely by luck:
   * credit_transactions.delta is NOT NULL, so the ledger insert raises and the
   * whole function rolls back. Tested against the live database - the balance
   * survives, and the aborted row shows balance_after = 0.00, which is what the
   * update had already worked out. So the balance is protected by a constraint
   * on a different table, and the caller gets a constraint violation instead of
   * an answer. Both are worth fixing here.
   *
   * Negative amounts are deliberately still allowed. An administrator
   * correcting a mistaken grant is the reason admin_adjust exists, and that
   * correction is a negative delta.
   */
  if (!Number.isFinite(amount)) {
    return { ok: false, error: "That is not a number of credits." };
  }

  const { data, error } = await admin.rpc("grant_credits", {
    p_user: userId,
    p_amount: amount,
    p_reason: reason,
    p_actor: actorId ?? null,
    p_note: note ?? null,
  });

  if (error) return { ok: false, error: error.message };
  const result = (data ?? {}) as { ok?: boolean; balance?: number; reason?: string };
  return result.ok
    ? { ok: true, balance: result.balance }
    : { ok: false, error: result.reason ?? "Could not add credits." };
}

/** How a ledger row reads in the officer's history. */
export const CREDIT_REASON_LABEL: Record<string, string> = {
  manual_search: "Manual search",
  auto_check: "Automatic check",
  admin_topup: "Added by administrator",
  admin_adjust: "Adjusted by administrator",
  purchase: "Purchased",
  signup_bonus: "Free credits on sign-up",
  coupon_bonus: "Credit code redeemed",
  plan_grant: "Included with plan",
  // Written by start_free_trial(). Classified as 'free' by credit_source(), so
  // the admin's credit economy report counts it as a giveaway rather than
  // filing it under "other".
  trial_grant: "Free trial credits",
  // Written by reward_referral(). Without these two the credit history shows a
  // column value to a customer, which is the one place a raw reason leaks out.
  referral: "Referral reward",
  referral_milestone: "Referral bonus",
  // The invitee's own share of their first payment - the other half of a
  // referral. Its own reason so the giveaway report can split the scheme's
  // cost between the person who shared and the person who joined.
  referral_welcome: "Welcome bonus",
};

/* -------------------------------------------------------------------------- */
/* buying credits                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Rupees per credit for a pack, so two rungs can be compared at a glance.
 * Lower is better value, which is what the larger rungs are for.
 */
export function rupeesPerCredit(pack: Pick<CreditPack, "price_inr" | "credits">): number {
  if (!pack.credits) return 0;
  return pack.price_inr / pack.credits;
}

/**
 * How much better value a pack is than the cheapest rung, as a percentage.
 * Derived rather than stored, so it can never disagree with the prices it
 * describes.
 *
 * Not to be confused with credit_percent on the pack itself: that is a stored
 * rate the admin sets for an open tier, this is a comparison between rungs.
 */
export function bonusPercent(pack: CreditPack, baseline: CreditPack | undefined): number {
  if (!baseline) return 0;
  const base = rupeesPerCredit(baseline);
  const mine = rupeesPerCredit(pack);
  if (!base || !mine) return 0;
  return Math.round((base / mine - 1) * 100);
}

export async function loadCreditPacks(admin: Admin, onlyActive = true): Promise<CreditPack[]> {
  let query = admin.from("credit_packs").select("*").order("sort_order").order("price_inr");
  if (onlyActive) query = query.eq("is_active", true);
  const { data } = await query;
  return (data ?? []) as CreditPack[];
}

/**
 * What a given number of rupees buys on a pack.
 *
 * Mirrors credits_for_amount() in the database, which is the authority - the
 * server recomputes this before charging anyone, so a tampered form cannot buy
 * credits cheaply. This copy exists so the buyer and the admin can see the
 * number update as they type, without a round trip per keystroke.
 *
 * Returns null when the amount is below an open tier's minimum, which is the
 * one case where there is nothing to sell.
 */
export function creditsForAmount(
  pack: Pick<CreditPack, "is_open_ended" | "price_inr" | "credits" | "credit_percent">,
  amountInr: number,
  creditsPerRupee: number,
): number | null {
  if (!pack.is_open_ended) return pack.credits;
  if (!Number.isFinite(amountInr) || amountInr < pack.price_inr) return null;
  // Rounded down, like the database: never hand over a fraction of a credit
  // that was not paid for.
  return Math.floor(amountInr * (creditsPerRupee || 1) * (pack.credit_percent || 100) / 100);
}

/* -------------------------------------------------------------------------- */
/* what a plan costs, and for how long                                         */
/* -------------------------------------------------------------------------- */

/**
 * A plan's term, and what buying it actually charges.
 *
 * Both live here rather than in each screen because four of them have to agree
 * exactly: the public pricing page, the admin's preview, the plan card a
 * customer decides on, and the order the checkout opens.
 *
 * price_inr is the WHOLE price and it is charged ONCE - there is nothing to
 * multiply it by. Until 0042 the column was called price_per_month and the
 * checkout took it times duration_months, which was 1 everywhere; the sum was
 * always right and every screen that printed "a month" underneath it was
 * wrong. duration_days is the term, and the only term.
 */
export type PlanTerm = Pick<Plan, "price_inr"> &
  Partial<Pick<Plan, "duration_days" | "trial_days" | "is_trial">>;

/**
 * Days the plan runs for, or null for no expiry.
 *
 * The trial's days live in their own column - start_free_trial() reads
 * trial_days, and 0035 keeps days and months on separate sides of a check
 * constraint so "7" can never be read as seven months. Both are read here so
 * one function answers "how long is this plan" for every row on the grid.
 */
export function planDays(plan: PlanTerm): number | null {
  const days = plan.is_trial ? (plan.trial_days ?? plan.duration_days) : plan.duration_days;
  return typeof days === "number" && Number.isFinite(days) && days > 0 ? days : null;
}

/**
 * Rupees taken at the checkout. The plan's price, and nothing times anything.
 *
 * Kept as a function rather than reading plan.price_inr at each call site so
 * there stays exactly one answer to "what does this cost" - and so the paise
 * rounding a numeric(10,2) column can carry is done once.
 */
export function planChargeInr(plan: PlanTerm): number {
  return Math.round(plan.price_inr * 100) / 100;
}

/**
 * THE one place a plan's term is put into words. "7 days" · "1 month" ·
 * "3 months" · "No expiry".
 *
 * The owner asks for the term as months - "plan expire after X month from
 * start" - and duration_days is what the database actually adds, so months are
 * computed from days here and nowhere else. Whole months where the days divide
 * evenly, because "90 days" is a figure to work out and "3 months" is one to
 * recognise; days where they do not, because the seven-day trial is not a
 * fraction of a month and rounding it would be a lie.
 *
 * Every screen goes through this or through one of the two wrappers below. The
 * bug this replaced was each card doing its own arithmetic on duration_months,
 * which is why a ninety-day plan said "1 month" in four different places.
 */
export function planTermLabel(plan: PlanTerm): string {
  const days = planDays(plan);
  if (days === null) return "No expiry";
  if (days % 30 === 0) {
    const months = days / 30;
    return months === 1 ? "1 month" : `${months} months`;
  }
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * The term as it reads under a price. Lower case, so it sits after a figure:
 * "Rs 999 for 3 months", "Rs 199 once - the plan never expires".
 */
export function planTermSuffix(plan: PlanTerm): string {
  if (planDays(plan) === null) return "once - the plan never expires";
  return `for ${planTermLabel(plan).toLowerCase()}`;
}

/**
 * The term as a whole sentence, in the owner's words: "Expires 3 months after
 * the day it starts".
 *
 * The plan cards, the admin preview and the admin plan form all had their own
 * phrasing of this and all three read duration_months to build it, so all three
 * said "1 month" about ninety days. One sentence, one source.
 */
export function planExpiryNote(plan: PlanTerm): string {
  const days = planDays(plan);
  if (days === null) return "Never expires — one payment, no end date";
  return `Expires ${planTermLabel(plan).toLowerCase()} after the day it starts`;
}

/** "250% of what you pay" - the open tier stated as a sentence. */
export function describeOpenTier(pack: CreditPack, creditsPerRupee: number): string {
  // Both halves of the sum, because either alone is misleading: the percentage
  // means nothing without the base rate, and the rate hides the tier's value.
  const each = ((creditsPerRupee || 1) * (pack.credit_percent || 100)) / 100;
  return `${formatCredits(pack.credit_percent)}% credit — Rs 1 buys ${formatCredits(each)} credit${each === 1 ? "" : "s"}`;
}
