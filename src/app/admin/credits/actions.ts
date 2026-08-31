"use server";

import { revalidatePath } from "next/cache";

import { diffFields, writeAudit } from "@/lib/audit";
import { assertSuperAdmin } from "@/lib/auth";
import { creditsForAmount, describeRate, formatCredits, grantCredits } from "@/lib/credits";
import { bool, fail, str } from "@/lib/forms";
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

  revalidatePath("/admin/credits");
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
  bonus_percent: number;
  sort_order: number;
  is_active: boolean;
};

/** Two decimal places, matching numeric(10, 2) and numeric(12, 2) in the table. */
function positiveAmount(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(value) || value <= 0 || value > 10_000_000) return null;
  return value;
}

/**
 * The stored bonus_percent column: the extra an open tier hands out on top of
 * the base rate. Zero is a real answer, and so is a blank box.
 *
 * Not to be confused with bonusPercent() in lib/credits, which invents no
 * number of its own - it compares two fixed rungs by rupees-per-credit. This
 * one is a figure the admin types and the database stores.
 */
function readStoredBonusPercent(raw: string | null): number | null {
  if (raw === null) return 0;
  const value = Math.round(Number(raw) * 100) / 100;
  // Matches credit_packs_bonus_percent_check, so a value this accepts is a
  // value the table accepts.
  if (!Number.isFinite(value) || value < 0 || value > 1000) return null;
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
async function readPack(fd: FormData): Promise<{ values: PackValues } | { error: string }> {
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

  const bonus = readStoredBonusPercent(str(fd, "bonus_percent"));
  if (bonus === null) {
    return { error: "Bonus must be a percentage between 0 and 1,000." };
  }

  let credits = positiveAmount(str(fd, "credits"));
  if (credits === null) {
    if (!isOpen) return { error: "Credits must be a positive number." };
    // The column is not-null and checked positive, so an open tier still needs
    // some value even though nothing ever reads it. What the minimum buys is
    // the one figure here that is not an invention.
    const { creditsPerRupee } = await loadSettings(getSupabaseAdmin());
    const atMinimum = creditsForAmount(
      { is_open_ended: true, price_inr: price, credits: 0, bonus_percent: bonus },
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
    values: {
      name,
      price_inr: price,
      credits,
      is_open_ended: isOpen,
      // A fixed rung states its credits outright, so a bonus on it would be a
      // number that changes nothing. Stored as zero rather than kept around to
      // confuse the next person who reads the row.
      bonus_percent: isOpen ? bonus : 0,
      sort_order: sortOrder,
      is_active: bool(fd, "is_active"),
    },
  };
}

/**
 * The sentence the admin just wrote, back to them.
 *
 * An open tier has no single credit figure to quote - the amount decides - so
 * it states the rule instead. Saying "Rs 5,000 = 50,000 credits" about a tier
 * that actually gives 6,250 is exactly the confusion this branch exists to stop.
 */
function describePack(values: PackValues): string {
  const price = `Rs ${values.price_inr.toLocaleString("en-IN")}`;

  if (!values.is_open_ended) {
    return `${price} = ${formatCredits(values.credits)} credits`;
  }

  return values.bonus_percent > 0
    ? `${price} or more, with ${formatCredits(values.bonus_percent)}% extra credits`
    : `${price} or more, at the base rate`;
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

  revalidatePath("/admin/credits");
  revalidatePath("/portal/plan");
  return { ok: true, message: `Pack created. ${describePack(parsed.values)}.` };
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

  revalidatePath("/admin/credits");
  revalidatePath("/portal/plan");
  return {
    ok: true,
    message: `Saved. ${describePack(parsed.values)} — from the next purchase onwards.`,
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

  revalidatePath("/admin/credits");
  revalidatePath("/portal/plan");
  return { ok: true, message: `Pack "${pack?.name ?? "removed"}" deleted.` };
}

/* -------------------------------------------------------------------------- */
/* the base rate the open tier is built on                                     */
/* -------------------------------------------------------------------------- */

/**
 * credits_per_rupee - what one rupee buys before any tier's extra.
 *
 * It is an app_settings row like any other, but it is edited here rather than
 * on the settings page because it is the bottom of this conversion: the open
 * tier is this number plus a percentage, and reading either one without the
 * other tells you nothing about what a customer gets.
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

  revalidatePath("/admin/credits");
  // The open tier prices itself against this on the customer's own page.
  revalidatePath("/portal/plan");

  return {
    ok: true,
    message: `Saved. Rs 1 = ${formatCredits(rate)} credit${rate === 1 ? "" : "s"} before any tier's extra — from the next purchase onwards.`,
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
  revalidatePath("/admin/credits");
  revalidatePath("/admin");

  return {
    ok: true,
    message: `${amount > 0 ? "Added" : "Removed"} ${formatCredits(Math.abs(amount))} credit${Math.abs(amount) === 1 ? "" : "s"}. New balance: ${formatCredits(result.balance)}.`,
  };
}
