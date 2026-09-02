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

/**
 * Terms a plan may be sold for, mirrored in three places and deliberately so:
 * ALLOWED_MONTHS in checkout-actions.ts prices the order, TERMS in
 * PlanFields.tsx draws the picker, and plans_duration_months_check in the
 * database refuses anything else.
 *
 * The reason it is a closed set rather than a number: the checkout charges
 * price_per_month x the term and coerces a term it does not recognise to ONE
 * month, while settle_payment() would still grant the full length off the plan
 * row. A 24 typed here would sell two years for one month's money.
 */
const ALLOWED_TERMS = [1, 3, 6, 12];

const TERM_REFUSAL =
  'Choose a term of 1, 3, 6 or 12 months, or switch it off for no expiry. Those are the only terms the checkout can price.';

/**
 * The plan's term. Blank or absent is null - no expiry - which is the answer
 * for the trial row (whose form has no term field) and for a plan the admin
 * deliberately switched the term off on.
 *
 * `undefined` is the refusal, kept distinct from the null that means lifetime.
 */
function readDurationMonths(fd: FormData): number | null | undefined {
  const raw = str(fd, "duration_months");
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  return ALLOWED_TERMS.includes(value) ? value : undefined;
}

/** Trial only. Absent leaves the stored value alone rather than clearing it. */
function readTrialDays(fd: FormData): number | undefined {
  const raw = str(fd, "trial_days");
  if (raw === null || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 90) return undefined;
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

  const months = readDurationMonths(fd);
  if (months === undefined) return fail(TERM_REFUSAL);

  /*
   * A new plan is never the trial. There is at most one trial row - a partial
   * unique index enforces it - and it is created by the migration, not from
   * this form, so nothing here needs a way to mint a second one.
   */
  const { data, error } = await admin
    .from("plans")
    .insert({
      name,
      description: str(fd, "description"),
      ...limits.values,
      included_credits: includedCredits,
      price_per_month: price,
      duration_months: months,
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
  if (!before) return fail("That plan no longer exists.");

  /*
   * Whether this is the trial comes off the STORED row, never off the form.
   *
   * The trial's editor leaves out the price and the term and shows a days box
   * instead, so a posted form is not a reliable description of which kind of
   * plan it is - and a form that claimed is_trial could otherwise turn a paid
   * plan into a free one. The database has three check constraints that would
   * refuse the resulting row anyway; this decides it before the round trip so
   * the admin gets a sentence rather than a constraint name.
   */
  const isTrial = (before as { is_trial?: boolean }).is_trial === true;

  const months = isTrial ? null : readDurationMonths(fd);
  if (months === undefined) return fail(TERM_REFUSAL);

  const trialDays = readTrialDays(fd);
  if (isTrial && trialDays === undefined) {
    return fail("The trial has to run for between 1 and 90 days.");
  }

  const patch = {
    name,
    description: str(fd, "description"),
    ...limits.values,
    included_credits: includedCredits,
    // Free by constraint, and free is the reason the portal can hand it over
    // without a payment. The form does not offer a price for it.
    price_per_month: isTrial ? 0 : price,
    duration_months: months,
    ...(isTrial ? { trial_days: trialDays } : {}),
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

  /*
   * A copy is never the trial.
   *
   * `rest` is the whole row minus its identity, so without this the copy would
   * carry is_trial = true and hit plans_one_trial_idx - a unique-violation
   * message about an index, for pressing Duplicate. There is one trial by
   * design, so the copy is an ordinary free plan and the admin can price it.
   */
  const { data: inserted, error } = await admin
    .from("plans")
    .insert({ ...rest, name: candidate, is_trial: false, trial_days: null })
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
