import Link from "next/link";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";

import type { Sort } from "@/components/charts";
import { TableWrap, Tbody, Thead, Tr, cx } from "@/components/ui";
import {
  PIVOT_DIMENSIONS,
  type PivotDimension,
  type PivotRow,
} from "@/lib/analytics";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";

/**
 * The grouped ledger, as rows.
 *
 * The Analyse screens used to answer their questions with a stacked bar chart
 * per screen, each drawn from a database function with one grouping baked into
 * it. That made the console decorative: it could show that 500 credits were
 * given away and had no way at all to say who claimed them. A chart is a
 * summary of an answer; this is the answer.
 *
 * One component, because Finance, Users and Usage are three slices of the same
 * ledger and three copies of this table would be three chances for the same
 * figure to disagree with itself - which is exactly what happened the last time
 * this console grew four near-identical account tables.
 *
 * Every dimension column is a link where a link means something: a customer
 * goes to their account, a truck to the fleet view filtered to it, a period
 * narrows the report to that period. That is the "use redirection" the owner
 * asked for - an aggregate the reader cannot open is a dead end.
 */

/** What a measure column shows, and how it reads. */
export type Measure = {
  key: string;
  label: string;
  /** Right-aligned by default; measures are numbers. */
  value: (row: PivotRow) => number;
  format?: (value: number) => string;
  /** A second line under the figure, for context that is not itself sortable. */
  sub?: (row: PivotRow) => string | null;
  /** Off by default: a column nobody sorts by is noise in the header. */
  sortable?: boolean;
};

/**
 * Re-exported rather than redeclared. charts.tsx already owns `Sort` for its
 * own DataTable, and two structurally identical types with different names is
 * how a codebase ends up with two sort helpers that drift apart.
 */
export type SortState = Sort;

/**
 * Where a dimension value leads. Returning null leaves it as plain text, which
 * is right for a value with nowhere to go - a reason, for instance.
 */
export type DrillLinks = {
  bucket?: (row: PivotRow) => string | null;
  account?: (row: PivotRow) => string | null;
  truck?: (row: PivotRow) => string | null;
  reason?: (row: PivotRow) => string | null;
  source?: (row: PivotRow) => string | null;
};

/** How a grouped value reads in its column. */
function dimensionText(dim: PivotDimension, row: PivotRow, grain: string): string {
  switch (dim) {
    case "bucket":
      if (!row.bucket) return "—";
      // A week or a month bucket is the date it starts on, so it is labelled
      // as a range rather than as a day nobody asked about.
      return grain === "day" ? fmtDate(row.bucket) : `${fmtDate(row.bucket)} →`;
    case "account":
      return row.account ?? "—";
    case "truck":
      return row.truck_number ?? "no truck";
    case "reason":
      return row.reason ? (CREDIT_REASON_LABEL[row.reason] ?? row.reason) : "—";
    case "source":
      return row.source ?? "—";
  }
}

/**
 * A stable key for a grouped row.
 *
 * Built from the dimension values rather than an index, because the rows are
 * re-sorted on the server between renders and an index key would make React
 * reuse the wrong row's DOM.
 */
function rowKey(row: PivotRow, dims: PivotDimension[]): string {
  return dims
    .map((dim) => {
      if (dim === "bucket") return row.bucket ?? "";
      if (dim === "account") return row.user_id ?? "";
      if (dim === "truck") return row.truck_number ?? "";
      if (dim === "reason") return row.reason ?? "";
      return row.source ?? "";
    })
    .join("|");
}

export function PivotTable({
  rows,
  dims,
  grain = "day",
  measures,
  sort,
  sortHref,
  links = {},
  totals,
  totalsLabel = "All rows",
  emptyTitle = "Nothing in this range",
  emptyDescription,
}: {
  rows: PivotRow[];
  /** The dimensions actually grouped by, in the order they should read. */
  dims: PivotDimension[];
  grain?: string;
  measures: Measure[];
  sort?: SortState;
  /** Where clicking a sortable header goes. Absent, headers are not clickable. */
  sortHref?: (key: string) => string;
  links?: DrillLinks;
  /**
   * The single totals row, read from the same function with no dimensions - so
   * the figure at the bottom cannot disagree with the rows above it, which is
   * what happens when a screen sums a page of results and calls it a total.
   */
  totals?: PivotRow | null;
  totalsLabel?: string;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
        <p className="text-sm font-medium text-ink">{emptyTitle}</p>
        {emptyDescription ? (
          <p className="max-w-md text-sm text-muted">{emptyDescription}</p>
        ) : null}
      </div>
    );
  }

  const dimensionLabel = (dim: PivotDimension) =>
    PIVOT_DIMENSIONS.find((d) => d.key === dim)?.label ?? dim;

  return (
    <TableWrap>
      <Thead>
        {dims.map((dim) => (
          <th key={dim} className="th whitespace-nowrap">
            {sortHref ? <SortHeader label={dimensionLabel(dim)} sortKey={dim} sort={sort} href={sortHref} /> : dimensionLabel(dim)}
          </th>
        ))}
        {/* With no dimensions there is one row and it needs a name, or the
            table reads as a figure floating in an empty column. */}
        {dims.length === 0 ? <th className="th">Everything</th> : null}
        {measures.map((measure) => (
          <th key={measure.key} className="th text-right whitespace-nowrap">
            {sortHref && measure.sortable !== false ? (
              <SortHeader label={measure.label} sortKey={measure.key} sort={sort} href={sortHref} align="right" />
            ) : (
              measure.label
            )}
          </th>
        ))}
      </Thead>

      <Tbody>
        {rows.map((row) => (
          <Tr key={rowKey(row, dims)}>
            {dims.map((dim) => {
              const text = dimensionText(dim, row, grain);
              const href = links[dim]?.(row) ?? null;
              return (
                <td key={dim} className="td text-sm">
                  {href ? (
                    <Link href={href} className="text-ink transition hover:text-brand-500">
                      {dim === "truck" ? <span className="font-mono">{text}</span> : text}
                    </Link>
                  ) : (
                    <span className={cx("text-ink", dim === "truck" && "font-mono")}>{text}</span>
                  )}
                </td>
              );
            })}
            {dims.length === 0 ? (
              <td className="td text-sm text-muted">{totalsLabel}</td>
            ) : null}
            {measures.map((measure) => {
              const value = measure.value(row);
              const sub = measure.sub?.(row) ?? null;
              return (
                <td key={measure.key} className="td text-right">
                  <span className="block text-sm tabular-nums text-ink">
                    {(measure.format ?? fmtNumber)(value)}
                  </span>
                  {sub ? <span className="block text-xs text-faint">{sub}</span> : null}
                </td>
              );
            })}
          </Tr>
        ))}
      </Tbody>

      {totals ? (
        <tfoot className="border-t-2 border-line-strong bg-raised/60">
          <tr>
            <td className="td text-sm font-medium text-strong" colSpan={Math.max(dims.length, 1)}>
              {totalsLabel}
            </td>
            {measures.map((measure) => (
              <td
                key={measure.key}
                className="td text-right text-sm font-semibold tabular-nums text-strong"
              >
                {(measure.format ?? fmtNumber)(measure.value(totals))}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </TableWrap>
  );
}

/**
 * A column header that sorts.
 *
 * The arrow shows the direction only on the column actually in force; every
 * other header gets a faint dash, so the header row says "these are all
 * sortable" without four arrows competing for the reader's attention.
 */
function SortHeader({
  label,
  sortKey,
  sort,
  href,
  align = "left",
}: {
  label: string;
  sortKey: string;
  sort?: SortState;
  href: (key: string) => string;
  align?: "left" | "right";
}) {
  const on = sort?.key === sortKey;

  return (
    <Link
      href={href(sortKey)}
      aria-label={
        on
          ? `Sorted by ${label}, ${sort?.desc ? "highest first" : "lowest first"}. Reverse it.`
          : `Sort by ${label}`
      }
      className={cx(
        "group inline-flex min-h-8 items-center gap-1 rounded transition",
        align === "right" && "flex-row-reverse",
        on ? "text-brand-500" : "text-muted hover:text-ink",
      )}
    >
      {label}
      {on ? (
        sort?.desc ? (
          <ArrowDown size={12} className="shrink-0" />
        ) : (
          <ArrowUp size={12} className="shrink-0" />
        )
      ) : (
        <Minus size={12} className="shrink-0 text-faint opacity-0 transition group-hover:opacity-100" />
      )}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* The measures every ledger screen wants                                      */
/* -------------------------------------------------------------------------- */

/**
 * Credits, spending shown as a positive quantity.
 *
 * The ledger stores a charge as a negative delta, which is right in the
 * database and wrong on screen: a table of spending whose every figure carries
 * a minus sign is a table the reader has to mentally re-sign on every row.
 * Whichever half of the ledger a screen is showing, the magnitude is what it
 * means.
 */
export const CREDITS_MEASURE: Measure = {
  key: "credits",
  label: "Credits",
  value: (row) => Math.abs(Number(row.credits) || 0),
  format: formatCredits,
};

export const ENTRIES_MEASURE: Measure = {
  key: "entries",
  label: "Charges",
  value: (row) => Number(row.entries) || 0,
};

export const ACCOUNTS_MEASURE: Measure = {
  key: "accounts",
  label: "Customers",
  value: (row) => Number(row.accounts) || 0,
};

export const TRUCKS_MEASURE: Measure = {
  key: "trucks",
  label: "Trucks",
  value: (row) => Number(row.trucks) || 0,
};

/** When the group's activity last happened - the "is this still live" column. */
export const LAST_SEEN_MEASURE: Measure = {
  key: "last_at",
  label: "Last seen",
  value: (row) => (row.last_at ? Date.parse(row.last_at) : 0),
  format: () => "",
  sortable: true,
};

/** The same, rendered as words rather than a timestamp. */
export function lastSeenMeasure(): Measure {
  return {
    ...LAST_SEEN_MEASURE,
    format: (value) => (value > 0 ? fmtRelative(new Date(value).toISOString()) : "—"),
  };
}
