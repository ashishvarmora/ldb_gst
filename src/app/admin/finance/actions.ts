"use server";

import { revalidatePath } from "next/cache";

import { writeAudit } from "@/lib/audit";
import { assertSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { notifyAdminOfPayment } from "@/lib/email";
import { fail, done, str } from "@/lib/forms";
import { fmtDate, fmtRupees } from "@/lib/format";
import { OFFLINE_METHODS, methodLabel } from "@/lib/analytics";
import { reconcileOrder } from "@/lib/payment-reconcile";
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

type SettleResult = {
  ok?: boolean;
  granted?: boolean;
  reason?: string;
  credits?: number;
  /** The date settle_payment() actually wrote, or null for a plan with no end. */
  plan_expires_on?: string | null;
  /** The row that settled. Read only to notify an admin about it. */
  payment_id?: string;
};

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

/**
 * "The customer says they paid, the row says failed" - answered by Razorpay.
 *
 * THIS IS THE BUTTON TO PRESS INSTEAD OF ASSIGNING THE PLAN BY HAND. On 29 Oct
 * 2026 a captured payment sat on a failed row, an admin assigned the plan and
 * credits manually, and when the payment later settled properly the customer
 * held two terms and two grants for one Rs 149. Settling the ORDER keeps one
 * record: the real payment id, the plan from the plan row, the credits once,
 * and the referral and receipt that a hand-grant never produces.
 *
 * Asks Razorpay for a captured payment on the order and, if there is one, runs
 * it through settle_payment() - see src/lib/payment-reconcile.ts. Nothing is
 * granted without Razorpay saying the money was captured.
 */
export async function recheckPayment(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const orderId = str(fd, "order_id");
  if (!orderId?.startsWith("order_")) return fail("Only online orders can be checked with Razorpay.");

  const { data: row } = await admin
    .from("payments")
    .select("user_id, status")
    .eq("razorpay_order_id", orderId)
    .maybeSingle<{ user_id: string; status: string }>();
  if (!row) return fail("No payment with that order id.");
  if (row.status === "paid") return done("Already paid and settled.");

  const outcome = await reconcileOrder(admin, orderId);

  if (outcome === "error") return fail("Razorpay could not be reached. Try again in a minute.");
  if (outcome === "not_captured") {
    return done("Razorpay has no captured payment on this order — nothing was charged.");
  }

  await writeAudit(actor, {
    action: "payment.recheck",
    entity: "payment",
    entityId: row.user_id,
    entityLabel: orderId,
    meta: { order_id: orderId, outcome },
  });

  revalidatePath("/admin/finance");
  revalidatePath(`/admin/officers/${row.user_id}`);

  return done(
    outcome === "settled"
      ? "Razorpay captured this payment. Settled now — plan and credits handed over."
      : "Already settled.",
  );
}

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
    /*
     * Always one, and no longer read off the form.
     *
     * p_months used to be a number an admin typed, and pricePlan()'s twin
     * arithmetic charged price_per_month by it - so a receipt for a ninety-day
     * plan could be entered as "3 months" and stamped a term the plan does not
     * have. The amount received is typed in full above, settle_payment() takes
     * the length of access from plans.duration_days, and payments.months is a
     * historical column that multiplies nothing (0042).
     */
    p_months: 1,
    p_actor: actor.id,
    p_note: str(fd, "note"),
    p_paid_at: paidAt,
  });

  if (error) return fail(error.message);

  const result = (data ?? {}) as SettleResult;
  if (result.ok === false || result.granted === false) {
    return fail(REFUSALS[result.reason ?? ""] ?? "That receipt could not be recorded.");
  }

  /*
   * A hand-entered receipt notifies too, on the same condition as the two
   * online doors: granted true, once, from the settlement itself.
   *
   * IT WAS A CLOSE CALL. The argument against is that the person who would be
   * mailed is often the person who just typed this, and the screen has already
   * told them what was recorded - so it is a mail about your own keystrokes.
   *
   * It notifies anyway, for three reasons. The money is as real as Razorpay's
   * and record_offline_payment() settles it through the very same
   * settle_payment(), so hooking the settlement rather than the door means one
   * rule, one place to get the once-only reasoning right, and no chance of a
   * future fourth door being forgotten. The notification address is not
   * necessarily the person at the keyboard - a second admin taking cash is
   * exactly the event an owner wants to hear about. And the mail says
   * "Recorded by hand as cash by <name>", so it is distinguishable at a glance
   * from a self-service purchase; an owner who finds their own receipts noisy
   * has a switch for it on the settings page.
   *
   * Before the audit write on purpose: both are bookkeeping, neither can
   * throw, and this one is the one somebody is waiting on.
   */
  if (result.payment_id) await notifyAdminOfPayment(admin, result.payment_id);

  await writeAudit(actor, {
    action: "payment.record_offline",
    entity: "payment",
    entityId: userId,
    entityLabel: customer.full_name ?? customer.email,
    meta: {
      amount_inr: amount,
      method,
      kind,
      plan_id: planId,
      credits: result.credits ?? credits,
      paid_at: paidAt,
    },
  });

  revalidatePath("/admin/finance");
  revalidatePath(`/admin/officers/${userId}`);

  /*
   * The term the plan actually grants, not a number the form collected. This
   * said "a plan for 1 month" whatever was bought, because `months` defaulted
   * to 1 and never described the term - settle_payment() returns the expiry it
   * set, so the receipt now quotes the date it wrote.
   */
  const bought =
    kind === "plan"
      ? `a plan${result.plan_expires_on ? ` until ${fmtDate(result.plan_expires_on)}` : " with no end date"}${
          credits > 0 ? ` plus ${formatCredits(credits)} credits on top` : ""
        }`
      : `${formatCredits(result.credits ?? credits ?? 0)} credits`;

  return done(
    `Recorded ${fmtRupees(amount)} by ${methodLabel(method).toLowerCase()} for ${customer.full_name ?? customer.email} — ${bought}.`,
  );
}
