import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  ACCOUNTS_MEASURE,
  CREDITS_MEASURE,
  ENTRIES_MEASURE,
  TRUCKS_MEASURE,
  type Measure,
} from "@/components/PivotTable";
import { csvFile, parseDims, parseList, pivotCsv } from "@/components/report";
import { getSessionUser } from "@/lib/auth";
import { loadPivot, loadPivotTotals, resolveRange, type PivotDimension } from "@/lib/analytics";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The slice currently on screen, as a spreadsheet.
 *
 * It used to be a fixed dump of one row per account for the current month,
 * which had nothing to do with whatever the reader was looking at - so somebody
 * who had spent five minutes narrowing a report to one truck's spending over
 * one week clicked Export and got a list of customers.
 *
 * It now takes the SAME query parameters as the page, parses them with the same
 * helpers, and calls the same pivot function - so what downloads is what was on
 * screen, grouped and filtered identically. Only two things differ, both
 * deliberately: every measure is included rather than the subset the table had
 * room for, and nothing is capped. A spreadsheet is the one place where the
 * whole result is the point, and the screen is where paging belongs.
 */
export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  /* Checked as "still allowed" rather than "signed in at some point": a session
     cookie outlives a suspension, and this exports every customer's spending. */
  if (!session || session.profile.role !== "super_admin" || session.profile.status !== "active") {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const params = request.nextUrl.searchParams;
  const get = (name: string) => params.get(name) ?? undefined;

  const range = resolveRange({
    range: get("range"),
    from: get("from"),
    to: get("to"),
    bucket: get("bucket"),
  });

  const offered: PivotDimension[] = ["bucket", "account", "truck", "reason"];
  const dims = parseDims(get("dims"), ["bucket"]).filter((dim) => offered.includes(dim));

  const query = {
    from: range.from,
    to: range.to,
    kind: "spend" as const,
    users: parseList(get("account")),
    trucks: parseList(get("truck")),
    reasons: parseList(get("reason")),
  };

  const admin = getSupabaseAdmin();
  const [rows, totals] = await Promise.all([
    loadPivot(admin, { ...query, dims, bucket: range.bucket }),
    loadPivotTotals(admin, query),
  ]);

  /* Every measure, whatever the table had room for. A column the reader has to
     go back and re-export to get is a column that should have been there. */
  const measures: Measure[] = [
    { ...CREDITS_MEASURE, label: "Credits spent" },
    { ...ENTRIES_MEASURE, label: "Calls" },
    ACCOUNTS_MEASURE,
    TRUCKS_MEASURE,
  ];

  const body = pivotCsv({ rows, dims, measures, totals, bucket: range.bucket });
  const slice = dims.length > 0 ? dims.join("-") : "totals";

  /* The slice and the dates are in the filename, so three exports taken while
     narrowing a report do not all land in Downloads under one name. */
  return csvFile(`usage-${slice}-${range.from}-to-${range.to}.csv`, body);
}
