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
import type { ActionResult, CreditPack, Plan } from "@/lib/types";

/**
 * Buying, in two halves.
 *
 * A start action opens the order and records it. confirmCheckout takes what the
 * browser hands back and, if the signature proves it, hands over what was bought
 * straight away so the new balance is on screen without a wait.
 *
 * Neither of these is the authority on whether money arrived - the webhook is.
 * This path exists only so the common case feels immediate.
 *
 * Two things can be bought, and the gates differ:
 *   - a PLAN is what an account with nothing buys first, so it cannot require a
 *     plan to be active;
 *   - CREDITS top up an account that already has a plan, and stay gated on it.
 * Once the plan's trucks are all in use the answer is more credits, never a
 * second copy of the plan.
 */

/**
 * A start action has to hand the browser the order id, the amount and the public
 * key id, and ActionResult has nowhere to put them. Widening ActionResult would
 * push an optional payload onto every form in the app for the sake of two
 * callers, so these actions carry their own shape and the client calls them
 * directly rather than through ActionForm.
 */
export type CheckoutStart =
  | {
      ok: true;
      orderId: string;
      /** Rupees. The browser needs paise, which the client converts. */
      amountInr: number;
      /** Credits this purchase hands over - a pack's size, or a plan's grant. */
      credits: number;
      /** What was bought, for the payment window's own heading. */
      itemName: string;
      /** One line under it, e.g. "500 credits" or "Growth, 3 months". */
      itemDetail: string;
      keyId: string;
    }
  | { ok: false; error: string };

function refuse(error: string): CheckoutStart {
  return { ok: false, error };
}

/** Nothing was charged, and trying again is the right next move. */
const TROUBLE = "Payment could not be started just now. Please try again in a moment.";

/**
 * Terms a plan may be bought for. Longer terms mean fewer renewals, not a
 * discount. A "use server" module may only export async functions, so this is
 * private here and mirrored by PLAN_MONTHS in BuyCredits.tsx, which draws the
 * picker; the two must stay in step.
 */
const ALLOWED_MONTHS = [1, 3, 6, 12];

/**
 * The most a single top-up may be for. Matches the ceiling the admin form puts
 * on a pack price, so nothing can be bought that could not have been priced.
 */
const MAX_TOPUP_INR = 10_000_000;

/**
 * The checks that apply to any purchase: is online payment switched on, and are
 * the keys actually present. Returns the refusal, or null when it may proceed.
 */
async function paymentBlocked(): Promise<string | null> {
  const settings = await loadSettings(getSupabaseAdmin());

  if (!settings.razorpayEnabled) {
    return "Online payment is switched off at the moment. Contact support and they will set your account up.";
  }
  // Switched on in the admin panel, but the keys are missing from the
  // environment - an operator problem, described without saying so.
  if (!razorpayConfigured()) {
    return "Online payment is not available yet. Please try again later, or contact support.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* credits                                                                     */
/* -------------------------------------------------------------------------- */

export async function startCheckout(
  _prev: CheckoutStart | null,
  fd: FormData,
): Promise<CheckoutStart> {
  try {
    const packId = str(fd, "pack_id");
    if (!packId) return refuse("Pick a credit pack first.");

    const session = await assertPortalUser();
    const admin = getSupabaseAdmin();

    const [overview, blocked] = await Promise.all([loadOverview(session.id), paymentBlocked()]);
    if (!overview) return refuse("Could not read your account. Please sign in again.");

    // Credits top up a plan that is already running. Without one there is no
    // truck limit to spend them against, so a plan is the thing to buy first.
    if (!overview.plan_active) {
      return refuse("Choose a plan first. Credits top up an account that already has one.");
    }
    if (blocked) return refuse(blocked);

    // The pack row is read fresh, so the ladder used here is whatever was last
    // saved rather than whatever the buyer's page was rendered with.
    const { data: pack, error: packError } = await admin
      .from("credit_packs")
      .select("*")
      .eq("id", packId)
      .eq("is_active", true)
      .maybeSingle<CreditPack>();

    if (packError) {
      return refuse(reportError("credit pack lookup failed", packError, TROUBLE));
    }
    if (!pack) return refuse("That pack is no longer on sale. Pick another one.");

    /**
     * What this purchase is worth, decided here and nowhere else.
     *
     * A fixed rung is its own price and its own credits, so whatever the form
     * said about an amount is ignored outright.
     *
     * An open tier does take a number from the form - it has to, the buyer
     * chooses it - but the form is user-controlled and this is money. So the
     * amount is bounded here and the credits it earns are recomputed by
     * credits_for_amount() in the database, the same function the ladder and
     * the buy page quote from. Believing a posted credit figure would let
     * anyone with the browser tools open pay Rs 5,000 for any number of
     * credits they cared to type.
     */
    let amountInr = pack.price_inr;
    let credits = pack.credits;

    if (pack.is_open_ended) {
      const asked = Math.round(Number(str(fd, "amount_inr") ?? "") * 100) / 100;

      if (!Number.isFinite(asked) || asked <= 0) {
        return refuse("Enter how much you would like to pay.");
      }
      if (asked < pack.price_inr) {
        return refuse(
          `The smallest top-up here is Rs ${pack.price_inr.toLocaleString("en-IN")}. Enter that or more.`,
        );
      }
      if (asked > MAX_TOPUP_INR) {
        return refuse("That is more than can be paid in one go. Contact support for an amount that size.");
      }

      const { data: computed, error: rateError } = await admin.rpc("credits_for_amount", {
        p_pack: pack.id,
        p_amount: asked,
      });

      if (rateError) {
        return refuse(reportError("credits_for_amount rpc failed", rateError, TROUBLE));
      }

      const earned = Number(computed);
      if (!Number.isFinite(earned) || earned <= 0) {
        return refuse("That amount does not buy any credits. Try a larger one.");
      }

      amountInr = asked;
      credits = earned;
    }

    // Razorpay caps the receipt at 40 characters, which a uuid plus any real
    // prefix would overrun. "u-" plus the id is 38 and still says whose it is.
    const order = await createOrder({
      amountInr,
      receipt: `u-${session.id}`,
      notes: {
        user_id: session.id,
        kind: "credits",
        pack_id: pack.id,
        pack_name: pack.name,
        credits: String(credits),
      },
    });

    // Razorpay's own refusals read like "Razorpay refused the order (HTTP 400)"
    // and friendlyError would pass a short sentence like that straight through.
    // Log it and say something the buyer can act on instead.
    if (!order.ok) {
      console.error("razorpay order failed:", order.error);
      return refuse(TROUBLE);
    }

    const { error: insertError } = await admin.from("payments").insert({
      user_id: session.id,
      kind: "credits",
      pack_id: pack.id,
      razorpay_order_id: order.data.id,
      amount_inr: amountInr,
      credits,
      status: "created",
    });

    // Without this row settle_payment() has nothing to match, so a payment
    // against this order could never be handed over. Better to stop here than to
    // send someone to a checkout whose money we could not account for.
    if (insertError) {
      return refuse(reportError("payment row insert failed", insertError, TROUBLE));
    }

    return {
      ok: true,
      orderId: order.data.id,
      amountInr,
      credits,
      itemName: pack.name,
      itemDetail: `${formatCredits(credits)} credits`,
      // Must be the twin of the secret that opened the order, so it comes from
      // the environment - the key id in app_settings is only there for display.
      keyId: env.razorpayKeyId,
    };
  } catch (error) {
    return refuse(reportError("startCheckout crashed", error, TROUBLE));
  }
}

/* -------------------------------------------------------------------------- */
/* plans                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Opens an order for a plan - the first thing a new account buys, and the way an
 * existing one renews. Deliberately not gated on plan_active: that gate is the
 * reason this exists.
 */
export async function startPlanCheckout(
  _prev: CheckoutStart | null,
  fd: FormData,
): Promise<CheckoutStart> {
  try {
    const planId = str(fd, "plan_id");
    if (!planId) return refuse("Pick a plan first.");

    // Anything unexpected is treated as one month rather than refused: the term
    // is a convenience, and a bad value should not stop someone paying.
    const asked = Number(str(fd, "months") ?? "1");
    const months = ALLOWED_MONTHS.includes(asked) ? asked : 1;

    const session = await assertPortalUser();
    const admin = getSupabaseAdmin();

    const blocked = await paymentBlocked();
    if (blocked) return refuse(blocked);

    const { data: plan, error: planError } = await admin
      .from("plans")
      .select("*")
      .eq("id", planId)
      .eq("is_active", true)
      .maybeSingle<Plan>();

    if (planError) return refuse(reportError("plan lookup failed", planError, TROUBLE));
    if (!plan) return refuse("That plan is no longer on sale. Pick another one.");

    const amountInr = Math.round(plan.price_per_month * months * 100) / 100;
    if (amountInr <= 0) {
      // A free plan has nothing to charge for, so there is no order to open.
      return refuse("That plan cannot be bought online. Contact support and they will set it up.");
    }

    const order = await createOrder({
      amountInr,
      receipt: `u-${session.id}`,
      notes: {
        user_id: session.id,
        kind: "plan",
        plan_id: plan.id,
        plan_name: plan.name,
        months: String(months),
      },
    });

    if (!order.ok) {
      console.error("razorpay plan order failed:", order.error);
      return refuse(TROUBLE);
    }

    // credits holds the plan's own grant so the payments list can say what the
    // money bought without joining back to plans. settle_payment reads the plan
    // row itself, so this column is a record rather than an instruction.
    const { error: insertError } = await admin.from("payments").insert({
      user_id: session.id,
      kind: "plan",
      plan_id: plan.id,
      months,
      razorpay_order_id: order.data.id,
      amount_inr: amountInr,
      credits: plan.included_credits,
      status: "created",
    });

    if (insertError) {
      return refuse(reportError("plan payment row insert failed", insertError, TROUBLE));
    }

    return {
      ok: true,
      orderId: order.data.id,
      amountInr,
      credits: plan.included_credits,
      itemName: `${plan.name} plan`,
      itemDetail: months === 1 ? "1 month" : `${months} months`,
      keyId: env.razorpayKeyId,
    };
  } catch (error) {
    return refuse(reportError("startPlanCheckout crashed", error, TROUBLE));
  }
}

/* -------------------------------------------------------------------------- */
/* confirming                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The handshake Razorpay's checkout returns to the browser.
 *
 * Its signature is the only reason to believe a browser that says it paid, so
 * nothing is handed over until verifyCheckoutSignature agrees. settle_payment
 * then reads the payment row to decide what was bought - the browser never says.
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
      return fail("The payment could not be confirmed here. Your account will update shortly.");
    }

    const session = await assertPortalUser();
    const admin = getSupabaseAdmin();

    if (!verifyCheckoutSignature({ orderId, paymentId, signature })) {
      console.warn(`checkout signature rejected for order ${orderId}`);

      // Scoped to this account so a stray order id cannot close someone else's
      // payment, and to 'created' so a row the webhook already settled is left
      // alone.
      await admin
        .from("payments")
        .update({ status: "failed", failure_reason: "Signature check failed." })
        .eq("razorpay_order_id", orderId)
        .eq("user_id", session.id)
        .eq("status", "created");

      return fail("We could not verify that payment. Nothing was added to your account.");
    }

    const { data, error } = await admin.rpc("settle_payment", {
      p_order_id: orderId,
      p_payment_id: paymentId,
    });

    if (error) {
      // The money is fine - only our fast path failed. Say so plainly rather
      // than implying the payment was lost.
      reportError("settle_payment rpc failed", error);
      return fail("Payment received. Your account will update in a moment.");
    }

    const result = (data ?? {}) as { granted?: boolean; credits?: number; kind?: string };

    revalidatePath("/portal/plan");
    // The truck limit and the balance both gate other pages, so the whole
    // portal shell is stale the moment a plan settles.
    revalidatePath("/portal", "layout");

    if (!result.granted) {
      return done("This payment is already recorded. Your account is up to date.");
    }

    return done(
      result.kind === "plan"
        ? `Your plan is active${
            result.credits ? `, with ${formatCredits(result.credits)} credits to spend` : ""
          }.`
        : `${formatCredits(result.credits)} credits added to your balance.`,
    );
  } catch (error) {
    return fail(reportError("confirmCheckout crashed", error));
  }
}
