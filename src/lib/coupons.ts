import { formatCredits } from "@/lib/credits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Coupon, CouponKind, CouponUsage, CouponVerdict } from "@/lib/types";

/**
 * Codes, of which there are two sorts that must never be read as one.
 *
 * A DISCOUNT code (percent, flat) reduces what someone PAYS. It never reduces
 * what they GET: the credits for a pack, or for an amount on the open tier,
 * come from the price before the discount. That is what a discount means to a
 * buyer - the same goods for less money.
 *
 * A FREE CREDIT code (credit_bonus) reduces nothing. It grants credits, is
 * claimed on its own without a purchase, and is refused outright at a checkout
 * - see 0030, where a 500-credit code was being read as a 500% discount
 * because one branch of arithmetic served an open set of kinds.
 *
 * They are paid in different units, and that is the whole reason the
 * classification below is written down once rather than re-derived per screen.
 * Every screen that assumed rupees is a screen where a 500-credit grant
 * rendered as Rs 0.
 *
 * Every question about a code is answered by validate_coupon() in the
 * database, and the claim is held by reserve_coupon(). Neither is duplicated
 * here, because a second implementation of "is this code still valid" is a
 * second answer that can disagree with the one that took the money.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

/**
 * One row of coupon_usage as 0033 leaves it.
 *
 * Extended here rather than in lib/types, because these four columns exist for
 * the rewards screens and the base CouponUsage is read elsewhere with an older
 * shape. Where they come from and why the database computes them:
 *
 *   credits_given  a bonus code's payout, which no rupee column can see. It
 *                  was being worked out as value x used on the codes list AND
 *                  again in the delete warning - two copies of one sum, which
 *                  is two chances to be wrong about what a giveaway cost.
 *   abandoned      a reservation past the release window. It used to count as
 *                  "held" and to be subtracted from claims_left, so a closed
 *                  tab read as consumed supply until the next person anywhere
 *                  typed a code.
 *   handed_back    reservations already released. Reported so "3 claims" on
 *                  the claims report and "1 used" here stop looking like a
 *                  contradiction.
 *   accounts       how many different people settled a claim, which is what
 *                  separates a popular code from a farmed one.
 */
export type CouponRow = CouponUsage & {
  abandoned: number;
  handed_back: number;
  accounts: number;
  credits_given: number;
};

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

export async function loadCoupons(admin: Admin): Promise<CouponRow[]> {
  const { data } = await admin
    .from("coupon_usage")
    .select("*")
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });
  return (data ?? []) as CouponRow[];
}

/* -------------------------------------------------------------------------- */
/* the two sorts of code                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Which of the two things a code is, and what it is paid in.
 *
 * `family` is the classification the owner asked for - "free credit can become
 * messy so fix it history by proper filter and classification option". Two
 * families, three kinds, because a percentage and a fixed amount are two ways
 * of writing the same promise and a credit grant is not a discount at all.
 *
 * `unit` is here so a table can pick its own column without a second switch on
 * `kind` in every cell. That second switch is exactly what went wrong twice
 * already: once in validate_coupon, where credit_bonus fell into the
 * percentage branch, and once in describeCoupon, where it fell into "Rs N off".
 */
export const COUPON_FAMILIES = [
  {
    key: "discount",
    label: "Discount codes",
    /** How the family reads on a row, in as few words as fit a badge. */
    short: "Discount",
    hint: "Takes money off a payment",
    kinds: ["percent", "flat"] as CouponKind[],
  },
  {
    key: "credit",
    label: "Free credit codes",
    short: "Free credits",
    hint: "Grants credits, claimed on its own, changes no price",
    kinds: ["credit_bonus"] as CouponKind[],
  },
] as const;

export type CouponFamily = (typeof COUPON_FAMILIES)[number]["key"];

/** Which family a kind belongs to. The only place this decision is made. */
export function couponFamily(kind: CouponKind | string): CouponFamily {
  return kind === "credit_bonus" ? "credit" : "discount";
}

/** A family key out of a URL, or undefined for "both". */
export function parseCouponFamily(raw: string | undefined): CouponFamily | undefined {
  return COUPON_FAMILIES.some((family) => family.key === raw)
    ? (raw as CouponFamily)
    : undefined;
}

/** "Discount" / "Free credits", for a badge on a row. */
export function couponFamilyLabel(kind: CouponKind | string): string {
  const key = couponFamily(kind);
  return COUPON_FAMILIES.find((family) => family.key === key)?.short ?? key;
}

/* -------------------------------------------------------------------------- */
/* wording                                                                     */
/* -------------------------------------------------------------------------- */

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** "20% off, up to ₹200, on orders over ₹1,000". */
export function describeCoupon(coupon: Coupon): string {
  /*
   * Three kinds, and the third one is not a discount at all.
   *
   * This was a two-way branch: percent got "N% off" and EVERYTHING ELSE got
   * "Rs N off". credit_bonus arrived later and fell into the else, so the live
   * code TOPUP500 - which grants 500 credits and takes nothing off any price -
   * was described to the admin as "Rs 500 off". A wrong unit on a price list is
   * not a cosmetic problem: it is the figure somebody sets their own prices
   * against.
   */
  const parts: string[] = [
    coupon.kind === "percent"
      ? `${coupon.value}% off`
      : coupon.kind === "credit_bonus"
        ? `${formatCredits(coupon.value)} free credits`
        : `${inr(coupon.value)} off`,
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

/**
 * What this code has actually handed over, in its own unit.
 *
 * One function because the answer lives in a different column for each family
 * and the wrong column is a zero, not an error - which is how TOPUP500 came to
 * be reported as having given nothing away after granting 500 credits. The
 * `credits` flag is returned rather than the caller re-deriving it, so a cell
 * cannot format rupees with a credit figure in it.
 */
export function couponPayout(coupon: CouponRow): {
  credits: boolean;
  amount: number;
  text: string;
  /** What the figure is measured against, or null when there is nothing to say. */
  against: string | null;
} {
  if (couponFamily(coupon.kind) === "credit") {
    const amount = Number(coupon.credits_given ?? 0);
    return {
      credits: true,
      amount,
      text: formatCredits(amount),
      against: amount > 0 ? "credits" : null,
    };
  }

  const amount = Number(coupon.discount_given ?? 0);
  return {
    credits: false,
    amount,
    text: fmtRupeesPlain(amount),
    against: amount > 0 ? `off ${fmtRupeesPlain(Number(coupon.list_total ?? 0))}` : null,
  };
}

/* Local rather than imported from lib/format: this file is read by the portal
   as well, and "Rs" without the symbol is what every admin table already
   prints, so the two must match. */
function fmtRupeesPlain(value: number): string {
  return `Rs ${Number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

/**
 * The holds on a code, said as what they are.
 *
 * Three numbers, and the difference between them is the whole of the bug the
 * owner reported. A LIVE hold is a checkout that could still be paid, and it
 * does count against the limit - that is what stops two people spending the
 * last use of a single-use code at the same instant. An ABANDONED hold is a
 * closed tab: 0033 stops it counting against anything, and the next code
 * anybody types hands it back. Neither is a claim, and neither means the code
 * was used.
 *
 * Null when there is nothing worth saying, so a row with no holds carries no
 * line rather than a reassuring one nobody reads.
 */
export function describeHolds(coupon: CouponRow): string | null {
  const holding = Number(coupon.holding ?? 0);
  const abandoned = Number(coupon.abandoned ?? 0);

  if (holding === 0 && abandoned === 0) return null;

  const parts: string[] = [];
  if (holding > 0) {
    parts.push(
      `${holding} checkout${holding === 1 ? "" : "s"} still open, holding a claim until the money arrives`,
    );
  }
  if (abandoned > 0) {
    parts.push(
      `${abandoned} checkout${abandoned === 1 ? " was" : "s were"} abandoned — handed back, counting against nothing`,
    );
  }
  return parts.join(" · ");
}

/** Why a coupon is not usable right now, or null when it is fine. */
export function couponInactiveReason(coupon: Coupon): string | null {
  if (!coupon.is_active) return "Switched off";
  const now = Date.now();
  if (coupon.starts_at && new Date(coupon.starts_at).getTime() > now) return "Not started yet";
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) return "Expired";
  return null;
}
