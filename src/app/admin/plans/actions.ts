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
 * The longest term a plan may be sold for. plans_duration_days_range in the
 * database says the same thing, and this is here so the admin gets a sentence
 * rather than a constraint name.
 */
const MAX_TERM_DAYS = 3650;

const TERM_REFUSAL =
  `Give the term as a whole number of days between 1 and ${MAX_TERM_DAYS}, or switch it off for no expiry.`;

/**
 * The plan's term, IN DAYS. Blank or absent is null - no expiry - which is the
 * answer for the trial row (whose form has no term field) and for a plan the
 * admin deliberately switched the term off on.
 *
 * `undefined` is the refusal, kept distinct from the null that means lifetime.
 *
 * This used to read duration_months and accept only 1, 3, 6 or 12, because the
 * checkout multiplied the price by it. Nothing multiplies now, so the closed
 * set has no job: duration_days is the term settle_payment() adds, the form
 * writes it directly, and a free number of days cannot mis-sell anything. The
 * database derives duration_months from this, so the two cannot contradict.
 */
function readDurationDays(fd: FormData): number | null | undefined {
  const raw = str(fd, "duration_days");
  if (raw === null || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > MAX_TERM_DAYS) return undefined;
  return value;
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

  const price = Number(str(fd, "price_inr") ?? "0");
  if (!Number.isFinite(price) || price < 0) return fail("Price must be zero or more.");

  const includedCredits = readIncludedCredits(fd);
  if (includedCredits === null) return fail("Credits included must be zero or more.");

  const days = readDurationDays(fd);
  if (days === undefined) return fail(TERM_REFUSAL);

  /*
   * A new plan is never the trial. There is at most one trial row - a partial
   * unique index enforces it - and it is created by the migration, not from
   * this form, so nothing here needs a way to mint a second one.
   *
   * duration_months is not written, here or anywhere: 0042's trigger derives it
   * from duration_days, so writing it would either be ignored or be a second
   * opinion about the term.
   */
  const { data, error } = await admin
    .from("plans")
    .insert({
      name,
      description: str(fd, "description"),
      ...limits.values,
      included_credits: includedCredits,
      price_inr: price,
      duration_days: days,
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

  const price = Number(str(fd, "price_inr") ?? "0");
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

  const days = isTrial ? null : readDurationDays(fd);
  if (days === undefined) return fail(TERM_REFUSAL);

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
    price_inr: isTrial ? 0 : price,
    // The trial's term is trial_days and duration_days must stay null on it -
    // plans_duration_days_range says so, and start_free_trial() reads the other
    // column.
    duration_days: days,
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

  /*
   * Everything except the row's identity and its DERIVED columns.
   *
   * tracking_slots is `generated always` (0038) and Postgres refuses an insert
   * that names a generated column at all - value or not - so a copy carrying it
   * failed with "cannot insert a non-DEFAULT value into column". Found while
   * 0042 was adding two more derived columns; price_per_month and
   * duration_months are stripped for the same reason, though those two are only
   * overwritten by the trigger rather than refused.
   *
   * Stripped by name rather than filtered by a schema lookup because there are
   * three of them and they are named right here where a fourth would be added.
   */
  const {
    id,
    created_at,
    updated_at,
    name,
    tracking_slots,
    price_per_month,
    duration_months,
    ...rest
  } = plan as Record<string, unknown> & {
    id: string;
    created_at: string;
    updated_at: string;
    name: string;
  };
  void id;
  void created_at;
  void updated_at;
  void tracking_slots;
  void price_per_month;
  void duration_months;

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
