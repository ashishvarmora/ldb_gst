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
 * amount means "settled before 0040, where the split between the two events is
 * not knowable", not "paid nothing". A zero means something different again:
 * one payment closed both events, so the top-up event added nothing to a
 * payout already counted against the plan event.
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
 * What a referral pays, on each of its two events - as a PERCENTAGE of the
 * payment that closed the event.
 *
 * 0040 paid four fixed credit amounts here. The owner reversed that in 0043
 * and went back to percentages, keeping the two events: X per cent of the
 * payment to the inviter, Y per cent to the person invited, on the invitee's
 * first plan and again on their first top-up. Defaults 20 and 10.
 *
 * A percentage rather than a fixed amount because the reward now scales with
 * what the invited account actually spends - which is the behaviour the scheme
 * is buying - and because "20% back" is a promise a share button can carry
 * without quoting a credit price nobody outside the console knows.
 *
 * The percentage is taken of the RUPEES and handed over as credits directly.
 * credits_per_rupee is not in the sum: it prices the open-ended credit pack
 * and nothing else, so multiplying it in would move every referral reward the
 * day somebody re-priced that tier. 0043's header has the long version.
 *
 * These four are read straight out of app_settings rather than through
 * loadSettings, deliberately: they belong to this scheme, they are read by
 * this scheme's four screens, and the settings object is a shared surface that
 * several features change at once.
 */
export type ReferralTerms = {
  planReferrerPercent: number;
  planInviteePercent: number;
  topupReferrerPercent: number;
  topupInviteePercent: number;
};

/** The seeded defaults, and the answer when a key has somehow gone missing. */
const TERM_DEFAULTS: ReferralTerms = {
  planReferrerPercent: 20,
  planInviteePercent: 10,
  topupReferrerPercent: 20,
  topupInviteePercent: 10,
};

export const REFERRAL_TERM_KEYS = {
  planReferrerPercent: "referral_plan_referrer_percent",
  planInviteePercent: "referral_plan_invitee_percent",
  topupReferrerPercent: "referral_topup_referrer_percent",
  topupInviteePercent: "referral_topup_invitee_percent",
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
    planReferrerPercent: read(REFERRAL_TERM_KEYS.planReferrerPercent, TERM_DEFAULTS.planReferrerPercent),
    planInviteePercent: read(REFERRAL_TERM_KEYS.planInviteePercent, TERM_DEFAULTS.planInviteePercent),
    topupReferrerPercent: read(
      REFERRAL_TERM_KEYS.topupReferrerPercent,
      TERM_DEFAULTS.topupReferrerPercent,
    ),
    topupInviteePercent: read(REFERRAL_TERM_KEYS.topupInviteePercent, TERM_DEFAULTS.topupInviteePercent),
  };
}

const credits = (n: number) => n.toLocaleString("en-IN");

/**
 * A percentage as the screens say it: "20%", "12.5%", never "20.00%".
 *
 * Exported so the sentences below and the four screens that quote a single
 * percentage render it the same way. Two decimals because the setting stores
 * two; trailing zeros dropped because a whole number is what an admin typed.
 */
export function referralPercent(value: number): string {
  return `${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}%`;
}

const pct = referralPercent;

/**
 * A percentage of a payment, as whole credits.
 *
 * Math.round, matching reward_referral()'s round() exactly, so a worked
 * example on a page can never disagree with what the ledger paid. Rounded
 * rather than floored on purpose: 20% of 999 has to be the 200 the owner
 * quotes, not 199.
 */
export function referralCreditsFor(amountInr: number, percent: number): number {
  if (!Number.isFinite(amountInr) || !Number.isFinite(percent)) return 0;
  return Math.round((amountInr * percent) / 100);
}

/**
 * The owner's own worked example, and the reason it is here rather than typed
 * into each page: a percentage is a rule, and a rule is understood from one
 * instance of it. "20% of their first plan" is a calculation the reader has to
 * do; "a 999 rupee plan pays you 200" is the answer.
 *
 * The two amounts are the owner's - a 999 rupee plan and a 3,000 rupee first
 * top-up - and the credits are worked out from the LIVE percentages, so an
 * admin who edits the terms cannot leave a stale example on the customer's
 * page.
 */
export const REFERRAL_EXAMPLE = { planInr: 999, topupInr: 3000 } as const;

export type ReferralExample = {
  planInr: number;
  topupInr: number;
  planReferrer: number;
  planInvitee: number;
  topupReferrer: number;
  topupInvitee: number;
  referrerTotal: number;
  inviteeTotal: number;
  /** The same two purchases in ONE payment - see combinedInr below. */
  combinedInr: number;
  combinedReferrer: number;
  combinedInvitee: number;
};

export function referralExample(terms: ReferralTerms): ReferralExample {
  const { planInr, topupInr } = REFERRAL_EXAMPLE;
  const planReferrer = referralCreditsFor(planInr, terms.planReferrerPercent);
  const planInvitee = referralCreditsFor(planInr, terms.planInviteePercent);
  const topupReferrer = referralCreditsFor(topupInr, terms.topupReferrerPercent);
  const topupInvitee = referralCreditsFor(topupInr, terms.topupInviteePercent);

  /*
   * The combined checkout, which the database charges ONCE - reward_referral()
   * applies the plan event's percentages to the whole payment and closes both
   * events. Worked out here rather than added up from the two above, because
   * those two only sum to this when the plan and top-up percentages match. At
   * the defaults they do, and then the figures are identical whichever way the
   * customer buys - which is the point of charging it once.
   */
  const combinedInr = planInr + topupInr;

  return {
    planInr,
    topupInr,
    planReferrer,
    planInvitee,
    topupReferrer,
    topupInvitee,
    referrerTotal: planReferrer + topupReferrer,
    inviteeTotal: planInvitee + topupInvitee,
    combinedInr,
    combinedReferrer: referralCreditsFor(combinedInr, terms.planReferrerPercent),
    combinedInvitee: referralCreditsFor(combinedInr, terms.planInviteePercent),
  };
}

/**
 * The referrer's side of the deal, in one sentence.
 * "20% of what somebody you invite pays for their first plan and their first
 * top-up, back as credits."
 *
 * The two events are named rather than merged into "20% of what they spend".
 * The shorter version is the wrong promise: it stops after the first top-up,
 * and a sentence that hides that sets up exactly the complaint the referrals
 * page then has to answer. When the two percentages match - which they do by
 * default - one clause covers both, because two identical numbers in one
 * sentence read as a difference the reader then hunts for.
 */
export function describeReferralReward(
  terms: ReferralTerms,
  milestoneCount: number,
  milestoneBonus: number,
): string {
  const { planReferrerPercent: plan, topupReferrerPercent: topup } = terms;

  let base: string;
  if (plan <= 0 && topup <= 0) {
    base = "Nothing is paid for an invite at the moment";
  } else if (plan === topup) {
    base = `${pct(plan)} of what somebody you invite pays for their first plan and their first top-up, back as credits`;
  } else {
    const parts: string[] = [];
    if (plan > 0) parts.push(`${pct(plan)} of their first plan`);
    if (topup > 0) parts.push(`${pct(topup)} of their first top-up`);
    base = `${parts.join(", and ")}, back as credits`;
  }

  if (milestoneCount <= 0 || milestoneBonus <= 0) return `${base}.`;
  return `${base} — plus ${credits(milestoneBonus)} credits once ${milestoneCount} of them have paid.`;
}

/**
 * The invitee's side, or null when both welcome percentages are switched off.
 *
 * Its own sentence rather than a clause bolted onto the one above, because the
 * two are said in different places to different people: the referrer reads
 * "what do I get" beside their link, the invited customer reads "what do I
 * get" at sign-up and at their first checkout, and a sentence that answers
 * both at once answers neither cleanly.
 */
export function describeWelcomeBonus(terms: ReferralTerms): string | null {
  const { planInviteePercent: plan, topupInviteePercent: topup } = terms;
  if (plan <= 0 && topup <= 0) return null;

  if (plan === topup) {
    return `They get ${pct(plan)} of both payments back as credits — joining on an invite pays both of you.`;
  }
  const parts: string[] = [];
  if (plan > 0) parts.push(`${pct(plan)} of their first plan`);
  if (topup > 0) parts.push(`${pct(topup)} of their first top-up`);
  return `They get ${parts.join(", and ")} back as credits — joining on an invite pays both of you.`;
}
