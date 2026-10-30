import { notifyAdminOfPayment, notifyAdminsOfPaymentEvent } from "@/lib/email";
import { capturedPaymentFor, razorpayConfigured } from "@/lib/razorpay";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Settling a payment nobody told us about, by asking Razorpay.
 *
 * The webhook is the authority on money arriving, and on 29 Oct 2026 that was
 * not enough: a UPI payment reported "delay in response" to the browser, the
 * row was closed as failed, and the same payment was then captured. 0060 lets
 * settle_payment() settle a failed row, which mends the webhook path - but a
 * webhook can also simply never come, and then nothing would ever look again.
 *
 * This is the looking again. Razorpay's own list of payments on the order, over
 * an authenticated call, is proof of capture as good as a signed webhook, so a
 * captured id found here goes straight to settle_payment(). That function's
 * once-only transition is still the deduplication: if the webhook or the
 * handshake got there first this is told granted false and does nothing.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** How far back the sweep looks. UPI collect requests expire well inside this. */
const SWEEP_WINDOW_HOURS = 72;
/**
 * Rows younger than this are left to the handshake and the webhook, which
 * normally land within seconds. The sweep is for the ones that never do.
 */
const SWEEP_MIN_AGE_MINUTES = 3;
/** One Razorpay call per row, so a tick is bounded rather than the backlog. */
const SWEEP_BATCH = 15;

export type ReconcileOutcome = "settled" | "already_settled" | "not_captured" | "error";

/**
 * Asks Razorpay whether this order was paid, and settles it if so.
 *
 * Safe to call on any order at any time: an order with no captured payment is
 * left exactly as it was, and one already settled answers already_settled.
 */
export async function reconcileOrder(admin: Admin, orderId: string): Promise<ReconcileOutcome> {
  if (!orderId.startsWith("order_") || !razorpayConfigured()) return "not_captured";

  const captured = await capturedPaymentFor(orderId);
  if (!captured.ok) {
    console.error(`reconcile: could not ask Razorpay about ${orderId}:`, captured.error);
    return "error";
  }
  if (!captured.data) return "not_captured";

  const { data, error } = await admin.rpc("settle_payment", {
    p_order_id: orderId,
    p_payment_id: captured.data,
  });

  if (error) {
    console.error(`reconcile: settle_payment failed for ${orderId}`, error);
    return "error";
  }

  const result = (data ?? {}) as { granted?: boolean; payment_id?: string };
  if (!result.granted) return "already_settled";

  // Loud on purpose: every line like this is a payment the normal paths missed.
  console.warn(`reconcile: settled ${orderId} (${captured.data}) that the webhook and handshake missed`);
  if (result.payment_id) {
    await notifyAdminOfPayment(admin, result.payment_id);
    await notifyAdminsOfPaymentEvent(admin, result.payment_id, "payment_rescued");
  }
  return "settled";
}

/**
 * Every recent online payment not yet marked paid, checked against Razorpay.
 * Run from the cron tick. Never throws.
 */
export async function reconcileRecentPayments(
  admin: Admin,
): Promise<{ checked: number; settled: string[]; errors: number }> {
  const summary = { checked: 0, settled: [] as string[], errors: 0 };
  if (!razorpayConfigured()) return summary;

  try {
    const now = Date.now();
    const { data, error } = await admin
      .from("payments")
      .select("razorpay_order_id")
      .in("status", ["created", "failed"])
      .like("razorpay_order_id", "order_%")
      .gte("created_at", new Date(now - SWEEP_WINDOW_HOURS * 3_600_000).toISOString())
      .lte("created_at", new Date(now - SWEEP_MIN_AGE_MINUTES * 60_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(SWEEP_BATCH);

    if (error) {
      console.error("reconcile: could not list unsettled payments", error.message);
      summary.errors += 1;
      return summary;
    }

    for (const row of (data ?? []) as { razorpay_order_id: string }[]) {
      summary.checked += 1;
      const outcome = await reconcileOrder(admin, row.razorpay_order_id);
      if (outcome === "settled") summary.settled.push(row.razorpay_order_id);
      if (outcome === "error") summary.errors += 1;
    }
  } catch (error) {
    console.error("reconcile: sweep crashed", error);
    summary.errors += 1;
  }

  return summary;
}
