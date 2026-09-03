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

/**
 * A referral row with the two-event columns 0040 added.
 *
 * Declared here rather than widened in lib/types, which is a shared surface
 * several features are changing at once. Referral stays the shape everything
 * else reads; this is the extra that only the referral screens ask for.
 *
 * The timestamps are the authority on whether an event has paid - a null
 * amount means "settled under the old percentage scheme, where the split
 * between the two events is not knowable", not "paid nothing".
 */
export type ReferralRow = Referral & {
  welcome_credits: number | null;
  plan_rewarded_at: string | null;
  topup_rewarded_at: string | null;
  plan_referrer_credits: number | null;
  plan_invitee_credits: number | null;
  topup_referrer_credits: number | null;
  topup_invitee_credits: number | null;
};

/** Everyone this person invited, newest first, with how each one is doing. */
export async function loadReferrals(admin: Admin, userId: string): Promise<ReferralRow[]> {
  const { data } = await admin
    .from("referrals")
    .select("*, referred:profiles!referrals_referred_id_fkey(email, full_name, created_at)")
    .eq("referrer_id", userId)
    .order("created_at", { ascending: false });
  return (data ?? []) as ReferralRow[];
}

/**
 * How far through its two events a referral is. One word, because a row on a
 * phone has space for a badge and not for two.
 */
export function referralStage(row: ReferralRow): "waiting" | "plan" | "topup" | "both" {
  const plan = row.plan_rewarded_at !== null;
  const topup = row.topup_rewarded_at !== null;
  if (plan && topup) return "both";
  if (plan) return "plan";
  if (topup) return "topup";
  return "waiting";
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

/* -------------------------------------------------------------------------- */
/* the terms                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What a referral pays, on each of its two events.
 *
 * FIXED CREDITS, NOT PERCENTAGES, AND WHY THERE ARE TWO EVENTS. A percentage
 * of a first payment is a number nobody can picture before they earn it, and
 * under the old one-event scheme the whole job was done the moment an invited
 * account bought the cheapest plan on the list. So: two events, each paid once
 * per referral, with the larger amounts on the top-up - the point of the
 * scheme is an invited account that SPENDS, not one that merely registers.
 *
 * These four are read straight out of app_settings rather than through
 * loadSettings, deliberately: they belong to this scheme, they are read by
 * this scheme's four screens, and the settings object is a shared surface that
 * several features change at once.
 */
export type ReferralTerms = {
  planReferrer: number;
  planInvitee: number;
  topupReferrer: number;
  topupInvitee: number;
};

/** The seeded defaults, and the answer when a key has somehow gone missing. */
const TERM_DEFAULTS: ReferralTerms = {
  planReferrer: 50,
  planInvitee: 50,
  topupReferrer: 100,
  topupInvitee: 150,
};

export const REFERRAL_TERM_KEYS = {
  planReferrer: "referral_plan_referrer_credits",
  planInvitee: "referral_plan_invitee_credits",
  topupReferrer: "referral_topup_referrer_credits",
  topupInvitee: "referral_topup_invitee_credits",
} as const;

export async function loadReferralTerms(admin: Admin): Promise<ReferralTerms> {
  const { data } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", Object.values(REFERRAL_TERM_KEYS));

  const raw = new Map((data ?? []).map((row) => [row.key as string, row.value]));
  const read = (key: string, fallback: number): number => {
    const value = Number(raw.get(key));
    // A key that is absent, null or unparseable falls back to the default
    // rather than to zero: a reward that silently became "nothing" is the kind
    // of thing nobody notices until a referrer complains.
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };

  return {
    planReferrer: read(REFERRAL_TERM_KEYS.planReferrer, TERM_DEFAULTS.planReferrer),
    planInvitee: read(REFERRAL_TERM_KEYS.planInvitee, TERM_DEFAULTS.planInvitee),
    topupReferrer: read(REFERRAL_TERM_KEYS.topupReferrer, TERM_DEFAULTS.topupReferrer),
    topupInvitee: read(REFERRAL_TERM_KEYS.topupInvitee, TERM_DEFAULTS.topupInvitee),
  };
}

const credits = (n: number) => n.toLocaleString("en-IN");

/**
 * The referrer's side of the deal, in one sentence.
 * "50 credits when they buy a plan, 100 more when they first top up."
 *
 * The two events are named rather than summed. "150 credits per referral" is
 * shorter and is the wrong promise: half of it only arrives if the person
 * invited spends again, and a sentence that hides that sets up exactly the
 * complaint the referrals page then has to answer.
 */
export function describeReferralReward(
  terms: ReferralTerms,
  milestoneCount: number,
  milestoneBonus: number,
): string {
  const parts: string[] = [];
  if (terms.planReferrer > 0) parts.push(`${credits(terms.planReferrer)} credits when they buy a plan`);
  if (terms.topupReferrer > 0)
    parts.push(`${credits(terms.topupReferrer)} when they first top up`);

  const base = parts.length === 0 ? "Nothing is paid for an invite at the moment" : parts.join(", and ");
  if (milestoneCount <= 0 || milestoneBonus <= 0) return `${base}.`;
  return `${base} — plus ${credits(milestoneBonus)} credits once ${milestoneCount} of them have paid.`;
}

/**
 * The invitee's side, or null when both welcome amounts are switched off.
 *
 * Its own sentence rather than a clause bolted onto the one above, because the
 * two are said in different places to different people: the referrer reads
 * "what do I get" beside their link, the invited customer reads "what do I
 * get" at sign-up and at their first checkout, and a sentence that answers
 * both at once answers neither cleanly.
 */
export function describeWelcomeBonus(terms: ReferralTerms): string | null {
  const parts: string[] = [];
  if (terms.planInvitee > 0) parts.push(`${credits(terms.planInvitee)} credits on their first plan`);
  if (terms.topupInvitee > 0)
    parts.push(`${credits(terms.topupInvitee)} on their first top-up`);
  if (parts.length === 0) return null;
  return `They get ${parts.join(", and ")} — joining on an invite pays both of you.`;
}
