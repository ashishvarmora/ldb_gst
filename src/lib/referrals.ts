import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Referral, ReferralSummary } from "@/lib/types";

/**
 * Refer someone, and earn when they actually pay.
 *
 * The whole scheme turns on one rule: a referral is worth nothing until the
 * person referred makes their first payment. Sign-ups cost nothing to
 * manufacture, so paying for them would be paying for noise.
 *
 * The money is moved by reward_referral() in the database, called from inside
 * settle_payment - one path from "money arrived" to "everyone owed was paid",
 * and idempotent, so a webhook delivered twice pays once.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** The link someone shares. */
export function referralLink(siteUrl: string, code: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/signup?ref=${encodeURIComponent(code)}`;
}

export async function loadReferralSummary(
  admin: Admin,
  userId: string,
): Promise<ReferralSummary | null> {
  const { data } = await admin
    .from("referral_summary")
    .select("*")
    .eq("referrer_id", userId)
    .maybeSingle<ReferralSummary>();
  return data ?? null;
}

/** Everyone this person invited, newest first, with how each one is doing. */
export async function loadReferrals(admin: Admin, userId: string): Promise<Referral[]> {
  const { data } = await admin
    .from("referrals")
    .select("*, referred:profiles!referrals_referred_id_fkey(email, full_name, created_at)")
    .eq("referrer_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as Referral[];
}

/**
 * Resolves a referral code at sign-up. Returns the referrer's id, or null when
 * the code is unknown - a bad code must never block a registration, it just
 * earns nobody anything.
 */
export async function resolveReferralCode(
  admin: Admin,
  code: string | null | undefined,
): Promise<string | null> {
  const trimmed = code?.trim().toUpperCase();
  if (!trimmed) return null;
  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("referral_code", trimmed)
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/**
 * Records the referral. Deliberately separate from account creation, and
 * deliberately swallowing its own errors: the account is what matters, the
 * attribution is not, and a failed insert here must never fail a sign-up.
 *
 * WHY A REFERRAL RING CANNOT FORM, which is worth writing down because it is a
 * property of WHERE this is called from rather than of anything it checks:
 * this runs once, during sign-up, for an account that did not exist a moment
 * ago. A and B can only refer each other if each was invited by the other, and
 * the second of those invitations would have to be attached to an account that
 * already existed. Add a way to set a referrer after sign-up - an admin field,
 * a "who invited you?" prompt on the settings page - and rings become possible
 * immediately, at which point this needs a real cycle check and not just the
 * self-referral guard below.
 */
export async function attachReferral(
  admin: Admin,
  referrerId: string,
  referredId: string,
): Promise<void> {
  if (referrerId === referredId) return;

  const { error } = await admin
    .from("referrals")
    .insert({ referrer_id: referrerId, referred_id: referredId });

  // A duplicate means someone already referred them. First claim wins.
  if (error && !/duplicate key|unique/i.test(error.message)) {
    console.error("attachReferral failed", error.message);
    return;
  }

  await admin.from("profiles").update({ referred_by: referrerId }).eq("id", referredId);
}

/** "10% of what they spend first, plus 500 credits at 5 referrals." */
export function describeReferralReward(
  percent: number,
  milestoneCount: number,
  milestoneBonus: number,
): string {
  const base = `${percent}% of what they spend first, as credits`;
  if (milestoneCount <= 0 || milestoneBonus <= 0) return `${base}.`;
  return `${base} — plus ${milestoneBonus.toLocaleString("en-IN")} credits once ${milestoneCount} of them have paid.`;
}
