import { NextResponse, type NextRequest } from "next/server";

import { verifyWebhookSignature } from "@/lib/razorpay";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Razorpay's webhook. Point Razorpay at /api/webhooks/razorpay.
 *
 * THIS, not the browser, decides whether a payment happened. The checkout
 * handshake in checkout-actions.ts is a convenience: the officer can close the
 * tab, lose signal or kill the app the instant after paying, and then nothing
 * ever comes back from the browser. Razorpay retries this endpoint until it is
 * acknowledged, so the money is always accounted for eventually.
 *
 * The two paths meet at credit_payment(), which only matches a payment still in
 * 'created'. Whichever arrives first grants the credits; the other finds
 * nothing to do. That is what makes running both safe.
 */

// Node, not edge: the signature is an HMAC from node:crypto.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PaymentEntity = {
  id?: string;
  order_id?: string;
  error_description?: string;
  error_reason?: string;
  error_code?: string;
};

type WebhookBody = {
  event?: string;
  payload?: { payment?: { entity?: PaymentEntity } };
};

export async function POST(request: NextRequest) {
  // Read the body as text before anything parses it. The HMAC covers the exact
  // bytes Razorpay sent, and a parse-then-restringify round trip would reorder
  // keys or drop whitespace and never match.
  const raw = await request.text();

  if (!verifyWebhookSignature(raw, request.headers.get("x-razorpay-signature"))) {
    console.warn("razorpay webhook: signature rejected");
    // No detail in the reply: anything specific here helps someone guessing.
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  let body: WebhookBody;
  try {
    body = JSON.parse(raw) as WebhookBody;
  } catch (error) {
    // Signed by Razorpay but unreadable, so retrying will not help. A 200 stops
    // the retry loop; the log is what someone actually needs.
    console.error("razorpay webhook: signed body would not parse", error);
    return NextResponse.json({ ok: true, ignored: "unparsable" });
  }

  const event = body.event ?? "";
  const entity = body.payload?.payment?.entity ?? {};
  const orderId = entity.order_id ?? "";
  const paymentId = entity.id ?? "";

  if (!orderId) {
    console.warn(`razorpay webhook: ${event || "event"} carried no order id`);
    return NextResponse.json({ ok: true, ignored: "no order id" });
  }

  const admin = getSupabaseAdmin();

  try {
    if (event === "payment.captured") {
      const { data, error } = await admin.rpc("credit_payment", {
        p_order_id: orderId,
        p_payment_id: paymentId,
      });

      if (error) {
        // A 500 here is correct: this is the one case where a Razorpay retry is
        // exactly what we want, because the credits have not been granted yet.
        console.error(`razorpay webhook: credit_payment failed for ${orderId}`, error);
        return NextResponse.json({ ok: false }, { status: 500 });
      }

      const result = (data ?? {}) as { granted?: boolean };
      return NextResponse.json({ ok: true, granted: result.granted === true });
    }

    if (event === "payment.failed") {
      const reason =
        entity.error_description ?? entity.error_reason ?? entity.error_code ?? "Payment failed.";

      // Only a payment still waiting: a row already credited must not be
      // reopened by a late or replayed failure event.
      const { error } = await admin
        .from("payments")
        .update({ status: "failed", failure_reason: reason })
        .eq("razorpay_order_id", orderId)
        .eq("status", "created");

      if (error) {
        console.error(`razorpay webhook: could not mark ${orderId} failed`, error);
      }

      // Still a 200 - no amount of retrying makes a failed payment succeed.
      return NextResponse.json({ ok: true, marked: "failed" });
    }
  } catch (error) {
    console.error(`razorpay webhook: ${event} crashed for ${orderId}`, error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // Razorpay sends a great deal we do not act on (order.paid, refunds, settlement
  // notices). Acknowledging them is what stops the retries.
  return NextResponse.json({ ok: true, ignored: event || "unknown event" });
}
