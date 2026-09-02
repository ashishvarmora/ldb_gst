import { NextResponse, type NextRequest } from "next/server";

import { loadPayments, paymentsCsv } from "../payments";
import { csvFile } from "@/components/report";
import { getSessionUser } from "@/lib/auth";
import { resolveRange } from "@/lib/analytics";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The account's own payments as a spreadsheet, over the range on screen.
 *
 * Always scoped to the signed-in user id, so editing the query string can never
 * reach another account's payments - the range is the only thing the URL is
 * allowed to decide.
 *
 * Rows come out newest first, which is the screen's own default order. The
 * column sort is deliberately not honoured: a spreadsheet is re-sorted by
 * whoever opens it, and one order is one fewer thing that can drift out of step
 * with the page. Everything that decides WHICH rows appear, and what each cell
 * says, is shared with the screen in payments.ts.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session || session.profile.status !== "active") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  // All time unless the page said otherwise, matching the screen's own default.
  const range = resolveRange({
    range: params.get("range") ?? "all",
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
  });

  const { rows, error } = await loadPayments(getSupabaseAdmin(), session.id, range);
  if (error) return new NextResponse("Could not read your payments.", { status: 500 });

  return csvFile(`payments-${range.from}-to-${range.to}.csv`, paymentsCsv(rows));
}
