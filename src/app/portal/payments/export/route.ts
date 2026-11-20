import { NextResponse, type NextRequest } from "next/server";

import { loadPayments, parsePaymentSort, parseStatusFilter, paymentsCsv } from "../payments";
import { csvFile } from "@/components/report";
import { getSessionUser } from "@/lib/auth";
import { parseHistoryRange } from "@/lib/history-range";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The account's own payments as a spreadsheet, over the range on screen.
 *
 * Always scoped to the signed-in user id, so editing the query string can never
 * reach another account's payments - the range is the only thing the URL is
 * allowed to decide.
 *
 * Takes the page's own query string (range, status, sort), so the file holds
 * exactly the rows the filters on screen select - every page of them, not
 * just the one showing. Everything that decides WHICH rows appear, and what
 * each cell says, is shared with the screen in payments.ts.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session || session.profile.status !== "active") {
    return new NextResponse("Please sign in to download this file.", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  // All time unless the page said otherwise, matching the screen's own default.
  const range = parseHistoryRange(
    {
      range: params.get("range") ?? undefined,
      from: params.get("from") ?? undefined,
      to: params.get("to") ?? undefined,
    },
    { fallback: "all", allowAll: true },
  );

  const { rows, error } = await loadPayments(getSupabaseAdmin(), session.id, {
    status: parseStatusFilter(params.get("status") ?? undefined),
    sort: parsePaymentSort(params.get("sort") ?? undefined),
    from: range.from,
    to: range.to,
  });
  if (error) return new NextResponse("Could not read your payments.", { status: 500 });

  const span = range.from && range.to ? `${range.from}-to-${range.to}` : "all-time";
  return csvFile(`payments-${span}.csv`, paymentsCsv(rows));
}
