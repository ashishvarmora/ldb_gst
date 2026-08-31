"use server";

import { revalidatePath } from "next/cache";

import { assertSuperAdmin } from "@/lib/auth";
import { diffFields, writeAudit } from "@/lib/audit";
import { fail, str } from "@/lib/forms";
import { NUMERIC_LIMITS, parseLimitInput } from "@/lib/limits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";

/** Read every limit field off the form. Blank is rejected: a plan is complete. */
function readPlanLimits(fd: FormData): { values: Record<string, number> } | { error: string } {
  const values: Record<string, number> = {};

  for (const field of NUMERIC_LIMITS) {
    const value = parseLimitInput(fd.get(field.key), {
      allowUnlimited: field.allowUnlimited,
      allowBlank: false,
      min: field.min,
    });
    if (value === undefined || value === null) {
      return {
        error:
          `"${field.label}": enter a whole number of at least ${field.min}` +
          (field.allowUnlimited ? ", or -1 for unlimited." : "."),
      };
    }
    values[field.key] = value;
  }

  return { values };
}

/**
 * Credits the plan hands over when it is bought or assigned. Deliberately not
 * in NUMERIC_LIMITS: it is a grant, not a ceiling, and "unlimited" would be
 * meaningless.
 */
function readIncludedCredits(fd: FormData): number | null {
  const raw = str(fd, "included_credits");
  if (raw === null) return 0;
  const value = Math.round(Number(raw) * 100) / 100;
  if (!Number.isFinite(value) || value < 0 || value > 1_000_000) return null;
  return value;
}

export async function createPlan(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const name = str(fd, "name");
  if (!name) return fail("Give the plan a name.");

  const limits = readPlanLimits(fd);
  if ("error" in limits) return fail(limits.error);

  const price = Number(str(fd, "price_per_month") ?? "0");
  if (!Number.isFinite(price) || price < 0) return fail("Price must be zero or more.");

  const includedCredits = readIncludedCredits(fd);
  if (includedCredits === null) return fail("Credits included must be zero or more.");

  const { data, error } = await admin
    .from("plans")
    .insert({
      name,
      description: str(fd, "description"),
      ...limits.values,
      included_credits: includedCredits,
      price_per_month: price,
      is_active: true,
      sort_order: Number(str(fd, "sort_order") ?? "100") || 100,
    })
    .select("id")
    .single();

  if (error) {
    return fail(
      /duplicate key/i.test(error.message)
        ? `A plan called "${name}" already exists.`
        : error.message,
    );
  }

  await writeAudit(actor, {
    action: "plan.create",
    entity: "plan",
    entityId: data.id,
    entityLabel: name,
    meta: { ...limits.values, included_credits: includedCredits },
  });

  revalidatePath("/admin/plans");
  return { ok: true, message: `Plan "${name}" created.` };
}

export async function updatePlan(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const planId = str(fd, "plan_id");
  const name = str(fd, "name");
  if (!planId) return fail("Missing plan id.");
  if (!name) return fail("Give the plan a name.");

  const limits = readPlanLimits(fd);
  if ("error" in limits) return fail(limits.error);

  const price = Number(str(fd, "price_per_month") ?? "0");
  if (!Number.isFinite(price) || price < 0) return fail("Price must be zero or more.");

  const includedCredits = readIncludedCredits(fd);
  if (includedCredits === null) return fail("Credits included must be zero or more.");

  const { data: before } = await admin.from("plans").select("*").eq("id", planId).maybeSingle();

  const patch = {
    name,
    description: str(fd, "description"),
    ...limits.values,
    included_credits: includedCredits,
    price_per_month: price,
    sort_order: Number(str(fd, "sort_order") ?? "100") || 100,
  };

  const { error } = await admin.from("plans").update(patch).eq("id", planId);
  if (error) {
    return fail(
      /duplicate key/i.test(error.message)
        ? `A plan called "${name}" already exists.`
        : error.message,
    );
  }

  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);

  await writeAudit(actor, {
    action: "plan.update",
    entity: "plan",
    entityId: planId,
    entityLabel: name,
    meta: {
      changes: diffFields(before as Record<string, unknown> | null, patch),
      accounts_affected: count ?? 0,
    },
  });

  revalidatePath("/admin/plans");
  revalidatePath("/admin/officers");
  // The public plan page reads the same rows, so a price change has to show up
  // there in the same breath.
  revalidatePath("/portal/plan");
  return {
    ok: true,
    message: `Plan saved. ${count ?? 0} customer${count === 1 ? "" : "s"} now on the new limits.`,
  };
}

export async function setPlanActive(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const planId = str(fd, "plan_id");
  const active = fd.get("is_active") === "true";
  if (!planId) return fail("Missing plan id.");

  const { data: plan } = await admin.from("plans").select("name").eq("id", planId).maybeSingle();
  const { error } = await admin.from("plans").update({ is_active: active }).eq("id", planId);
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: active ? "plan.reactivate" : "plan.archive",
    entity: "plan",
    entityId: planId,
    entityLabel: plan?.name ?? null,
    meta: {},
  });

  revalidatePath("/admin/plans");
  revalidatePath("/portal/plan");
  return {
    ok: true,
    message: active
      ? "Plan reactivated and back on the public plan page."
      : "Plan archived and off the public plan page. Customers already on it keep their limits; it just cannot be bought or assigned again.",
  };
}

export async function deletePlan(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const planId = str(fd, "plan_id");
  if (!planId) return fail("Missing plan id.");

  const { count } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("plan_id", planId);

  if ((count ?? 0) > 0) {
    return fail(
      `${count} customer${count === 1 ? " is" : "s are"} on this plan. Move them to another plan first, or archive this one.`,
    );
  }

  const { data: plan } = await admin.from("plans").select("name").eq("id", planId).maybeSingle();
  const { error } = await admin.from("plans").delete().eq("id", planId);
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "plan.delete",
    entity: "plan",
    entityId: planId,
    entityLabel: plan?.name ?? null,
    meta: {},
  });

  revalidatePath("/admin/plans");
  return { ok: true, message: "Plan deleted." };
}

export async function duplicatePlan(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const planId = str(fd, "plan_id");
  if (!planId) return fail("Missing plan id.");

  const { data: plan } = await admin.from("plans").select("*").eq("id", planId).maybeSingle();
  if (!plan) return fail("That plan no longer exists.");

  const { id, created_at, updated_at, name, ...rest } = plan as Record<string, unknown> & {
    id: string;
    created_at: string;
    updated_at: string;
    name: string;
  };
  void id;
  void created_at;
  void updated_at;

  // "Basic" -> "Basic copy" -> "Basic copy 2" ...
  let candidate = `${name} copy`;
  for (let n = 2; n < 50; n += 1) {
    const { data: clash } = await admin
      .from("plans")
      .select("id")
      .eq("name", candidate)
      .maybeSingle();
    if (!clash) break;
    candidate = `${name} copy ${n}`;
  }

  const { data: inserted, error } = await admin
    .from("plans")
    .insert({ ...rest, name: candidate })
    .select("id")
    .single();
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "plan.duplicate",
    entity: "plan",
    entityId: inserted.id,
    entityLabel: candidate,
    meta: { source_plan_id: planId },
  });

  revalidatePath("/admin/plans");
  return { ok: true, message: `Created "${candidate}".` };
}
