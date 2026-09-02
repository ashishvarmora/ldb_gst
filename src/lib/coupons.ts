import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Coupon, CouponUsage, CouponVerdict } from "@/lib/types";

/**
 * Discount codes.
 *
 * A coupon reduces what someone PAYS. It never reduces what they GET: the
 * credits for a pack, or for an amount on the open tier, come from the price
 * before the discount. That is what a discount means to a buyer - the same
 * goods for less money.
 *
 * Every question about a code is answered by validate_coupon() in the
 * database, and the claim is held by reserve_coupon(). Neither is duplicated
 * here, because a second implementation of "is this code still valid" is a
 * second answer that can disagree with the one that took the money.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Codes are stored and compared upper case, so a shift key never matters. */
export function normaliseCode(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

/**
 * Asks whether a code applies, and for how much. Safe to call on every
 * keystroke-ish preview: it only reads, and it holds nothing.
 *
 * `amountInr` is the list price, before any discount.
 */
export async function checkCoupon({
  admin,
  code,
  userId,
  amountInr,
  kind,
}: {
  admin: Admin;
  code: string;
  userId: string;
  amountInr: number;
  kind: "credits" | "plan";
}): Promise<CouponVerdict> {
  const { data, error } = await admin.rpc("validate_coupon", {
    p_code: normaliseCode(code),
    p_user: userId,
    p_amount: amountInr,
    p_kind: kind,
  });

  if (error) {
    console.error("validate_coupon failed", error.message);
    return { ok: false, reason: "unknown", message: "That code could not be checked. Try again." };
  }
  return (data ?? { ok: false, reason: "unknown", message: "That code is not recognised." }) as CouponVerdict;
}

/**
 * Holds the claim against an open order.
 *
 * Re-validates inside the database rather than trusting what the preview said:
 * between the preview and the order, someone else may have taken the last
 * claim on a single-use code, and this is the moment that has to be right.
 *
 * Re-validating was not by itself enough, and 0025 is where that was fixed.
 * Counting the claims and inserting one were two statements with nothing
 * holding the coupon still between them, so two checkouts opened in the same
 * instant both read "one claim left" and both took it - and the same from two
 * tabs against max_per_user. reserve_coupon now takes the coupon's own row lock
 * before it counts, so the second caller waits and then sees the first one's
 * reservation. Nothing about that is visible from here; it is noted because
 * "it re-validates" reads like the whole story and is not.
 */
export async function reserveCoupon({
  admin,
  code,
  userId,
  paymentId,
  amountInr,
  kind,
}: {
  admin: Admin;
  code: string;
  userId: string;
  paymentId: string;
  amountInr: number;
  kind: "credits" | "plan";
}): Promise<CouponVerdict> {
  const { data, error } = await admin.rpc("reserve_coupon", {
    p_code: normaliseCode(code),
    p_user: userId,
    p_payment: paymentId,
    p_amount: amountInr,
    p_kind: kind,
  });

  if (error) {
    console.error("reserve_coupon failed", error.message);
    return { ok: false, reason: "unknown", message: "That code could not be applied." };
  }
  return (data ?? { ok: false, reason: "unknown", message: "That code could not be applied." }) as CouponVerdict;
}

/**
 * Gives a held claim back. Called when a payment fails, so an abandoned
 * checkout does not burn a single-use code. Abandoned holds that never fail
 * explicitly are released lazily by validate_coupon.
 */
export async function releaseCoupon(admin: Admin, paymentId: string): Promise<void> {
  const { error } = await admin.rpc("settle_coupon", { p_payment: paymentId, p_paid: false });
  if (error) console.error("settle_coupon release failed", error.message);
}

export async function loadCoupons(admin: Admin): Promise<CouponUsage[]> {
  const { data } = await admin
    .from("coupon_usage")
    .select("*")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });
  return (data ?? []) as CouponUsage[];
}

/* -------------------------------------------------------------------------- */
/* wording                                                                     */
/* -------------------------------------------------------------------------- */

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "20% off, up to ₹200, on orders over ₹1,000". */
export function describeCoupon(coupon: Coupon): string {
  const parts: string[] = [
    coupon.kind === "percent" ? `${coupon.value}% off` : `${inr(coupon.value)} off`,
  ];
  if (coupon.kind === "percent" && coupon.max_discount_inr) {
    parts.push(`up to ${inr(coupon.max_discount_inr)}`);
  }
  if (coupon.min_spend_inr > 0) parts.push(`on orders of ${inr(coupon.min_spend_inr)} or more`);
  if (coupon.applies_to === "credits") parts.push("credit top-ups only");
  if (coupon.applies_to === "plan") parts.push("plans only");
  return parts.join(", ");
}

/** "3 of 50 claimed" / "12 claimed, no limit". */
export function describeClaims(usage: CouponUsage): string {
  const used = usage.used.toLocaleString("en-IN");
  if (usage.max_claims === null) {
    return `${used} claimed, no limit`;
  }
  return `${used} of ${usage.max_claims.toLocaleString("en-IN")} claimed`;
}

/** Why a coupon is not usable right now, or null when it is fine. */
export function couponInactiveReason(coupon: Coupon): string | null {
  if (!coupon.is_active) return "Switched off";
  const now = Date.now();
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) return "Not started yet";
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) return "Expired";
  return null;
}
