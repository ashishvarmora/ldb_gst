"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { checkCoupon, releaseCoupon, reserveCoupon } from "@/lib/coupons";
import { formatCredits, planChargeInr, planTermLabel } from "@/lib/credits";
import { env } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { done, fail, str } from "@/lib/forms";
import { assertPortalUser, loadOverview } from "@/lib/officer";
import { normaliseIndianMobile } from "@/lib/phone";
import { rateLimit, rateLimitMessage } from "@/lib/ratelimit";
import { createOrder, razorpayConfigured, verifyCheckoutSignature } from "@/lib/razorpay";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SessionUser } from "@/lib/auth";
import type {
  ActionResult,
  CouponScope,
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
 * Who is buying, for Razorpay's own name / email / contact boxes.
 *
 * Taken from the session and never from the form. The browser gains nothing by
 * telling us who is paying, and a posted name is a way to put one person's
 * details on another's receipt.
 *
 * Every field is optional, and an absent one is left OUT rather than sent
 * blank: Razorpay reads a prefill it was given as an answer, so an empty
 * `contact` produces a filled-in-and-wrong box rather than the ordinary empty
 * one somebody can just type into. Missing is the ordinary case rather than the
 * edge - profiles.phone was only made compulsory at sign-up later on, so the
 * accounts that predate it hold nothing.
 */
export type CheckoutBuyer = {
  name?: string;
  email?: string;
  /** +91 and ten digits, the one form Razorpay reads without complaint. */
  contact?: string;
};

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
      buyer: CheckoutBuyer;
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
 * The signed-in buyer's details, with anything we do not hold left out.
 *
 * The phone is put back through normaliseIndianMobile rather than passed along
 * as stored. profiles.phone is written by two forms that do not agree: sign-up
 * insists on an Indian mobile, while the portal's own profile form accepts
 * anything shaped roughly like a phone number - so the column can legitimately
 * hold "0982 5000 00" or a landline. Razorpay does nothing useful with a number
 * it cannot parse, and a wrong prefill is worse than none, so anything phone.ts
 * refuses is dropped instead of forwarded.
 */
function buyerDetails(session: SessionUser): CheckoutBuyer {
  const buyer: CheckoutBuyer = {};

  const name = session.profile.full_name?.trim();
  if (name) buyer.name = name;
  if (session.email) buyer.email = session.email;

  const contact = normaliseIndianMobile(session.profile.phone);
  if (contact) buyer.contact = contact;

  return buyer;
}

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
      /**
       * A combined plan-plus-top-up only: the pack's share of listInr, and the
       * credits it buys. Absent everywhere else. The split has to travel with
       * the price because a scoped coupon discounts one part and not the other
       * - see couponBase().
       */
      topupInr?: number;
      topupCredits?: number;
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

  const { data: plan, error: planError } = await admin
    .from("plans")
    .select("*")
    .eq("id", planId)
    .eq("is_active", true)
    .maybeSingle<Plan>();

  if (planError) return { ok: false, error: reportError("plan lookup failed", planError, TROUBLE) };
  if (!plan) return { ok: false, error: "That plan is no longer on sale. Pick another one." };

  /*
   * The plan's price, charged once. There is no multiplier left to get wrong.
   *
   * This used to be price_per_month x a `months` value posted by the browser,
   * defaulting to 1 and clamped to 1, 3, 6 or 12. Every paid plan had
   * duration_months = 1, so the sum was always the plan's own price - but the
   * arithmetic was the only reason the column was called price_per_month, and
   * the name is what made four screens tell a customer that ninety days was a
   * month. planChargeInr() reads price_inr and multiplies nothing, so a bad or
   * hostile `months` in the form can no longer change what is charged: the
   * field is not read at all.
   */
  const listInr = planChargeInr(plan);
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
    /*
     * What the order says it bought: the term settle_payment() will actually
     * grant, off duration_days. It once read the posted `months` and so a
     * ninety-day plan opened a Razorpay order labelled "1 month" - the bug
     * 0041 caught and this file no longer has a way to reproduce, because
     * `months` has stopped existing here.
     */
    itemDetail: planTermLabel(plan),
    /*
     * months is stamped 1 rather than dropped: it is a not-null column on
     * payments and a record of what the receipt was written for. It multiplies
     * nothing - 0042's comment on the column says so - and settle_payment()
     * takes the length of access from the plan row.
     */
    columns: { plan_id: plan.id, months: 1 },
    notes: {
      user_id: userId,
      kind: "plan",
      plan_id: plan.id,
      plan_name: plan.name,
      term: planTermLabel(plan),
    },
  };
}

/* -------------------------------------------------------------------------- */
/* what a code discounts on a combined order                                   */
/* -------------------------------------------------------------------------- */

/**
 * A discount code on a plan-plus-top-up payment covers the part it names.
 *
 * validate_coupon() takes one amount and one kind, and a combined payment has
 * two of each inside it. The decision, made here and shown in the pay panel:
 *
 *   applies_to 'all'      the whole sum. "20% off" means 20% off what is paid.
 *   applies_to 'plan'     the plan's share only. A "50% off plans" code that
 *                         also halved Rs 10,000 of attached credits would give
 *                         away far more than the code ever said - the coupon
 *                         names what it discounts, so that is what it
 *                         discounts.
 *   applies_to 'credits'  the top-up's share only, and the code is checked as
 *                         a credits purchase - so a credits-only code is NOT
 *                         refused on a combined payment, it just leaves the
 *                         plan price alone. Refusing it would push the buyer
 *                         into two separate payments, which is the flow this
 *                         whole feature exists to remove. With no top-up
 *                         attached it is refused with the database's own
 *                         "only applies to credit top-ups".
 *
 * The minimum-spend rule follows the base: "spend at least X" on a credits
 * code means X on credits, which is the honest reading of the code's own
 * terms. The redemption row records the base it was judged on.
 */
function couponBase(
  appliesTo: CouponScope | null,
  kind: PaymentKind,
  listInr: number,
  topupInr: number,
): { amountInr: number; kind: PaymentKind } {
  if (kind !== "plan" || topupInr <= 0) return { amountInr: listInr, kind };
  if (appliesTo === "plan") return { amountInr: rupees(listInr - topupInr), kind: "plan" };
  if (appliesTo === "credits") return { amountInr: topupInr, kind: "credits" };
  return { amountInr: listInr, kind: "plan" };
}

/** Rounded the way every price here is rounded, to the paisa. */
function rupees(amount: number): number {
  return Math.round(amount * 100) / 100;
}

/**
 * The coupon's own scope, straight off its row. Null for a code we do not
 * have, in which case the base defaults to the whole amount and
 * validate_coupon() words the refusal - this must never invent a second
 * "unknown code" answer beside the database's.
 *
 * Read with the service client rather than through validate_coupon because the
 * scope is needed BEFORE validation: it decides which amount to validate. RLS
 * keeps coupons unreadable to customers; this read happens server-side only,
 * and nothing from it reaches the browser except the discount it leads to.
 */
async function couponAppliesTo(admin: Admin, code: string): Promise<CouponScope | null> {
  const trimmed = code.trim().toUpperCase();
  if (!trimmed) return null;

  const { data } = await admin
    .from("coupons")
    .select("applies_to")
    .eq("code", trimmed)
    .maybeSingle<{ applies_to: CouponScope }>();

  return data?.applies_to ?? null;
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
  buyer,
}: {
  admin: Admin;
  userId: string;
  kind: PaymentKind;
  priced: Extract<Priced, { ok: true }>;
  /** Raw from the form. Whether it is worth anything is the database's to say. */
  code: string | null;
  buyer: CheckoutBuyer;
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
    /*
     * On a combined order the code is judged against the part it names - see
     * couponBase(). The hold, the discount and the redemption row all carry
     * that base; only the payable figure is worked back out against the whole.
     */
    const topupInr = priced.topupInr ?? 0;
    const appliesTo = topupInr > 0 ? await couponAppliesTo(admin, code) : null;
    const base = couponBase(appliesTo, kind, listInr, topupInr);

    const verdict = await reserveCoupon({
      admin,
      code,
      userId,
      paymentId: row.id,
      amountInr: base.amountInr,
      kind: base.kind,
    });

    if (!verdict.ok) {
      await discard(admin, row.id);
      // The refusal is already written for a customer, so it is passed through
      // as it stands rather than run through friendlyError.
      return { ok: false, error: verdict.message, couponRefused: true };
    }

    discountInr = Number(verdict.discount_inr);
    /*
     * From the whole price, not from verdict.payable_inr - the verdict only
     * knows the base it judged. validate_coupon caps the discount below its
     * base, and the base is never more than the whole, so this stays >= 1.
     */
    payableInr = rupees(listInr - discountInr);
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
    buyer,
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

    /*
     * The top-up's share of a combined plan-plus-credits amount, when there is
     * one. Posted so the preview can judge the code against the same base the
     * checkout will - couponBase() - and quote the same figure. Clamped into
     * the amount because both halves come from the form and this must not be
     * talked into a negative plan price. A lie here misleads only the preview;
     * the checkout re-derives the split from what it prices itself.
     */
    const topupRaw = Number(str(fd, "topup_inr") ?? "");
    const topupInr =
      kind === "plan" && Number.isFinite(topupRaw)
        ? Math.min(Math.max(topupRaw, 0), amountInr)
        : 0;

    const session = await assertPortalUser();

    /*
     * This reads rather than charges, but it still answers "is this a real
     * code" - which is the entire content of a brute-force attack on a discount
     * code. Throttled generously, because the box is genuinely re-asked every
     * time the amount changes and a buyer editing an open-tier figure must not
     * be told off for it.
     */
    const throttle = await rateLimit("coupon:preview", session.id);
    if (!throttle.allowed) {
      return { ok: false, reason: "unknown", message: rateLimitMessage(throttle, "codes checked") };
    }

    const admin = getSupabaseAdmin();

    if (topupInr > 0) {
      const appliesTo = await couponAppliesTo(admin, code);
      const base = couponBase(appliesTo, kind, amountInr, topupInr);

      const verdict = await checkCoupon({
        admin,
        code,
        userId: session.id,
        amountInr: base.amountInr,
        kind: base.kind,
      });

      if (!verdict.ok) return verdict;

      // The discount came off the base; what is payable is the whole sum less
      // that. applies_to rides along so the pay panel can say which part the
      // code covered - the on-screen half of the couponBase() decision.
      return {
        ...verdict,
        payable_inr: rupees(amountInr - Number(verdict.discount_inr)),
        applies_to: appliesTo ?? "all",
      };
    }

    return await checkCoupon({
      admin,
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

    const throttle = await rateLimit("checkout:user", session.id);
    if (!throttle.allowed) return refuse(rateLimitMessage(throttle, "payments started"));

    const admin = getSupabaseAdmin();

    const [overview, blocked] = await Promise.all([loadOverview(session.id), paymentBlocked()]);
    if (!overview) return refuse("Could not read your account. Please sign in again.");

    /*
     * No plan gate, and 0041 makes it matter more rather than less.
     *
     * Credits buy manual search whether or not a plan is running, so refusing
     * the sale without one refused money for a thing that works - and left a
     * lapsed customer unable to spend the balance they had already paid for.
     * A finished FREE TRIAL is now the one account that cannot spend its
     * balance, and this is precisely the route out of it: buying credits is
     * what unfreezes the wallet, so gating the sale on a plan would be a dead
     * end with no door. overview is still loaded: it is what priceCredits() and
     * the coupon check read.
     */
    if (blocked) return refuse(blocked);

    const priced = await priceCredits(admin, session.id, fd);
    if (!priced.ok) return refuse(priced.error);

    return await openOrder({
      admin,
      userId: session.id,
      kind: "credits",
      priced,
      code: str(fd, "coupon_code"),
      buyer: buyerDetails(session),
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

    /*
     * Shares the bucket with the credit checkout on purpose. Both open a real
     * Razorpay order and both can hold a coupon claim while they do, so the
     * thing worth capping is orders opened per account, not orders of one
     * particular sort.
     */
    const throttle = await rateLimit("checkout:user", session.id);
    if (!throttle.allowed) return refuse(rateLimitMessage(throttle, "payments started"));

    const admin = getSupabaseAdmin();

    const [overview, blocked] = await Promise.all([loadOverview(session.id), paymentBlocked()]);
    if (blocked) return refuse(blocked);

    let priced = await pricePlan(admin, session.id, fd);
    if (!priced.ok) return refuse(priced.error);

    /*
     * RENEWAL ONLY WHEN EXPIRED - the owner's rule, enforced here because this
     * is the only door a plan can be bought through.
     *
     * Only the SAME plan is refused, and only while it is still running. A
     * customer buying a DIFFERENT plan is upgrading, not renewing early, and
     * settle_payment() counts their new term on from the expiry they have
     * already paid for rather than throwing those days away - so nothing is
     * lost by letting it through. A trial is never a renewal either: moving
     * off it onto a paid plan is the entire point of it, and the trial itself
     * can never be bought because it is free and pricePlan() refuses a zero
     * price.
     */
    if (overview?.plan_active && overview.plan_id === priced.columns.plan_id) {
      return refuse(
        overview.plan_expires_on
          ? `This plan is already running until ${overview.plan_expires_on}. You can renew it once it ends.`
          : "This plan is already running on your account.",
      );
    }

    /*
     * An optional credit top-up, bought in the same payment.
     *
     * The pack part is priced by priceCredits() - the same function, the same
     * bounds and the same credits_for_amount() recompute the top-up shop uses -
     * so a figure that could not be bought alone cannot be bought here either.
     * The two parts are then one order and one payment row: settle_payment()
     * grants both, and the referral reads the combined amount, which is the
     * whole reason the owner asked for this.
     *
     * topup_credits on the row is the INSTRUCTION for the top-up, fixed now so
     * the ladder moving before the webhook lands cannot change what was paid
     * for. credits keeps recording the plan's included allowance, exactly as a
     * plan-only payment does.
     */
    if (str(fd, "pack_id")) {
      const pack = await priceCredits(admin, session.id, fd);
      if (!pack.ok) return refuse(pack.error);

      priced = {
        ok: true,
        listInr: rupees(priced.listInr + pack.listInr),
        credits: priced.credits,
        topupInr: pack.listInr,
        topupCredits: pack.credits,
        itemName: priced.itemName,
        itemDetail: `${priced.itemDetail} + ${formatCredits(pack.credits)} credits`,
        columns: { ...priced.columns, ...pack.columns, topup_credits: pack.credits },
        notes: {
          ...priced.notes,
          pack_id: String(pack.columns.pack_id ?? ""),
          pack_name: pack.itemName,
          topup_inr: String(pack.listInr),
          topup_credits: String(pack.credits),
        },
      };
    }

    return await openOrder({
      admin,
      userId: session.id,
      kind: "plan",
      priced,
      code: str(fd, "coupon_code"),
      buyer: buyerDetails(session),
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

    const result = (data ?? {}) as {
      granted?: boolean;
      credits?: number;
      kind?: string;
      payment_id?: string;
      balance_before?: number;
      balance_after?: number;
    };

    revalidatePath("/portal/plan");
    // The truck limit and the balance both gate other pages, so the whole
    // portal shell is stale the moment a plan settles.
    revalidatePath("/portal", "layout");

    /*
     * granted false means nothing moved from 'created' to 'paid' - which
     * almost always means the WEBHOOK settled it first, in the second or two
     * between the customer finishing and this action running. That is the
     * system working, not a problem.
     *
     * It used to say "This payment is already recorded. Your account is up to
     * date." Every word true, and it reads exactly like "duplicate, nothing
     * happened" - the owner read it as their credits having gone missing and
     * asked me to check the database. They had not: the payment in question
     * took the balance from 570 to 580. So rather than describing the race,
     * this now goes and reads what the settlement actually delivered and says
     * that instead.
     */
    if (!result.granted) {
      const effect = result.payment_id
        ? await admin
            .from("payment_credit_effect")
            .select("credits_added, balance_before, balance_after")
            .eq("payment_id", result.payment_id)
            .maybeSingle()
        : null;

      const added = Number(effect?.data?.credits_added ?? 0);
      if (added > 0) {
        return done(
          `Already done — ${formatCredits(added)} credits are on your balance, now ${formatCredits(
            Number(effect?.data?.balance_after ?? 0),
          )}.`,
        );
      }

      // No ledger row against it, so there is genuinely nothing to report.
      // Says what is true without claiming credits arrived.
      return done("This payment was already settled. Nothing further is owed.");
    }

    const movement =
      result.balance_after !== undefined
        ? ` Your balance is now ${formatCredits(Number(result.balance_after))}.`
        : "";

    return done(
      result.kind === "plan"
        ? `Your plan is active${
            result.credits ? `, with ${formatCredits(result.credits)} credits to spend` : ""
          }.${movement}`
        : `${formatCredits(result.credits)} credits added to your balance.${movement}`,
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

  /*
   * The tightest limit in the app, because this is the only form where a
   * correct guess is worth money on the spot. It is also an oracle: the
   * refusals below distinguish "we have no code called that" from every other
   * reason, which is exactly what a guesser needs to know.
   *
   * Counted before the code is even read from the form, so an empty submission
   * is not a free probe, and counted per account rather than per address
   * because the reward lands in an account.
   */
  const throttle = await rateLimit("coupon:user", session.id);
  if (!throttle.allowed) return fail(rateLimitMessage(throttle, "codes tried"));

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
