import {
  ACCOUNTS_MEASURE,
  CREDITS_MEASURE,
  ENTRIES_MEASURE,
  TRUCKS_MEASURE,
  lastSeenMeasure,
  type Measure,
} from "@/components/PivotTable";
import type { LedgerKind, PivotDimension, RevenueRow } from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { fmtRupees } from "@/lib/format";

/**
 * How the Finance report shapes its data, kept apart from how it draws it.
 *
 * Both things in here are read twice: once by the screen and once by the CSV
 * route, which is the whole reason they are not sitting inside a component. An
 * export that folded the periods slightly differently from the table, or
 * offered a column the table does not have, is a spreadsheet that disagrees
 * with the page it was downloaded from - and the person who notices is always
 * the one reconciling a bill.
 */

/* -------------------------------------------------------------------------- */
/* The credit ledger's columns                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Which measures the grouped ledger shows, for a given slice of it.
 *
 * The set changes with the slice rather than being fixed, because a fixed set
 * would be wrong in three separate ways at once: a signed net where the sign is
 * constant, a distinct count that can only ever be 1, and a rupee value priced
 * off a division by zero.
 */
export function creditMeasures({
  kind,
  dims,
  rupeesPerCredit,
}: {
  kind: LedgerKind;
  dims: PivotDimension[];
  /** What a credit actually sold for in this window. Zero when nothing sold. */
  rupeesPerCredit: number;
}): Measure[] {
  /*
   * Signed when both halves of the ledger are on screen, a magnitude when only
   * one is.
   *
   * With everything showing, a row's figure is the NET of what that group was
   * given and what it spent, and dressing a net as a magnitude would print
   * "180" for an account that is 180 credits down. Once the reader has pinned
   * the kind, the sign is a constant, and carrying a minus on every row of a
   * spending table only makes it harder to read.
   */
  const credits: Measure =
    kind === "all"
      ? {
          key: "credits",
          label: "Net credits",
          value: (row) => Number(row.credits) || 0,
          format: formatCredits,
        }
      : { ...CREDITS_MEASURE, label: kind === "spend" ? "Credits spent" : "Credits added" };

  const measures: Measure[] = [
    credits,
    {
      ...ENTRIES_MEASURE,
      label: kind === "spend" ? "Charges" : kind === "grant" ? "Grants" : "Entries",
    },
  ];

  /* A distinct count is only worth a column when it can be more than one. With
     the customer dimension on, every row is one customer by construction, and a
     column of 1s tells the reader nothing. A grant has no truck against it at
     all, so that column would be a column of zeroes. */
  if (!dims.includes("account")) measures.push(ACCOUNTS_MEASURE);
  if (!dims.includes("truck") && kind !== "grant") measures.push(TRUCKS_MEASURE);

  /* Grants only, and only when there were sales to price against. A net figure
     multiplied by a per-credit price is a number with no meaning, and a price
     derived from zero sales is a division by zero wearing a suit. */
  if (kind === "grant" && rupeesPerCredit > 0) {
    measures.push({
      key: "worth",
      label: "Worth",
      value: (row) => Math.abs(Number(row.credits) || 0) * rupeesPerCredit,
      format: (value) => fmtRupees(Math.round(value)),
    });
  }

  measures.push(lastSeenMeasure());
  return measures;
}

/* -------------------------------------------------------------------------- */
/* Revenue, folded to one row per period                                       */
/* -------------------------------------------------------------------------- */

export type PeriodRow = {
  bucket: string;
  received: number;
  discount: number;
  payments: number;
  creditsSold: number;
};

/**
 * One row per period, from the (period × method × kind) rows the database
 * returns.
 *
 * Periods with nothing in them are left out rather than filled with zeroes. A
 * chart has to draw the empty days, or a fortnight with no sales looks like a
 * continuous line - but a table of six hundred zero rows for an "all time"
 * range buries the twelve that say anything, and the dates in the first column
 * show a gap perfectly well on their own.
 *
 * There is no customer count per period on purpose. admin_revenue_series counts
 * distinct accounts per (period, method, kind), and adding three of those
 * together counts the same customer three times - a column that is quietly
 * wrong is worse than a column that is missing.
 */
export function foldRevenueByPeriod(revenue: RevenueRow[]): PeriodRow[] {
  const byPeriod = new Map<string, PeriodRow>();

  for (const row of revenue) {
    let period = byPeriod.get(row.bucket);
    if (!period) {
      period = { bucket: row.bucket, received: 0, discount: 0, payments: 0, creditsSold: 0 };
      byPeriod.set(row.bucket, period);
    }
    period.received += Number(row.gross_inr) || 0;
    period.discount += Number(row.discount_inr) || 0;
    period.payments += Number(row.payments) || 0;
    period.creditsSold += Number(row.credits_sold) || 0;
  }

  return [...byPeriod.values()];
}
