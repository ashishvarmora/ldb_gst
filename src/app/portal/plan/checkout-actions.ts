"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { checkCoupon, releaseCoupon, reserveCoupon } from "@/lib/coupons";
import { formatCredits } from "@/lib/credits";
import { env } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { done, fail, str } from "@/lib/forms";
import { assertPortalUser, loadOverview } from "@/lib/officer";
import { createOrder, razorpayConfigured, verifyCheckoutSignature } from "@/lib/razorpay";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  ActionResult,
  CouponVerdict,
  CreditPack,
  PaymentKind,
  Plan,
} from "@/lib/types";

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
 *
 * A discount code may be sent with either. It changes what is charged and
 * nothing else: the credits are worked out from the list price, so a code buys
 * the same goods for less money rather than less goods for the same money.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

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
      /**
       * Rupees, after any discount. This is what Razorpay was asked for, so it
       * is also what the payment window has to be opened with. The browser needs
       * paise, which the client converts.
       */
      amountInr: number;
      /** The price before the discount. Equal to amountInr when no code was used. */
      listInr: number;
      /** What the code took off, so the UI can show "500 - 100 = 400". Zero without one. */
      discountInr: number;
      /** The code as the database stores it, upper case, or null when none was used. */
      couponCode: string | null;
      /** What was bought, for the payment window's own heading. */
      itemName: string;
      /** One line under it, e.g. "500 credits" or "Growth, 3 months". */
      itemDetail: string;
      keyId: string;
    }
  | {
      ok: false;
      error: string;
      /**
       * True when the code was the reason. The buyer can fix that themselves by
       * removing or correcting it, which is a different thing to ask of them
       * than "try again in a moment" - and it must never be answered by quietly
       * charging the full price instead.
       */
      couponRefused?: boolean;
    };

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
/* what a purchase is worth                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The list price of a purchase and the credits it earns, decided on the server.
 *
 * Both start actions and the coupon preview need this same figure - the credits
 * come from it, and so does the discount - so it is worked out in one place.
 * Two places would be two answers, and one of them would be the one that took
 * the money.
 */
type Priced =
  | {
      ok: true;
      /** The price before any discount. */
      listInr: number;
      /** What the buyer receives. From listInr, never from what is paid. */
      credits: number;
      itemName: string;
      itemDetail: string;
      /** payments columns particular to this purchase. */
      columns: Record<string, string | number>;
      /** Notes Razorpay keeps against the order, for reconciling by hand. */
      notes: Record<string, string>;
    }
  | { ok: false; error: string };

async function priceCredits(admin: Admin, userId: string, fd: FormData): Promise<Priced> {
  const packId = str(fd, "pack_id");
  if (!packId) return { ok: false, error: "Pick a credit pack first." };

  // The pack row is read fresh, so the ladder used here is whatever was last
  // saved rather than whatever the buyer's page was rendered with.
  const { data: pack, error: packError } = await admin
    .from("credit_packs")
    .select("*")
    .eq("id", packId)
    .eq("is_active", true)
    .maybeSingle<CreditPack>();

  if (packError) {
    return { ok: false, error: reportError("credit pack lookup failed", packError, TROUBLE) };
  }
  if (!pack) return { ok: false, error: "That pack is no longer on sale. Pick another one." };

  /**
   * A fixed rung is its own price and its own credits, so whatever the form
   * said about an amount is ignored outright.
   *
   * An open tier does take a number from the form - it has to, the buyer
   * chooses it - but the form is user-controlled and this is money. So the
   * amount is bounded here and the credits it earns are recomputed by
   * credits_for_amount() in the database, the same function the ladder and the
   * buy page quote from. Believing a posted credit figure would let anyone with
   * the browser tools open pay Rs 5,000 for any number of credits they cared to
   * type.
   */
  let listInr = pack.price_inr;
  let credits = pack.credits;

  if (pack.is_open_ended) {
    const asked = Math.round(Number(str(fd, "amount_inr") ?? "") * 100) / 100;

    if (!Number.isFinite(asked) || asked <= 0) {
      return { ok: false, error: "Enter how much you would like to pay." };
    }
    if (asked < pack.price_inr) {
      return {
        ok: false,
        error: `The smallest top-up here is Rs ${pack.price_inr.toLocaleString("en-IN")}. Enter that or more.`,
      };
    }
    if (asked > MAX_TOPUP_INR) {
      return {
        ok: false,
        error: "That is more than can be paid in one go. Contact support for an amount that size.",
      };
    }

    const { data: computed, error: rateError } = await admin.rpc("credits_for_amount", {
      p_pack: pack.id,
      p_amount: asked,
    });

    if (rateError) {
      return { ok: false, error: reportError("credits_for_amount rpc failed", rateError, TROUBLE) };
    }

    const earned = Number(computed);
    if (!Number.isFinite(earned) || earned <= 0) {
      return { ok: false, error: "That amount does not buy any credits. Try a larger one." };
    }

    listInr = asked;
    credits = earned;
  }

  return {
    ok: true,
    listInr,
    credits,
    itemName: pack.name,
    itemDetail: `${formatCredits(credits)} credits`,
    columns: { pack_id: pack.id },
    notes: {
      user_id: userId,
      kind: "credits",
      pack_id: pack.id,
      pack_name: pack.name,
      credits: String(credits),
    },
  };
}

async function pricePlan(admin: Admin, userId: string, fd: FormData): Promise<Priced> {
  const planId = str(fd, "plan_id");
  if (!planId) return { ok: false, error: "Pick a plan first." };

  // Anything unexpected is treated as one month rather than refused: the term
  // is a convenience, and a bad value should not stop someone paying.
  const asked = Number(str(fd, "months") ?? "1");
  const months = ALLOWED_MONTHS.includes(asked) ? asked : 1;

  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("*")
    .eq("id", planId)
    .eq("is_active", true)
    .maybeSingle<Plan>();

  if (planError) return { ok: false, error: reportError("plan lookup failed", planError, TROUBLE) };
  if (!plan) return { ok: false, error: "That plan is no longer on sale. Pick another one." };

  const listInr = Math.round(plan.price_per_month * months * 100) / 100;
  if (listInr <= 0) {
    // A free plan has nothing to charge for, so there is no order to open.
    return {
      ok: false,
      error: "That plan cannot be bought online. Contact support and they will set it up.",
    };
  }

  return {
    ok: true,
    listInr,
    // credits holds the plan's own grant so the payments list can say what the
    // money bought without joining back to plans. settle_payment reads the plan
    // row itself, so this column is a record rather than an instruction.
    credits: plan.included_credits,
    itemName: `${plan.name} plan`,
    itemDetail: months === 1 ? "1 month" : `${months} months`,
    columns: { plan_id: plan.id, months },
    notes: {
      user_id: userId,
      kind: "plan",
      plan_id: plan.id,
      plan_name: plan.name,
      months: String(months),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* opening the order                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The write half of both start actions: the payment row, the coupon hold, the
 * Razorpay order. The sequence is forced, and this is why.
 *
 *   1. THE ROW FIRST. coupon_redemptions.payment_id points at payments(id), so
 *      there is nothing for a hold to reference until the row exists.
 *   2. THE HOLD SECOND. reserveCoupon is what decides the discount, and the
 *      discount decides what Razorpay is asked for. An order's amount cannot be
 *      changed once it is open, so the hold cannot come after it.
 *   3. THE ORDER LAST, then the row is stamped with its id. razorpay_order_id is
 *      NOT NULL and at step 1 there is no order, so the row opens on a
 *      placeholder. "pending_" cannot be mistaken for a Razorpay id - those all
 *      begin "order_" - and nothing looks a row up by that column in between.
 *
 * A refused code, or an order that never opened, throws the row away instead of
 * leaving a 'created' payment behind. Nothing was charged, so such a row has no
 * money to account for, and it would otherwise sit in the buyer's payment list
 * as a purchase they never made and in the webhook's path as an order that will
 * never arrive. Cleaning up is possible here precisely because this all happens
 * before the payment window opens.
 *
 * A row stranded on its placeholder by something outside this function - the
 * process dying mid-way - is inert rather than dangerous: no order exists for
 * anyone to pay, so there is no money it could fail to account for, and the
 * hold on it is released lazily by the database.
 */
async function openOrder({
  admin,
  userId,
  kind,
  priced,
  code,
}: {
  admin: Admin;
  userId: string;
  kind: PaymentKind;
  priced: Extract<Priced, { ok: true }>;
  /** Raw from the form. Whether it is worth anything is the database's to say. */
  code: string | null;
}): Promise<CheckoutStart> {
  const { listInr, credits } = priced;

  const { data: row, error: insertError } = await admin
    .from("payments")
    .insert({
      user_id: userId,
      kind,
      razorpay_order_id: `pending_${randomUUID()}`,
      amount_inr: listInr,
      discount_inr: 0,
      credits,
      status: "created",
      ...priced.columns,
    })
    .select("id")
    .single<{ id: string }>();

  // Without this row settle_payment() has nothing to match, so a payment
  // against this order could never be handed over. Better to stop here than to
  // send someone to a checkout whose money we could not account for.
  if (insertError || !row) {
    return refuse(reportError("payment row insert failed", insertError, TROUBLE));
  }

  /**
   * The only discount that may be charged is the one reserveCoupon just
   * returned. A discount posted by the form is never read - the browser is the
   * one party to this that gains by lying about it, and reserveCoupon re-checks
   * every rule inside the database against the list price worked out above.
   */
  let discountInr = 0;
  let payableInr = listInr;
  let couponId: string | null = null;
  let couponCode: string | null = null;

  if (code) {
    const verdict = await reserveCoupon({
      admin,
      code,
      userId,
      paymentId: row.id,
      amountInr: listInr,
      kind,
    });

    if (!verdict.ok) {
      await discard(admin, row.id);
      // The refusal is already written for a customer, so it is passed through
      // as it stands rather than run through friendlyError.
      return { ok: false, error: verdict.message, couponRefused: true };
    }

    discountInr = Number(verdict.discount_inr);
    payableInr = Number(verdict.payable_inr);
    couponId = verdict.coupon_id;
    couponCode = verdict.code;

    // A verdict that says ok but hands back a figure nobody could charge should
    // not become a Razorpay order for that figure. This is the one place the
    // amount is settled, so it is the one place worth checking.
    if (!Number.isFinite(payableInr) || payableInr <= 0 || payableInr > listInr) {
      await discard(admin, row.id);
      return refuse(reportError("reserve_coupon returned an unusable amount", { payableInr }, TROUBLE));
    }
  }

  // Razorpay caps the receipt at 40 characters, which a uuid plus any real
  // prefix would overrun. "u-" plus the id is 38 and still says whose it is.
  const order = await createOrder({
    amountInr: payableInr,
    receipt: `u-${userId}`,
    notes: {
      ...priced.notes,
      // Only on a discounted order, so an ordinary one keeps the notes it had.
      ...(couponCode ? { coupon: couponCode, list_inr: String(listInr) } : {}),
    },
  });

  // Razorpay's own refusals read like "Razorpay refused the order (HTTP 400)"
  // and friendlyError would pass a short sentence like that straight through.
  // Log it and say something the buyer can act on instead.
  if (!order.ok) {
    console.error("razorpay order failed:", order.error);
    await discard(admin, row.id);
    return refuse(TROUBLE);
  }

  const { error: stampError } = await admin
    .from("payments")
    .update({
      razorpay_order_id: order.data.id,
      amount_inr: payableInr,
      discount_inr: discountInr,
      coupon_id: couponId,
    })
    .eq("id", row.id);

  // settle_payment() finds the row by its order id, so one still carrying the
  // placeholder could never be settled - the money would arrive with nothing to
  // hand over. Stopping before the payment window opens is the only outcome
  // here that cannot lose someone's money.
  if (stampError) {
    await discard(admin, row.id);
    return refuse(reportError("payment row could not be stamped with the order", stampError, TROUBLE));
  }

  return {
    ok: true,
    orderId: order.data.id,
    amountInr: payableInr,
    listInr,
    discountInr,
    couponCode,
    itemName: priced.itemName,
    itemDetail: priced.itemDetail,
    // Must be the twin of the secret that opened the order, so it comes from
    // the environment - the key id in app_settings is only there for display.
    keyId: env.razorpayKeyId,
  };
}

/**
 * Undoes a checkout that never opened.
 *
 * The hold is given back before the row goes. Deleting the row would take the
 * redemption with it - payment_id cascades - but if the delete fails the claim
 * still has to be free: a single-use code locked by an order nobody ever paid
 * is the one failure here a buyer cannot work around.
 */
async function discard(admin: Admin, paymentId: string): Promise<void> {
  await releaseCoupon(admin, paymentId);
  const { error } = await admin.from("payments").delete().eq("id", paymentId);
  if (error) console.error("could not remove an unopened payment row:", error.message);
}

/* -------------------------------------------------------------------------- */
/* coupons                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a code would do to one amount, so the buyer sees the discount before
 * committing to it.
 *
 * Holds nothing, so it is safe to ask again every time the amount changes - and
 * it has to be asked again, because a minimum spend can stop applying when
 * someone edits what they are paying.
 *
 * The amount is posted, which is safe here and only here: this reads, it does
 * not charge. What is actually charged comes from reserveCoupon at checkout,
 * against a list price the server works out itself. The user id is the
 * exception - it comes from the session and never from the form, because
 * per-person limits are part of the answer and a posted id would let anyone
 * check a code as somebody else.
 */
export async function previewCoupon(
  _prev: CouponVerdict | null,
  fd: FormData,
): Promise<CouponVerdict> {
  try {
    const code = str(fd, "coupon_code");
    if (!code) return { ok: false, reason: "empty", message: "Enter a code." };

    const kind: PaymentKind = str(fd, "kind") === "plan" ? "plan" : "credits";
    const amountInr = Number(str(fd, "amount_inr") ?? "");

    if (!Number.isFinite(amountInr) || amountInr <= 0) {
      return {
        ok: false,
        reason: "unknown",
        message: "Choose what you are buying first, then apply the code.",
      };
    }

    const session = await assertPortalUser();

    return await checkCoupon({
      admin: getSupabaseAdmin(),
      code,
      userId: session.id,
      amountInr,
      kind,
    });
  } catch (error) {
    // A refusal is an ordinary verdict, so even a crash answers in that shape -
    // the caller has one thing to show either way.
    return {
      ok: false,
      reason: "unknown",
      message: reportError(
        "previewCoupon crashed",
        error,
        "That code could not be checked. Try again.",
      ),
    };
  }
}

/* -------------------------------------------------------------------------- */
/* credits                                                                     */
/* -------------------------------------------------------------------------- */

export async function startCheckout(
  _prev: CheckoutStart | null,
  fd: FormData,
): Promise<CheckoutStart> {
  try {
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

    const priced = await priceCredits(admin, session.id, fd);
    if (!priced.ok) return refuse(priced.error);

    return await openOrder({
      admin,
      userId: session.id,
      kind: "credits",
      priced,
      code: str(fd, "coupon_code"),
    });
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
    const session = await assertPortalUser();
    const admin = getSupabaseAdmin();

    const blocked = await paymentBlocked();
    if (blocked) return refuse(blocked);

    const priced = await pricePlan(admin, session.id, fd);
    if (!priced.ok) return refuse(priced.error);

    return await openOrder({
      admin,
      userId: session.id,
      kind: "plan",
      priced,
      code: str(fd, "coupon_code"),
    });
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
      const { data: rejected } = await admin
        .from("payments")
        .update({ status: "failed", failure_reason: "Signature check failed." })
        .eq("razorpay_order_id", orderId)
        .eq("user_id", session.id)
        .eq("status", "created")
        .select("id")
        .maybeSingle<{ id: string }>();

      // Nothing was paid, so any code held against it goes back rather than
      // waiting out the lazy release.
      if (rejected) await releaseCoupon(admin, rejected.id);

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


/* -------------------------------------------------------------------------- */
/* bonus codes                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Redeeming a code that is worth credits rather than a discount.
 *
 * Nothing is bought here, so this does not go near a payment: the whole
 * exchange is a code for a balance. All the deciding happens inside
 * redeem_bonus_coupon(), under a row lock, because the eligibility checks and
 * the grant have to be one transaction - two people entering the last claim of
 * a code at the same moment must not both get it, and a redemption recorded
 * without its credits would be worse than a refusal.
 *
 * A discount code entered here is told where it belongs rather than called
 * invalid. "Your code is wrong" sends somebody to support; "use this one at
 * checkout" solves it.
 */
export async function redeemBonusCode(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();

  const code = (str(fd, "code") ?? "").toUpperCase();
  if (!code) return fail("Enter the code you were given.");

  const { data, error } = await getSupabaseAdmin().rpc("redeem_bonus_coupon", {
    p_user: session.id,
    p_code: code,
  });

  if (error) {
    return fail(reportError("redeeming a bonus code", error, "Could not check that code."));
  }

  const verdict = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    credits?: number;
    balance?: number;
  };

  if (!verdict.ok) {
    switch (verdict.reason) {
      case "unknown_code":
        return fail(`We have no code called "${code}". Check the spelling.`);
      case "is_discount":
        return fail(
          `"${code}" is a discount code, not a credit code. Enter it on the payment screen when you buy credits or a plan.`,
        );
      case "inactive":
        return fail(`"${code}" has been switched off.`);
      case "not_started":
        return fail(`"${code}" is not usable yet.`);
      case "expired":
        return fail(`"${code}" has expired.`);
      case "all_claimed":
        return fail(`"${code}" has been fully claimed.`);
      case "already_used":
        return fail(`You have already used "${code}".`);
      default:
        return fail("That code could not be used.");
    }
  }

  revalidatePath("/portal", "layout");
  revalidatePath("/portal/plan");
  revalidatePath("/portal/activity");

  return done(
    `${formatCredits(verdict.credits ?? 0)} credits added. Your balance is now ${formatCredits(verdict.balance ?? 0)}.`,
  );
}
