"use server";

import { revalidatePath } from "next/cache";

import { diffFields, writeAudit } from "@/lib/audit";
import { assertSuperAdmin } from "@/lib/auth";
import { creditsForAmount, describeRate, formatCredits, grantCredits } from "@/lib/credits";
import { bool, fail, str } from "@/lib/forms";
import { describeReferralReward } from "@/lib/referrals";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, CreditPack, CreditRate } from "@/lib/types";

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
