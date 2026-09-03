import type { NextRequest } from "next/server";

import { csvFile, toCsv } from "@/components/report";
import { resolveRange, shiftDate } from "@/lib/analytics";
import { requireSuperAdmin } from "@/lib/auth";
import { parseCouponFamily } from "@/lib/coupons";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The claims reports, as a file.
 *
 * Same view, same filters, same order as the screen it was downloaded from, so
 * the spreadsheet cannot disagree with the page. What it deliberately does NOT
 * do is fold: the screen groups by code or by referrer because a screen has to
 * fit, whereas a spreadsheet has a pivot table of its own and is more useful
 * with the raw claims in it. So the file is always every matching row, and the
 * columns carry both the grouping keys and the measures.
 *
 * Only the coupon half takes a date range, and that is not an oversight: the
 * referral screen has no range control, so windowing its file would be the file
 * disagreeing with the page in the one direction nobody would notice - a
 * spreadsheet quietly missing rows.
 */
export const dynamic = "force-dynamic";

/* Same ceiling as the screens. A file is a worse place to discover a cap than a
   page is, so it is stated in the last row rather than left to be inferred. */
const CAP = 5000;

export async function GET(request: NextRequest) {
  // Not optional, and first: a CSV route is the easiest thing in an admin area
  // to forget to protect, and it hands over every customer's name and email.
  await requireSuperAdmin();

  const params = request.nextUrl.searchParams;
  const admin = getSupabaseAdmin();
  const section = params.get("section");
  const status = params.get("status");

  if (section === "referral-claims") {
    let query = admin
      .from("referral_claim_detail")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(CAP);

    if (status) query = query.eq("status", status);
    if (params.get("account")) query = query.eq("referrer_id", params.get("account"));

    const { data, error } = await query;
    if (error) return new Response(`Could not read the referrals: ${error.message}`, { status: 500 });

    const rows = data ?? [];
    const body = rows.map((row) => [
      row.created_at,
      row.referrer ?? "",
      row.referrer_email ?? "",
      row.invitee ?? "",
      row.invitee_email ?? "",
      row.status,
      // Raw numbers: a spreadsheet cannot add up "1,234.5" once a locale has
      // put a group separator in it.
      Number(row.first_amount) || 0,
      Number(row.reward_credits) || 0,
      /* Blank, not 0, for referrals rewarded before the welcome bonus existed -
         a spreadsheet must be able to tell "paid nothing" from "predates the
         scheme". The four per-event columns below carry the same convention,
         and for the same reason: a referral settled under the old percentage
         scheme has no honest split between the two events. */
      row.welcome_credits === null ? "" : Number(row.welcome_credits) || 0,
      /* Which of the two events have paid, and what each one paid whom. The
         totals above are the sum of these, so a sheet can check itself. */
      row.events_paid,
      row.plan_rewarded_at ?? "",
      row.plan_referrer_credits === null ? "" : Number(row.plan_referrer_credits) || 0,
      row.plan_invitee_credits === null ? "" : Number(row.plan_invitee_credits) || 0,
      row.topup_rewarded_at ?? "",
      row.topup_referrer_credits === null ? "" : Number(row.topup_referrer_credits) || 0,
      row.topup_invitee_credits === null ? "" : Number(row.topup_invitee_credits) || 0,
      row.days_to_reward === null ? "" : Number(row.days_to_reward).toFixed(2),
      row.rewarded_at ?? "",
    ]);

    if (rows.length >= CAP) {
      body.push([`TRUNCATED at ${CAP} rows - narrow the filters for a complete file`]);
    }

    return csvFile(
      `referral-claims-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        [
          "Invited at",
          "Referrer",
          "Referrer email",
          "Invitee",
          "Invitee email",
          "Status",
          "First payment (INR)",
          "Reward credits",
          "Welcome credits",
          "Events paid",
          "Plan rewarded at",
          "Plan - inviter credits",
          "Plan - new customer credits",
          "Top-up rewarded at",
          "Top-up - inviter credits",
          "Top-up - new customer credits",
          "Days to reward",
          "Rewarded at",
        ],
        body,
      ),
    );
  }

  /* Coupon claims, the default - it is the section that prompted all this. */
  const range = resolveRange({
    range: params.get("range") ?? undefined,
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });
  const family = parseCouponFamily(params.get("kind") ?? undefined);

  let query = admin
    .from("coupon_claim_detail")
    .select("*")
    /* The same IST day boundaries the screen uses. Half-open at the top, so a
       claim at 11pm on the last day is inside the window. */
    .gte("created_at", `${range.from}T00:00:00+05:30`)
    .lt("created_at", `${shiftDate(range.to, 1)}T00:00:00+05:30`)
    .order("created_at", { ascending: false })
    .limit(CAP);

  /* hold_state, not status, because that is what the screen filters on: the
     table's single 'reserved' covers both a live checkout and one nobody came
     back to, and the file has to be able to say which. The old status values
     still arrive on links written before this, so they are translated. */
  const LEGACY: Record<string, string> = {
    applied: "settled",
    reserved: "holding",
    released: "released",
  };
  const state = status ? (LEGACY[status] ?? status) : null;

  if (state) query = query.eq("hold_state", state);
  if (family) query = query.eq("reward_kind", family);
  if (params.get("code")) query = query.eq("code", params.get("code"));
  if (params.get("account")) query = query.eq("user_id", params.get("account"));

  const { data, error } = await query;
  if (error) return new Response(`Could not read the claims: ${error.message}`, { status: 500 });

  const rows = data ?? [];
  const body = rows.map((row) => [
    row.created_at,
    row.code,
    /* The family and the exact kind. The family is what an admin sorts a sheet
       by; the kind is what the database stores, and a file exists to be joined
       against something else. */
    row.reward_kind,
    row.kind,
    row.account ?? "",
    row.email ?? "",
    row.phone ?? "",
    row.hold_state,
    Number(row.amount_inr) || 0,
    /*
     * The reward given and the reward quoted, in separate columns.
     *
     * They used to be one - discount_inr - which is what the screen was
     * totalling, and on a held or abandoned row it is a figure nobody has
     * paid. A sheet that adds up one column of "discount" and gets a number
     * larger than the money that actually came in is worse than the screen
     * doing it, because nobody checks a spreadsheet against anything.
     */
    Number(row.discount_given) || 0,
    Number(row.discount_quoted) || 0,
    /* Both reward columns, always. Which one carries the value depends on the
       code's kind, and a spreadsheet is the one place where two columns of
       mostly-zeroes is the right answer - it makes the whole set summable
       without the reader knowing which kind each code was. */
    Number(row.bonus_credits) || 0,
    row.settled_at ?? "",
  ]);

  if (rows.length >= CAP) {
    body.push([`TRUNCATED at ${CAP} rows - narrow the filters for a complete file`]);
  }

  return csvFile(
    `coupon-claims-${range.from}-to-${range.to}.csv`,
    toCsv(
      [
        "Claimed at",
        "Code",
        "Sort of code",
        "Kind",
        "Account",
        "Email",
        "Phone",
        "Outcome",
        "Order value (INR)",
        "Discount given (INR)",
        "Discount quoted (INR)",
        "Bonus credits",
        "Settled at",
      ],
      body,
    ),
  );
}
