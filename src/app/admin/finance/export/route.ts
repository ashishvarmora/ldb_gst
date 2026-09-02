import { creditMeasures, foldRevenueByPeriod } from "../ledger";
import {
  csvFile,
  parseDims,
  parseKind,
  parseList,
  parseSort,
  pivotCsv,
  sortPivotRows,
  toCsv,
} from "@/components/report";
import {
  loadPivot,
  loadPivotTotals,
  loadRevenueSeries,
  resolveRange,
  sumBy,
  type PivotDimension,
} from "@/lib/analytics";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The Finance report, as the reader currently has it on screen.
 *
 * The point is that "currently": the whole query string the screen was showing
 * comes along, so the file is the same window, the same grouping, the same
 * filters and the same order. A one-click "download everything" would have been
 * less code and would have answered a different question from the one on the
 * page - and reconciling a spreadsheet against a screen it does not match is
 * exactly the work the owner asked to be spared.
 *
 * Deliberately not paged. A spreadsheet is the one place where having the whole
 * result is the point, and the screen is where paging belongs.
 *
 * getSessionUser and a 403, rather than requireSuperAdmin: that helper redirects
 * to /login, and a redirect answering a download either saves the login page as
 * a .csv or fails silently, neither of which tells anybody what went wrong.
 */
export async function GET(request: Request) {
  const session = await getSessionUser();
  if (
    !session ||
    session.profile.role !== "super_admin" ||
    session.profile.status !== "active"
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  const query = new URL(request.url).searchParams;
  const range = resolveRange({
    range: query.get("range") ?? undefined,
    from: query.get("from") ?? undefined,
    to: query.get("to") ?? undefined,
    bucket: query.get("bucket") ?? undefined,
  });

  const admin = getSupabaseAdmin();
  const stamp = range.from === range.to ? range.from : `${range.from}_${range.to}`;

  /* ----------------------------------------------------------------------- */
  /* Revenue: one row per period, exactly as the table folds it              */
  /* ----------------------------------------------------------------------- */

  if (query.get("section") !== "credits") {
    const revenue = await loadRevenueSeries(admin, range);
    const periods = foldRevenueByPeriod(revenue).sort((a, b) => a.bucket.localeCompare(b.bucket));

    const csv = toCsv(
      [
        `Period (${range.bucket}, IST)`,
        "Received (INR)",
        "Payments",
        "Average payment (INR)",
        "Credits sold",
        "Discounts (INR)",
      ],
      [
        ...periods.map((period) => [
          period.bucket,
          period.received,
          period.payments,
          period.payments > 0 ? Math.round(period.received / period.payments) : 0,
          period.creditsSold,
          period.discount,
        ]),
        // The totals line last, so a reader who sorts the sheet in Excel can
        // still see which row it was.
        [
          "TOTAL",
          sumBy(periods, (period) => period.received),
          sumBy(periods, (period) => period.payments),
          "",
          sumBy(periods, (period) => period.creditsSold),
          sumBy(periods, (period) => period.discount),
        ],
      ],
    );

    return csvFile(`rahdari-revenue-${stamp}.csv`, csv);
  }

  /* ----------------------------------------------------------------------- */
  /* The credit ledger, grouped the way the screen is grouping it            */
  /* ----------------------------------------------------------------------- */

  const dims = parseDims(query.get("dims") ?? undefined, ["account", "source"] as PivotDimension[]);
  const kind = parseKind(query.get("kind") ?? undefined);
  const filters = {
    from: range.from,
    to: range.to,
    bucket: range.bucket,
    kind,
    users: parseList(query.getAll("account")),
    trucks: parseList(query.getAll("truck")),
    reasons: parseList(query.getAll("reason")),
    sources: parseList(query.getAll("source")),
  };

  const [rows, totals, revenue] = await Promise.all([
    loadPivot(admin, { ...filters, dims }),
    loadPivotTotals(admin, filters),
    loadRevenueSeries(admin, range),
  ]);

  /* The same price the screen puts on a credit: what customers actually paid
     per credit in this window, not any pack's list price. */
  const creditsSold = sumBy(revenue, (row) => row.credits_sold);
  const rupeesPerCredit =
    creditsSold > 0 ? sumBy(revenue, (row) => row.gross_inr) / creditsSold : 0;

  /*
   * The same measures as the table, minus "Last seen".
   *
   * That column sorts on a parsed timestamp and renders as "3d ago", so its
   * raw value is a millisecond epoch - a number no spreadsheet can do anything
   * with. pivotCsv already carries the first and last entry as real ISO
   * timestamps, which is the form a sheet can filter and subtract.
   */
  const measures = creditMeasures({ kind, dims, rupeesPerCredit });
  const exported = measures.filter((measure) => measure.key !== "last_at");
  const sort = parseSort(
    { sort: query.get("sort") ?? undefined, dir: query.get("dir") ?? undefined },
    { key: "credits", desc: true },
  );

  return csvFile(
    `rahdari-credit-ledger-${stamp}.csv`,
    pivotCsv({
      rows: sortPivotRows(rows, sort, measures),
      dims,
      measures: exported,
      totals,
      bucket: range.bucket,
    }),
  );
}
