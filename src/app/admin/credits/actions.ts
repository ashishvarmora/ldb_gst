"use server";

import { revalidatePath } from "next/cache";

import { diffFields, writeAudit } from "@/lib/audit";
import { assertSuperAdmin } from "@/lib/auth";
import { describeRate, formatCredits, grantCredits } from "@/lib/credits";
import { bool, fail, str } from "@/lib/forms";
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
  if (!label) return fail("Give the action a name the officer will recognise.");

  const unitsPerCredit = readUnitsPerCredit(str(fd, "units_per_credit"));
  if (unitsPerCredit === null) {
    return fail("How many of this action one credit buys must be a positive number.");
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
 * One rung of the ladder. Both numbers are required and both must be positive:
 * a pack with no price or no credits is a pricing mistake that would reach the
 * officer's buy page, not a state worth storing.
 */
function readPack(fd: FormData): { values: PackValues } | { error: string } {
  const name = str(fd, "name");
  if (!name) return { error: "Give the pack a name the officer will recognise." };

  const price = positiveAmount(str(fd, "price_inr"));
  if (price === null) return { error: "Price must be a positive amount in rupees." };

  const credits = positiveAmount(str(fd, "credits"));
  if (credits === null) return { error: "Credits must be a positive number." };

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
      sort_order: sortOrder,
      is_active: bool(fd, "is_active"),
    },
  };
}

/** "Rs 500 = 1,100 credits", the sentence the admin just wrote. */
function describePack(values: PackValues): string {
  return `Rs ${values.price_inr.toLocaleString("en-IN")} = ${formatCredits(values.credits)} credits`;
}

export async function createCreditPack(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const parsed = readPack(fd);
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

  const parsed = readPack(fd);
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

/**
 * Moves an officer's balance by hand. The only way credits come in while
 * online payment is switched off, and the only way a mistake is taken back out.
 *
 * grant_credits() writes the ledger row and clamps the balance at zero, so this
 * never has to read the balance first.
 */
export async function grantOfficerCredits(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const userId = str(fd, "user_id");
  if (!userId) return fail("Missing officer id.");

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
  if (!profile) return fail("That officer no longer exists.");

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
