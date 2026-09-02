import type { NextRequest } from "next/server";

import { csvFile, toCsv } from "@/components/report";
import { requireSuperAdmin } from "@/lib/auth";
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
          "Days to reward",
          "Rewarded at",
        ],
        body,
      ),
    );
  }

  /* Coupon claims, the default - it is the section that prompted all this. */
  let query = admin
    .from("coupon_claim_detail")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(CAP);

  if (status) query = query.eq("status", status);
  if (params.get("code")) query = query.eq("code", params.get("code"));
  if (params.get("account")) query = query.eq("user_id", params.get("account"));

  const { data, error } = await query;
  if (error) return new Response(`Could not read the claims: ${error.message}`, { status: 500 });

  const rows = data ?? [];
  const body = rows.map((row) => [
    row.created_at,
    row.code,
    row.kind,
    row.account ?? "",
    row.email ?? "",
    row.phone ?? "",
    row.status,
    Number(row.amount_inr) || 0,
    Number(row.discount_inr) || 0,
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
    `coupon-claims-${new Date().toISOString().slice(0, 10)}.csv`,
    toCsv(
      [
        "Claimed at",
        "Code",
        "Kind",
        "Account",
        "Email",
        "Phone",
        "Status",
        "Order value (INR)",
        "Discount (INR)",
        "Bonus credits",
        "Settled at",
      ],
      body,
    ),
  );
}
