"use server";

import { revalidatePath } from "next/cache";

import { diffFields, writeAudit } from "@/lib/audit";
import { assertSuperAdmin } from "@/lib/auth";
import { describeCoupon, normaliseCode } from "@/lib/coupons";
import { creditsForAmount, describeRate, formatCredits, grantCredits } from "@/lib/credits";
import { reportError } from "@/lib/errors";
import { bool, fail, str } from "@/lib/forms";
import { describeReferralReward } from "@/lib/referrals";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ActionResult,
  Coupon,
  CouponKind,
  CouponScope,
  CouponUsage,
  CreditPack,
  CreditRate,
} from "@/lib/types";

/** Reasons an admin may pick when moving a balance by hand. */
const MANUAL_REASONS = new Set(["admin_topup", "admin_adjust", "purchase"]);

/**
 * A rate is stored the way it is spoken: "1 credit = 2 automatic checks" is
 * units_per_credit = 2. Two decimal places, matching numeric(10, 2) in the
 * database, so what the admin typed is what spend_credits() divides by.
 */
function readUnitsPerCredit(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 10_000) return null;
  return Math.round(value * 100) / 100;
}

export async function saveCreditRate(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const action = str(fd, "action_key");
  if (!action) return fail("Missing action.");

  const label = str(fd, "label");
  if (!label) return fail("Give the action a name the customer will recognise.");

  // The form offers both directions - "1 credit = N searches" and "N credits =
  // 1 search" - but only ever posts the first, because that is the column.
  const unitsPerCredit = readUnitsPerCredit(str(fd, "units_per_credit"));
  if (unitsPerCredit === null) {
    return fail("Fill in one side of the rate. Either box will do; the other follows.");
  }

  const { data: before } = await admin
    .from("credit_rates")
    .select("*")
    .eq("action", action)
    .maybeSingle<CreditRate>();
  if (!before) return fail("That action has no rate row. It is created by a migration.");

  const patch = {
    label,
    description: str(fd, "description"),
    units_per_credit: unitsPerCredit,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("credit_rates").update(patch).eq("action", action);
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "credit_rate.update",
    entity: "credit_rate",
    entityId: action,
    entityLabel: label,
    meta: { changes: diffFields(before as unknown as Record<string, unknown>, patch) },
  });

  revalidatePath("/admin/plans");
  // Customers read the same rate on their own plan page.
  revalidatePath("/portal/plan");
  return {
    ok: true,
    message: `Saved. ${describeRate({ units_per_credit: unitsPerCredit })} — charged from the next call onwards.`,
  };
}

/* -------------------------------------------------------------------------- */
/* credit packs - the money half of the flow                                   */
/* -------------------------------------------------------------------------- */

type PackValues = {
  name: string;
  price_inr: number;
  credits: number;
  is_open_ended: boolean;
  credit_percent: number;
  sort_order: number;
  is_active: boolean;
};

/** A tier that gives exactly the base rate. The column's default, and its floor. */
const PLAIN_PERCENT = 100;

/** Two decimal places, matching numeric(10, 2) and numeric(12, 2) in the table. */
function positiveAmount(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) return null;
  return value;
}

/**
 * The stored credit_percent column: what share of the money becomes credits.
 * 100 is one credit per rupee at a base rate of 1, 250 is two and a half.
 *
 * Zero is not a setting here, it is a tier that sells nothing - which is why the
 * table refuses it. A blank box means the admin did not decide, so it lands on
 * the plain rate rather than on a tier nobody could buy.
 *
 * Not to be confused with bonusPercent() in lib/credits, which invents no
 * number of its own - it compares two fixed rungs by rupees-per-credit. This
 * one is a figure the admin types and the database stores.
 */
function readCreditPercent(raw: string | null): number | null {
  if (raw === null) return PLAIN_PERCENT;
  const value = Math.round(Number(raw) * 100) / 100;
  // Matches credit_packs_credit_percent_check, so a value this accepts is a
  // value the table accepts.
  if (!Number.isFinite(value) || value <= 0 || value > 10_000) return null;
  return value;
}

/**
 * One rung of the ladder, in whichever of its two shapes it has.
 *
 * A fixed rung needs both numbers and both must be positive: a pack with no
 * price or no credits is a pricing mistake that would reach the public buy
 * page, not a state worth storing.
 *
 * An open tier needs only the minimum. Its credits column is never shown to
 * anyone - the amount the buyer types decides - so an empty box there is not a
 * mistake to refuse.
 */
async function readPack(
  fd: FormData,
): Promise<{ values: PackValues; creditsPerRupee: number } | { error: string }> {
  const name = str(fd, "name");
  if (!name) return { error: "Give the pack a name the customer will recognise." };

  const isOpen = bool(fd, "is_open_ended");

  const price = positiveAmount(str(fd, "price_inr"));
  if (price === null) {
    return {
      error: isOpen
        ? "The minimum must be a positive amount in rupees."
        : "Price must be a positive amount in rupees.",
    };
  }

  const percent = readCreditPercent(str(fd, "credit_percent"));
  if (percent === null) {
    return { error: "Credit share must be a percentage above 0 and no more than 10,000." };
  }

  // Read once and returned to the caller: the message it writes has to quote
  // the same base rate this priced the tier against.
  const { creditsPerRupee } = await loadSettings(getSupabaseAdmin());

  let credits = positiveAmount(str(fd, "credits"));
  if (credits === null) {
    if (!isOpen) return { error: "Credits must be a positive number." };
    // The column is not-null and checked positive, so an open tier still needs
    // some value even though nothing ever reads it. What the minimum buys is
    // the one figure here that is not an invention.
    const atMinimum = creditsForAmount(
      { is_open_ended: true, price_inr: price, credits: 0, credit_percent: percent },
      price,
      creditsPerRupee,
    );
    credits = Math.max(1, atMinimum ?? 1);
  }

  const sortRaw = str(fd, "sort_order");
  const sortOrder = sortRaw === null ? 100 : Number(sortRaw);
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10_000) {
    return { error: "Sort order must be a whole number between 0 and 10,000." };
  }

  return {
    creditsPerRupee,
    values: {
      name,
      price_inr: price,
      credits,
      is_open_ended: isOpen,
      // A fixed rung states its credits outright, so a percentage on it would
      // change nothing. Stored at the plain rate rather than kept around to
      // confuse the next person who reads the row.
      credit_percent: isOpen ? percent : PLAIN_PERCENT,
      sort_order: sortOrder,
      is_active: bool(fd, "is_active"),
    },
  };
}

/**
 * The sentence the admin just wrote, back to them.
 *
 * An open tier has no single credit figure to quote - the amount decides - so
 * it states the rule and then works it out at the minimum. A percentage on its
 * own is not checkable: 250% only means something once you can see that Rs
 * 3,000 comes back as 7,500 credits.
 */
function describePack(values: PackValues, creditsPerRupee: number): string {
  const price = `Rs ${values.price_inr.toLocaleString("en-IN")}`;

  if (!values.is_open_ended) {
    return `${price} = ${formatCredits(values.credits)} credits`;
  }

  const atMinimum = creditsForAmount(values, values.price_inr, creditsPerRupee);
  return `${price} or more at ${formatCredits(values.credit_percent)}% credit, so ${price} buys ${formatCredits(atMinimum ?? 0)} credits`;
}

export async function createCreditPack(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const parsed = await readPack(fd);
  if ("error" in parsed) return fail(parsed.error);

  const { data, error } = await admin
    .from("credit_packs")
    .insert(parsed.values)
    .select("id")
    .single();

  if (error) {
    return fail(
      /duplicate key/i.test(error.message)
        ? `A pack called "${parsed.values.name}" already exists.`
        : error.message,
    );
  }

  await writeAudit(actor, {
    action: "credit_pack.create",
    entity: "credit_pack",
    entityId: data.id,
    entityLabel: parsed.values.name,
    meta: { ...parsed.values },
  });

  revalidatePath("/admin/plans");
  revalidatePath("/portal/plan");
  return {
    ok: true,
    message: `Pack created. ${describePack(parsed.values, parsed.creditsPerRupee)}.`,
  };
}

export async function saveCreditPack(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const packId = str(fd, "pack_id");
  if (!packId) return fail("Missing pack id.");

  const parsed = await readPack(fd);
  if ("error" in parsed) return fail(parsed.error);

  const { data: before } = await admin
    .from("credit_packs")
    .select("*")
    .eq("id", packId)
    .maybeSingle<CreditPack>();
  if (!before) return fail("That pack no longer exists.");

  const { error } = await admin.from("credit_packs").update(parsed.values).eq("id", packId);
  if (error) {
    return fail(
      /duplicate key/i.test(error.message)
        ? `A pack called "${parsed.values.name}" already exists.`
        : error.message,
    );
  }

  await writeAudit(actor, {
    action: "credit_pack.update",
    entity: "credit_pack",
    entityId: packId,
    entityLabel: parsed.values.name,
    meta: { changes: diffFields(before as unknown as Record<string, unknown>, parsed.values) },
  });

  revalidatePath("/admin/plans");
  revalidatePath("/portal/plan");
  return {
    ok: true,
    message: `Saved. ${describePack(parsed.values, parsed.creditsPerRupee)} — from the next purchase onwards.`,
  };
}

/**
 * Deleting a pack does not touch the payments made through it: payments.pack_id
 * is set to null and the row keeps its own amount and credits, so the money
 * record survives a pricing change.
 */
export async function deleteCreditPack(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const packId = str(fd, "pack_id");
  if (!packId) return fail("Missing pack id.");

  const { data: pack } = await admin
    .from("credit_packs")
    .select("name")
    .eq("id", packId)
    .maybeSingle<{ name: string }>();

  const { error } = await admin.from("credit_packs").delete().eq("id", packId);
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "credit_pack.delete",
    entity: "credit_pack",
    entityId: packId,
    entityLabel: pack?.name ?? null,
    meta: {},
  });

  revalidatePath("/admin/plans");
  revalidatePath("/portal/plan");
  return { ok: true, message: `Pack "${pack?.name ?? "removed"}" deleted.` };
}

/* -------------------------------------------------------------------------- */
/* the base rate the open tier is built on                                     */
/* -------------------------------------------------------------------------- */

/**
 * credits_per_rupee - what one rupee buys at a tier of 100%.
 *
 * It is an app_settings row like any other, but it is edited here rather than
 * on the settings page because it is the bottom of this conversion: an open
 * tier is this number times its own percentage, and reading either one without
 * the other tells you nothing about what a customer gets.
 *
 * Same shape as the settings actions - upsert, audit, revalidate - only over a
 * single key, so saving it cannot disturb the rows the settings forms own.
 */
export async function saveCreditsPerRupee(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  // Four decimal places, matching the numeric(10, 4) credits_for_amount() reads
  // it into, so what is typed is what the database multiplies by.
  const raw = str(fd, "credits_per_rupee");
  const rate = raw === null ? Number.NaN : Math.round(Number(raw) * 10_000) / 10_000;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 10_000) {
    return fail("A rupee has to buy something. Enter a number above 0.");
  }

  const { data: existing } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", "credits_per_rupee")
    .maybeSingle<{ value: unknown }>();

  const { error } = await admin.from("app_settings").upsert(
    {
      key: "credits_per_rupee",
      value: rate as never,
      updated_at: new Date().toISOString(),
      updated_by: actor.id,
    },
    { onConflict: "key" },
  );
  if (error) return fail(error.message);

  const before: Record<string, unknown> = { credits_per_rupee: existing?.value ?? null };
  const after: Record<string, unknown> = { credits_per_rupee: rate };

  await writeAudit(actor, {
    action: "settings.update_credits",
    entity: "settings",
    entityLabel: "credits_per_rupee",
    meta: { changes: diffFields(before, after) },
  });

  revalidatePath("/admin/plans");
  // The open tier prices itself against this on the customer's own page.
  revalidatePath("/portal/plan");

  return {
    ok: true,
    message: `Saved. Rs 1 = ${formatCredits(rate)} credit${rate === 1 ? "" : "s"} on a tier of 100% — from the next purchase onwards.`,
  };
}

/* -------------------------------------------------------------------------- */
/* what a referral is worth                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The four numbers behind the referral scheme.
 *
 * Only the numbers. Nothing here grants anything: rewards are worked out by
 * reward_referral() inside settle_payment, so there is one path from "money
 * arrived" to "everyone owed was paid" and a webhook delivered twice pays once.
 *
 * A milestone of zero on either side switches the milestone off, which is why
 * zero is accepted where the pack percentages refuse it.
 */
export async function saveReferralSettings(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  // NaN for a blank box, never 0 - Number("") is zero, and a percentage that
  // silently became "nothing" is the kind of setting nobody notices until a
  // referrer complains.
  const number = (name: string): number => {
    const raw = str(fd, name);
    return raw === null ? Number.NaN : Number(raw);
  };

  const percent = number("referral_percent");
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    return fail("The share of a first payment must be between 0 and 100 percent.");
  }

  const milestoneCount = number("referral_milestone_count");
  if (!Number.isInteger(milestoneCount) || milestoneCount < 0 || milestoneCount > 1_000) {
    return fail("The milestone is a whole number of referrals between 0 and 1,000. Use 0 for none.");
  }

  const milestoneBonus = number("referral_milestone_bonus");
  if (!Number.isFinite(milestoneBonus) || milestoneBonus < 0 || milestoneBonus > 1_000_000) {
    return fail("The milestone bonus must be between 0 and 1,000,000 credits. Use 0 for none.");
  }

  const enabled = bool(fd, "referral_enabled");
  const values: Record<string, unknown> = {
    referral_enabled: enabled,
    referral_percent: Math.round(percent * 100) / 100,
    referral_milestone_count: milestoneCount,
    referral_milestone_bonus: Math.round(milestoneBonus * 100) / 100,
  };

  const { data: existing } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", Object.keys(values));
  const before = Object.fromEntries((existing ?? []).map((row) => [row.key, row.value]));

  const { error } = await admin.from("app_settings").upsert(
    Object.entries(values).map(([key, value]) => ({
      key,
      value: value as never,
      updated_at: new Date().toISOString(),
      updated_by: actor.id,
    })),
    { onConflict: "key" },
  );
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "settings.update_referrals",
    entity: "settings",
    entityLabel: "referrals",
    meta: { changes: diffFields(before, values) },
  });

  revalidatePath("/admin/plans");
  // Customers read their own referral link and its terms on the plan page.
  revalidatePath("/portal/plan");

  return {
    ok: true,
    message: enabled
      ? `Saved. ${describeReferralReward(Math.round(percent * 100) / 100, milestoneCount, milestoneBonus)} Referrals already rewarded keep what they earned.`
      : "Saved. Referrals are switched off, so no new one earns anything. Anything already earned stays.",
  };
}

/* -------------------------------------------------------------------------- */
/* coupon codes                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Discount codes: the four ways an admin changes one.
 *
 * Nothing here decides what a code is worth to a buyer. validate_coupon() does
 * that, and it is the only thing that does, so these actions write columns and
 * nothing else. What they do owe the admin is a refusal in words: every check
 * below is one the table would make anyway, made early enough to say which box
 * is wrong instead of quoting a constraint name.
 */

type CouponValues = {
  code: string;
  description: string | null;
  kind: CouponKind;
  value: number;
  max_discount_inr: number | null;
  min_spend_inr: number;
  max_claims: number | null;
  max_per_user: number;
  applies_to: CouponScope;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
};

/**
 * The characters that survive a poster, a WhatsApp forward and a phone call.
 * upper(btrim()) only takes the spaces off the ends, so a code with one in the
 * middle would be stored, handed out, and then typed wrong for ever.
 */
const CODE_SHAPE = /^[A-Z0-9][A-Z0-9_-]*$/;

const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/** Rupees to two decimal places, matching the numeric(10, 2) columns. */
function rupees(raw: string): number | null {
  const value = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(value) || value < 0 || value > 10_000_000) return null;
  return value;
}

/**
 * A window is typed as two days, not two instants: a promotion runs "the 1st to
 * the 30th", and nobody means half past five in the morning because the server
 * keeps UTC. The offset is written in rather than left to whichever clock parses
 * it - the start of the opening day, and the last second of the closing one, so
 * a code is good for the whole of the day it expires on.
 */
function istDay(raw: string, edge: "start" | "end"): string {
  return `${raw}T${edge === "start" ? "00:00:00" : "23:59:59"}+05:30`;
}

/**
 * describeCoupon() already writes the sentence a coupon makes, off five of its
 * columns. Those five are exactly what was just typed, so the identity fields
 * are filled in to satisfy the type rather than the sentence being written a
 * second time here - two descriptions of one coupon are two chances to say
 * something checkout does not agree with.
 */
function describeValues(values: CouponValues): string {
  const row: Coupon = { id: "", created_at: "", updated_at: "", ...values };
  return describeCoupon(row);
}

function readCoupon(fd: FormData): { values: CouponValues } | { error: string } {
  const code = normaliseCode(str(fd, "code"));
  if (!code) return { error: "Give the code something to type. SAVE20, for instance." };
  if (code.length > 40) {
    return { error: "A code that long gets mistyped. Keep it under 40 characters." };
  }
  if (!CODE_SHAPE.test(code)) {
    return {
      error: "A code can only use letters, numbers, dashes and underscores — no spaces.",
    };
  }

  const rawKind = str(fd, "kind");
  const kind: CouponKind =
    rawKind === "flat" ? "flat" : rawKind === "credit_bonus" ? "credit_bonus" : "percent";
  /* A bonus is not a discount: nothing is bought, so a ceiling, a minimum spend
     and a scope have nothing to act on. Forced rather than trusted from the
     form, because coupons_bonus_shape in 0022 refuses the row otherwise and a
     constraint violation is a worse message than none. */
  const bonus = kind === "credit_bonus";

  const valueRaw = str(fd, "value");
  const value = valueRaw === null ? null : rupees(valueRaw);
  if (value === null || value <= 0) {
    return {
      error: bonus
        ? "Enter how many credits the code is worth. It has to be above zero."
        : kind === "percent"
          ? "Enter the percentage that comes off. It has to be above zero."
          : "Enter how many rupees come off. It has to be above zero.",
    };
  }
  if (kind === "percent" && value > 100) {
    return { error: "A percentage over 100 would pay the buyer to shop. Keep it at 100 or less." };
  }

  // Only a percentage has an "up to". On a flat or bonus code the column is
  // cleared rather than kept, so the row cannot say something the code does not do.
  let cap: number | null = null;
  const capRaw = str(fd, "max_discount_inr");
  if (kind === "percent" && capRaw !== null) {
    cap = rupees(capRaw);
    if (cap === null || cap <= 0) {
      return { error: 'The "up to" ceiling must be above zero rupees, or blank for no ceiling.' };
    }
  }

  const minSpendRaw = str(fd, "min_spend_inr");
  const minSpend = bonus ? 0 : minSpendRaw === null ? 0 : rupees(minSpendRaw);
  if (minSpend === null) return { error: "The minimum spend must be zero rupees or more." };

  // Blank is the unlimited code, and null is how the column stores that. Zero
  // is not "no limit", it is a code nobody can use, which is why the table
  // refuses it and so does this.
  let maxClaims: number | null = null;
  const claimsRaw = str(fd, "max_claims");
  if (claimsRaw !== null) {
    const parsed = Number(claimsRaw);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1_000_000) {
      return { error: "Total claims must be a whole number of 1 or more, or blank for no limit." };
    }
    maxClaims = parsed;
  }

  const perUserRaw = str(fd, "max_per_user");
  const perUser = perUserRaw === null ? 1 : Number(perUserRaw);
  if (!Number.isInteger(perUser) || perUser < 1 || perUser > 1_000) {
    return { error: "Uses per person must be a whole number of 1 or more." };
  }

  const scope = str(fd, "applies_to");
  const appliesTo: CouponScope = bonus
    ? "all"
    : scope === "credits" || scope === "plan"
      ? scope
      : "all";

  const startsOn = str(fd, "starts_on");
  const endsOn = str(fd, "expires_on");
  for (const [label, raw] of [
    ["First day", startsOn],
    ["Last day", endsOn],
  ] as const) {
    if (raw !== null && !DATE_SHAPE.test(raw)) {
      return { error: `"${label}": pick a date, or leave it blank.` };
    }
  }

  const startsAt = startsOn === null ? null : istDay(startsOn, "start");
  const expiresAt = endsOn === null ? null : istDay(endsOn, "end");
  if (startsAt && expiresAt && new Date(expiresAt) < new Date(startsAt)) {
    return { error: "A code cannot stop working before it starts." };
  }

  return {
    values: {
      code,
      description: str(fd, "description"),
      kind,
      value,
      max_discount_inr: cap,
      min_spend_inr: minSpend,
      max_claims: maxClaims,
      max_per_user: perUser,
      applies_to: appliesTo,
      starts_at: startsAt,
      expires_at: expiresAt,
      is_active: bool(fd, "is_active"),
    },
  };
}

/**
 * Asks whether the code is taken before writing it.
 *
 * The column is unique, so the insert would refuse it anyway - but "duplicate
 * key value violates unique constraint coupons_code_key" tells an admin nothing
 * about what to do next, and the answer is always the same: that code already
 * exists, go and edit it. The constraint is still the authority; two admins
 * typing the same code at the same moment fall through to the catch below.
 */
async function codeTaken(
  admin: ReturnType<typeof getSupabaseAdmin>,
  code: string,
  exceptId: string | null,
): Promise<string | null> {
  const { data } = await admin
    .from("coupons")
    .select("id")
    .eq("code", code)
    .maybeSingle<{ id: string }>();

  if (!data || data.id === exceptId) return null;
  return `The code ${code} already exists. Edit that one instead, or pick another code.`;
}

/** The message a clash gets whichever way it was caught. */
function clashOrError(code: string, error: unknown, context: string): string {
  const message = (error as { message?: string })?.message ?? "";
  if (/duplicate key|unique constraint/i.test(message)) {
    return `The code ${code} already exists. Edit that one instead, or pick another code.`;
  }
  return reportError(context, error, `The code ${code} could not be saved.`);
}

export async function createCoupon(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const parsed = readCoupon(fd);
  if ("error" in parsed) return fail(parsed.error);

  const taken = await codeTaken(admin, parsed.values.code, null);
  if (taken) return fail(taken);

  const { data, error } = await admin
    .from("coupons")
    .insert(parsed.values)
    .select("id")
    .single();
  if (error) return fail(clashOrError(parsed.values.code, error, "coupon insert failed"));

  await writeAudit(actor, {
    action: "coupon.create",
    entity: "coupon",
    entityId: data.id,
    entityLabel: parsed.values.code,
    meta: { ...parsed.values },
  });

  // Only the admin section lists codes. Customers never see one until they type
  // it, so there is no public page to revalidate.
  revalidatePath("/admin/plans");
  return {
    ok: true,
    message: `Code ${parsed.values.code} created: ${describeValues(parsed.values)}.`,
  };
}

export async function saveCoupon(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const couponId = str(fd, "coupon_id");
  if (!couponId) return fail("Missing coupon id.");

  const parsed = readCoupon(fd);
  if ("error" in parsed) return fail(parsed.error);

  const { data: before } = await admin
    .from("coupons")
    .select("*")
    .eq("id", couponId)
    .maybeSingle<Coupon>();
  if (!before) return fail("That code no longer exists.");

  const taken = await codeTaken(admin, parsed.values.code, couponId);
  if (taken) return fail(taken);

  const { error } = await admin.from("coupons").update(parsed.values).eq("id", couponId);
  if (error) return fail(clashOrError(parsed.values.code, error, "coupon update failed"));

  await writeAudit(actor, {
    action: "coupon.update",
    entity: "coupon",
    entityId: couponId,
    entityLabel: parsed.values.code,
    meta: {
      changes: diffFields(before as unknown as Record<string, unknown>, parsed.values),
    },
  });

  revalidatePath("/admin/plans");
  return {
    ok: true,
    // Claims already made keep the amount they were given, because a redemption
    // stores its own discount. Worth saying, since the arithmetic on screen has
    // just changed under a row of history.
    message: `Saved. ${describeValues(parsed.values)} — from the next order onwards. Discounts already given are unchanged.`,
  };
}

export async function setCouponActive(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const couponId = str(fd, "coupon_id");
  if (!couponId) return fail("Missing coupon id.");
  const active = fd.get("is_active") === "true";

  const { data: coupon } = await admin
    .from("coupons")
    .select("code")
    .eq("id", couponId)
    .maybeSingle<{ code: string }>();
  if (!coupon) return fail("That code no longer exists.");

  const { error } = await admin.from("coupons").update({ is_active: active }).eq("id", couponId);
  if (error) {
    return fail(reportError("coupon switch failed", error, "That code could not be switched."));
  }

  await writeAudit(actor, {
    action: active ? "coupon.activate" : "coupon.deactivate",
    entity: "coupon",
    entityId: couponId,
    entityLabel: coupon.code,
    meta: {},
  });

  revalidatePath("/admin/plans");
  return {
    ok: true,
    message: active
      ? `Code ${coupon.code} is live again.`
      : `Code ${coupon.code} is switched off. Nobody can use it, and everything it has already given stays on the record.`,
  };
}

/**
 * Deletes the code and, with it, every redemption of it - coupon_redemptions
 * cascades off the coupon. The payments survive: payments.coupon_id is set to
 * null and each row keeps the amount it charged and the discount it recorded,
 * so the money is still accounted for. What is lost is the answer to "who used
 * this code, and what did we give away", which is why the audit row below
 * carries the totals it is about to destroy.
 */
export async function deleteCoupon(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const couponId = str(fd, "coupon_id");
  if (!couponId) return fail("Missing coupon id.");

  const { data: usage } = await admin
    .from("coupon_usage")
    .select("*")
    .eq("id", couponId)
    .maybeSingle<CouponUsage>();
  if (!usage) return fail("That code no longer exists.");

  const { error } = await admin.from("coupons").delete().eq("id", couponId);
  if (error) {
    return fail(reportError("coupon delete failed", error, "That code could not be deleted."));
  }

  await writeAudit(actor, {
    action: "coupon.delete",
    entity: "coupon",
    entityId: couponId,
    entityLabel: usage.code,
    meta: {
      rule: describeCoupon(usage),
      claims_used: usage.used,
      claims_held: usage.holding,
      discount_given: usage.discount_given,
      list_total: usage.list_total,
    },
  });

  revalidatePath("/admin/plans");
  return {
    ok: true,
    message:
      usage.used > 0
        ? `Code ${usage.code} deleted, along with the record of ${usage.used} discount${usage.used === 1 ? "" : "s"} already given. The payments themselves are untouched.`
        : `Code ${usage.code} deleted. Nobody had used it.`,
  };
}

/* -------------------------------------------------------------------------- */
/* moving a balance by hand                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Moves one account's balance by hand. The only way credits come in while
 * online payment is switched off, and the only way a mistake is taken back out.
 *
 * grant_credits() writes the ledger row and clamps the balance at zero, so this
 * never has to read the balance first.
 */
export async function grantAccountCredits(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const userId = str(fd, "user_id");
  if (!userId) return fail("Missing account id.");

  const raw = str(fd, "amount");
  const amount = raw === null ? Number.NaN : Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(amount) || amount === 0) {
    return fail("Enter how many credits to add. Use a minus sign to take some back.");
  }
  if (Math.abs(amount) > 1_000_000) return fail("That is more credits than the platform can hold.");

  const reason = str(fd, "reason") ?? "admin_topup";
  if (!MANUAL_REASONS.has(reason)) return fail("Unknown reason.");

  const { data: profile } = await admin
    .from("profiles")
    .select("email, full_name")
    .eq("id", userId)
    .maybeSingle<{ email: string; full_name: string | null }>();
  if (!profile) return fail("That account no longer exists.");

  const result = await grantCredits({
    admin,
    userId,
    amount,
    reason,
    actorId: actor.id,
    note: str(fd, "note"),
  });
  if (!result.ok) return fail(result.error ?? "Could not add credits.");

  await writeAudit(actor, {
    action: "credits.grant",
    entity: "profile",
    entityId: userId,
    entityLabel: profile.full_name ?? profile.email,
    meta: { amount, reason, balance_after: result.balance ?? null },
  });

  revalidatePath(`/admin/officers/${userId}`);
  revalidatePath("/admin/plans");
  revalidatePath("/admin");

  return {
    ok: true,
    message: `${amount > 0 ? "Added" : "Removed"} ${formatCredits(Math.abs(amount))} credit${Math.abs(amount) === 1 ? "" : "s"}. New balance: ${formatCredits(result.balance)}.`,
  };
}
