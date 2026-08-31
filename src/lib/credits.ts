import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditPack, CreditRate, CreditVerdict } from "@/lib/types";

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
  plan_grant: "Included with plan",
  // Written by reward_referral(). Without these two the credit history shows a
  // column value to a customer, which is the one place a raw reason leaks out.
  referral: "Referral reward",
  referral_milestone: "Referral bonus",
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

/** "250% of what you pay" - the open tier stated as a sentence. */
export function describeOpenTier(pack: CreditPack, creditsPerRupee: number): string {
  // Both halves of the sum, because either alone is misleading: the percentage
  // means nothing without the base rate, and the rate hides the tier's value.
  const each = ((creditsPerRupee || 1) * (pack.credit_percent || 100)) / 100;
  return `${formatCredits(pack.credit_percent)}% credit — Rs 1 buys ${formatCredits(each)} credit${each === 1 ? "" : "s"}`;
}
