"use server";

import { revalidatePath } from "next/cache";

import { formatCredits } from "@/lib/credits";
import { env } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { done, fail, str } from "@/lib/forms";
import { assertPortalUser, loadOverview } from "@/lib/officer";
import { createOrder, razorpayConfigured, verifyCheckoutSignature } from "@/lib/razorpay";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, CreditPack } from "@/lib/types";

/**
 * Buying credits, in two halves.
 *
 * startCheckout opens the order and records it. confirmCheckout takes what the
 * browser hands back and, if the signature proves it, credits the account
 * straight away so the officer sees the new balance without waiting.
 *
 * Neither of these is the authority on whether money arrived - the webhook is.
 * This path exists only so the common case feels immediate.
 */

/**
 * startCheckout has to hand the browser three values - the order id, the amount
 * and the public key id - and ActionResult has nowhere to put them. Widening
 * ActionResult would push an optional payload onto every form in the app for
 * the sake of one caller, so this action carries its own shape and BuyCredits
 * calls it directly rather than through ActionForm.
 */
export type CheckoutStart =
  | {
      ok: true;
      orderId: string;
      /** Rupees. The browser needs paise, which BuyCredits converts. */
      amountInr: number;
      credits: number;
      packName: string;
      keyId: string;
    }
  | { ok: false; error: string };

function refuse(error: string): CheckoutStart {
  return { ok: false, error };
}

/** Nothing was charged, and trying again is the right next move. */
const PACK_TROUBLE = "Payment could not be started just now. Please try again in a moment.";

export async function startCheckout(
  _prev: CheckoutStart | null,
  fd: FormData,
): Promise<CheckoutStart> {
  try {
    const packId = str(fd, "pack_id");
    if (!packId) return refuse("Pick a credit pack first.");

    const session = await assertPortalUser();
    const admin = getSupabaseAdmin();

    const [overview, settings] = await Promise.all([loadOverview(session.id), loadSettings(admin)]);
    if (!overview) return refuse("Could not read your account. Please sign in again.");

    // The product owner's rule: an account may add credits only while a plan is
    // live. Without one the packs are visible but nothing can be bought.
    if (!overview.plan_active) {
      return refuse(
        "Credits can be bought only while a plan is active on your account. Ask your administrator to assign or renew one.",
      );
    }

    if (!settings.razorpayEnabled) {
      return refuse("Credits are added by your administrator. Ask them for a top up.");
    }

    // Switched on in the admin panel, but the keys are missing from the
    // environment - an operator problem, described without saying so.
    if (!razorpayConfigured()) {
      return refuse("Online payment is not available yet. Ask your administrator to add credits.");
    }

    // Price and credits come from the pack row and nowhere else, so the ladder
    // is whatever the admin last saved.
    const { data: pack, error: packError } = await admin
      .from("credit_packs")
      .select("*")
      .eq("id", packId)
      .eq("is_active", true)
      .maybeSingle<CreditPack>();

    if (packError) {
      return refuse(reportError("credit pack lookup failed", packError, PACK_TROUBLE));
    }
    if (!pack) return refuse("That pack is no longer on sale. Pick another one.");

    // Razorpay caps the receipt at 40 characters, which a uuid plus any real
    // prefix would overrun. "u-" plus the id is 38 and still says whose it is.
    const order = await createOrder({
      amountInr: pack.price_inr,
      receipt: `u-${session.id}`,
      notes: {
        user_id: session.id,
        pack_id: pack.id,
        pack_name: pack.name,
        credits: String(pack.credits),
      },
    });

    // Razorpay's own refusals read like "Razorpay refused the order (HTTP 400)"
    // and friendlyError would pass a short sentence like that straight through.
    // Log it and say something an officer can act on instead.
    if (!order.ok) {
      console.error("razorpay order failed:", order.error);
      return refuse(PACK_TROUBLE);
    }

    const { error: insertError } = await admin.from("payments").insert({
      user_id: session.id,
      pack_id: pack.id,
      razorpay_order_id: order.data.id,
      amount_inr: pack.price_inr,
      credits: pack.credits,
      status: "created",
    });

    // Without this row credit_payment() has nothing to match, so a payment
    // against this order could never be credited. Better to stop here than to
    // send the officer to a checkout whose money we could not account for.
    if (insertError) {
      return refuse(reportError("payment row insert failed", insertError, PACK_TROUBLE));
    }

    return {
      ok: true,
      orderId: order.data.id,
      amountInr: pack.price_inr,
      credits: pack.credits,
      packName: pack.name,
      // Must be the twin of the secret that opened the order, so it comes from
      // the environment - the key id in app_settings is only there for display.
      keyId: env.razorpayKeyId,
    };
  } catch (error) {
    return refuse(reportError("startCheckout crashed", error, PACK_TROUBLE));
  }
}

/**
 * The handshake Razorpay's checkout returns to the browser.
 *
 * Its signature is the only reason to believe a browser that says it paid, so
 * nothing is credited until verifyCheckoutSignature agrees.
 */
export async function confirmCheckout(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const orderId = str(fd, "razorpay_order_id");
    const paymentId = str(fd, "razorpay_payment_id");
    const signature = str(fd, "razorpay_signature");

    if (!orderId || !paymentId || !signature) {
      return fail("The payment could not be confirmed here. Your balance will update shortly.");
    }

    const session = await assertPortalUser();
    const admin = getSupabaseAdmin();

    if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
      console.warn(`checkout signature rejected for order ${orderId}`);

      // Scoped to this officer so a stray order id cannot close someone else's
      // payment, and to 'created' so a row the webhook already settled is left
      // alone.
      await admin
        .from("payments")
        .update({ status: "failed", failure_reason: "Signature check failed." })
        .eq("razorpay_order_id", orderId)
        .eq("user_id", session.id)
        .eq("status", "created");

      return fail("We could not verify that payment. Nothing was charged to your balance.");
    }

    const { data, error } = await admin.rpc("credit_payment", {
      p_order_id: orderId,
      p_payment_id: paymentId,
    });

    if (error) {
      // The money is fine - only our fast path failed. Say so plainly rather
      // than implying the payment was lost.
      reportError("credit_payment rpc failed", error);
      return fail("Payment received. Your balance will update in a moment.");
    }

    const result = (data ?? {}) as { granted?: boolean; credits?: number };

    revalidatePath("/portal/plan");

    return done(
      result.granted
        ? `${formatCredits(result.credits)} credits added to your balance.`
        : "This payment is already recorded. Your balance is up to date.",
    );
  } catch (error) {
    return fail(reportError("confirmCheckout crashed", error));
  }
}
