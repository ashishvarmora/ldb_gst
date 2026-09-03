"use server";

import { revalidatePath } from "next/cache";

import { writeAudit } from "@/lib/audit";
import { assertSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fail, done, str } from "@/lib/forms";
import { fmtRupees } from "@/lib/format";
import { OFFLINE_METHODS, methodLabel } from "@/lib/analytics";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";

/**
 * Money that arrived without the gateway.
 *
 * Cash across a desk, a bank transfer, a UPI payment straight to a phone
 * number: all real income, and until now none of it could be written down. The
 * console showed a total that was only ever the Razorpay total, and the owner
 * had to hold the rest in their head.
 *
 * Every check here is a guard against the same class of mistake - a receipt
 * typed as 50000 instead of 5000, a plan sold with no plan chosen, a second
 * copy of a receipt entered because the first did not obviously save. What the
 * money BUYS is not decided here: record_offline_payment() hands off to
 * settle_payment(), the same function the Razorpay webhook calls, so an
 * offline sale grants credits, assigns a plan, extends an expiry and settles a
 * referral in exactly the way an online one does.
 */

/** Nobody sells a plan for more than this, so a figure above it is a typo. */
const MAX_AMOUNT = 10_00_000;

/** Rupees from a form. Two decimals, positive, and within reach of reality. */
function readAmount(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw.replace(/[,\s₹]/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > MAX_AMOUNT) return null;
  return Math.round(value * 100) / 100;
}

function readCredits(raw: string | null): number | null {
  if (raw === null) return null;
  const value = Number(raw.replace(/[,\s]/g, ""));
  if (!Number.isFinite(value) || value <= 0 || value > 10_00_000) return null;
  return Math.round(value * 100) / 100;
}

type SettleResult = { ok?: boolean; granted?: boolean; reason?: string; credits?: number };

/** What each refusal from the database means in words a person can act on. */
const REFUSALS: Record<string, string> = {
  amount_must_be_positive: "Enter the amount that was actually received.",
  bad_method: "Choose how the money arrived.",
  bad_kind: "Choose whether this paid for a plan or for credits.",
  plan_required: "Pick which plan this paid for.",
  credits_required: "Enter how many credits this bought.",
  no_such_user: "That customer no longer exists.",
  not_pending: "That receipt was already recorded.",
};

export async function recordOfflinePayment(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const userId = str(fd, "user_id");
  if (!userId) return fail("Choose the customer this money came from.");

  const method = str(fd, "method");
  if (!method || !OFFLINE_METHODS.some((m) => m.key === method)) {
    return fail("Choose how the money arrived.");
  }

  const amount = readAmount(str(fd, "amount_inr"));
  if (amount === null) {
    return fail(`Enter the amount in rupees — more than zero, up to ${fmtRupees(MAX_AMOUNT)}.`);
  }

  const kind = str(fd, "kind") === "plan" ? "plan" : "credits";
  const planId = kind === "plan" ? str(fd, "plan_id") : null;
  if (kind === "plan" && !planId) return fail("Pick which plan this paid for.");

  /*
   * For a credits sale the count IS the purchase, so it is required. For a
   * plan sale it is the optional top-up sold in the same receipt - the offline
   * twin of the portal's combined checkout, for the customer paying cash
   * across a desk - so a blank box is a plan-only sale, and only a box with
   * something unusable in it is an error.
   */
  const creditsRaw = str(fd, "credits");
  const credits = kind === "credits" || creditsRaw !== null ? readCredits(creditsRaw) : 0;
  if (credits === null) {
    return fail(
      kind === "credits"
        ? "Enter how many credits this payment bought."
        : "Credits on top must be a number above zero — or leave the box empty.",
    );
  }

  /*
   * Months only mean anything for a plan, and a plan bought for zero months is
   * a plan that expires the moment it is sold. Clamped rather than rejected:
   * one month is unambiguously what an empty box means.
   */
  const monthsRaw = Number(str(fd, "months") ?? "1");
  const months = Number.isFinite(monthsRaw) ? Math.min(Math.max(Math.trunc(monthsRaw), 1), 36) : 1;

  /*
   * The date the money actually arrived, which is often not today - a cheque
   * cleared last Tuesday belongs in last Tuesday's revenue, or every monthly
   * total is wrong by however long the paperwork took. A future date is
   * refused: revenue that has not happened yet is not revenue.
   */
  const paidOn = str(fd, "paid_on");
  let paidAt: string | null = null;
  if (paidOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) return fail("Give the date as YYYY-MM-DD.");
    // Midday IST, so the row lands on the intended IST date whatever the
    // server's own clock is set to.
    const at = new Date(`${paidOn}T06:30:00Z`);
    if (Number.isNaN(at.getTime())) return fail("That is not a date.");
    if (at.getTime() > Date.now()) return fail("That date is in the future.");
    paidAt = at.toISOString();
  }

  const { data: customer } = await admin
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle<{ full_name: string | null; email: string }>();
  if (!customer) return fail("That customer no longer exists.");

  const { data, error } = await admin.rpc("record_offline_payment", {
    p_user: userId,
    p_amount: amount,
    p_method: method,
    p_kind: kind,
    p_credits: credits ?? 0,
    p_plan: planId,
    p_months: months,
    p_actor: actor.id,
    p_note: str(fd, "note"),
    p_paid_at: paidAt,
  });

  if (error) return fail(error.message);

  const result = (data ?? {}) as SettleResult;
  if (result.ok === false || result.granted === false) {
    return fail(REFUSALS[result.reason ?? ""] ?? "That receipt could not be recorded.");
  }

  await writeAudit(actor, {
    action: "payment.record_offline",
    entity: "payment",
    entityId: userId,
    entityLabel: customer.full_name ?? customer.email,
    meta: { amount_inr: amount, method, kind, months, credits: result.credits ?? credits, paid_at: paidAt },
  });

  revalidatePath("/admin/finance");
  revalidatePath(`/admin/officers/${userId}`);

  const bought =
    kind === "plan"
      ? `a plan for ${months} month${months === 1 ? "" : "s"}${
          credits > 0 ? ` plus ${formatCredits(credits)} credits on top` : ""
        }`
      : `${formatCredits(result.credits ?? credits ?? 0)} credits`;

  return done(
    `Recorded ${fmtRupees(amount)} by ${methodLabel(method).toLowerCase()} for ${customer.full_name ?? customer.email} — ${bought}.`,
  );
}
