import { LinkPending } from "@/components/NavPending";
import Link from "next/link";
import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import type { ReactNode } from "react";

import { TableWrap, Tbody, Thead, Tr, cx } from "@/components/ui";
import { fmtNumber } from "@/lib/format";

/**
 * The tables the reports are made of, and the one share bar that survived.
 *
 * This file used to lead with a stacked bar chart, and the owner's verdict on
 * the Analyse section was that it was "visual only, not for a data scientist".
 * They were right, and the chart was worse than merely decorative: over a
 * one-day range it drew a single full-width stub that read as a flat line -
 * least readable exactly when the range was most specific - and at no range
 * could it be sorted, totalled, drilled into or exported.
 *
 * So DataTable is the primary thing here now. Every column sorts, a dimension
 * cell is a link to the rows behind it, and there is a totals footer, because
 * the questions actually asked of these screens ("which month grew", "who
 * claimed those free credits") want an orderable column and a link, not a
 * rectangle. ShareBreakdown stayed because a parts-of-a-whole bar does one
 * thing a table does not - it shows a share as a length, and it is honest at
 * any range, since a single category is a full bar rather than a stub.
 *
 * All Server Components, all plain HTML and CSS. No charting library: the data
 * is already grouped by the database, and a client-side library would ship more
 * JavaScript than the whole console to draw rectangles the server can draw.
 *
 * The rules these follow, and why they are not up for taste:
 *
 *   - Identity is never colour alone. Every share bar prints its own label and
 *     figure in text beside the swatch, so a reader who cannot separate two
 *     hues loses nothing.
 *
 *   - Series colours come from the --color-series-* tokens, which were checked
 *     for colour-vision separation against the surface they are drawn on. They
 *     are deliberately not good/warn/bad: a red segment means "this category",
 *     and a reader who has learned that red means trouble should never have to
 *     unlearn it inside a report.
 *
 *   - A 2px gap between neighbouring segments, so two touching fills read as
 *     two values rather than one longer one.
 *
 *   - Text never wears the series colour. The swatch carries the identity; the
 *     label stays in the ordinary ink tokens, where it is readable.
 */
/** The four identity slots, in fixed order. A fifth series folds into "rest". */
const SERIES_CLASS = [
  "bg-series-1",
  "bg-series-2",
  "bg-series-3",
  "bg-series-4",
] as const;

const REST_CLASS = "bg-series-rest";

/** The fill for slot n. Never cycles: past the fourth, everything is the residual grey. */
function seriesClass(index: number): string {
  return SERIES_CLASS[index] ?? REST_CLASS;
}


export type Slice = {
  key: string;
  label: string;
  value: number;
  hint?: string;
  /**
   * Where this slice's rows live. Given, the whole row becomes a link.
   *
   * A share bar answers "how much" and immediately raises "which ones" - the
   * owner's complaint was a card reading "given free 500" with no way to find
   * out who claimed it. Every slice that has a list behind it says so here, and
   * one that genuinely has nowhere to go stays plain text rather than being
   * given a link that lands on an unfiltered screen.
   */
  href?: string;
};

/**
 * A breakdown: one horizontal bar showing the split, then the same numbers as
 * rows underneath with their share.
 *
 * The bar is the glance and the rows are the answer. A pie would need a legend
 * to say the same thing and would still be harder to compare two of.
 */
export function ShareBreakdown({
  slices,
  format = fmtNumber,
  emptyLabel = "Nothing to break down yet",
}: {
  slices: Slice[];
  format?: (value: number) => string;
  emptyLabel?: string;
}) {
  const shown = slices.filter((slice) => slice.value > 0);
  const total = shown.reduce((sum, slice) => sum + slice.value, 0);

  if (total === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-faint">
        {emptyLabel}
      </p>
    );
  }

  return (
    <div>
      <div className="mb-3 flex h-2.5 gap-[2px] overflow-hidden rounded-full">
        {shown.map((slice, index) => (
          <div
            key={slice.key}
            className={cx("h-full first:rounded-l-full last:rounded-r-full", seriesClass(index))}
            style={{ width: `${(slice.value / total) * 100}%` }}
            title={`${slice.label}: ${format(slice.value)} (${Math.round((slice.value / total) * 100)}%)`}
          />
        ))}
      </div>

      <dl className="space-y-0">
        {shown.map((slice, index) => (
          /*
           * A linked slice stays a <div> holding <dt>/<dd> and grows the hit
           * area from the inside, rather than becoming an <a> around them: an
           * anchor is not permitted content for a <dl>, and wrapping the row in
           * one would make the whole breakdown invalid markup that a screen
           * reader stops announcing as a term-and-value list.
           *
           * So the anchor sits on the label and stretches over the row with
           * after:inset-0. min-h-9 is what makes that stretch worth having: two
           * lines of 11px text is about 34px tall, and a row a thumb misses is
           * a drill-down nobody discovers.
           */
          <div
            key={slice.key}
            className={cx(
              "relative flex items-baseline gap-2 border-b border-divider py-2 last:border-0",
              slice.href && "min-h-9 transition hover:bg-raised/50",
            )}
          >
            <span
              className={cx("mt-1 inline-block size-2.5 shrink-0 rounded-sm", seriesClass(index))}
            />
            <dt className="min-w-0 flex-1">
              {slice.href ? (
                <Link
                  href={slice.href}
                  className="block truncate text-sm text-ink transition after:absolute after:inset-0 after:content-[''] hover:text-brand-500"
                >
                  {slice.label}
                </Link>
              ) : (
                <span className="block truncate text-sm text-ink">{slice.label}</span>
              )}
              {slice.hint ? (
                <span className="block truncate text-[11px] text-faint">{slice.hint}</span>
              ) : null}
            </dt>
            <dd className="shrink-0 text-right text-sm font-medium tabular-nums text-strong">
              {format(slice.value)}
              <span className="ml-1.5 text-xs font-normal text-faint">
                {Math.round((slice.value / total) * 100)}%
              </span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The numbers behind a chart                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One column of a sortable report table.
 *
 * `cell` renders and `sortBy` compares, deliberately separated: a period column
 * shows "12 Mar" and has to sort as a date, a money column shows "Rs 1,20,000"
 * and has to sort as a number, and a column that sorted by its own rendered
 * string would put Rs 9 above Rs 80,000 for ever.
 */
export type Column<T> = {
  key: string;
  label: string;
  /** Numbers right, names left. Right is not the default because the first column is usually a name. */
  align?: "left" | "right";
  cell: (row: T) => ReactNode;
  /** What the sort compares. Absent, the column's header is not clickable. */
  sortBy?: (row: T) => number | string;
  /**
   * This column's figure in the footer, over whatever set the caller says the
   * total is of. Absent leaves the footer cell blank, which is the honest thing
   * for a column that cannot be summed - a name, or a distinct count.
   */
  total?: (rows: T[]) => ReactNode;
  /** Given and non-null, the cell becomes a link to the rows behind it. */
  href?: (row: T) => string | null;
  /** Extra classes on the cell, e.g. `whitespace-nowrap` for a date. */
  className?: string;
};

export type Sort = { key: string; desc: boolean };

/**
 * Reorder rows by a column's own comparator.
 *
 * Lives out here rather than inside the table because the caller usually has to
 * page the sorted array, and a table that sorted its own rows privately would
 * page a differently-ordered list than the one it displays.
 *
 * A blank or unknown sort key leaves the order alone: these arrays arrive
 * ordered by the database, and refusing to render a report because a query
 * string carried a stale column name helps nobody.
 */
export function sortRows<T>(rows: T[], columns: Column<T>[], sort: Sort | undefined): T[] {
  const column = columns.find((c) => c.key === sort?.key && c.sortBy);
  if (!column?.sortBy || !sort) return rows;

  const pick = column.sortBy;
  const direction = sort.desc ? -1 : 1;

  return [...rows].sort((a, b) => {
    const left = pick(a);
    const right = pick(b);
    if (typeof left === "number" && typeof right === "number") {
      return (left - right) * direction;
    }
    return String(left).localeCompare(String(right)) * direction;
  });
}

/**
 * A report as rows, sortable by its own headers, with a totals line.
 *
 * This is what the Analyse screens lead with now. They used to lead with a
 * stacked bar chart per panel and keep the figures folded away behind a "Show
 * the numbers" toggle - which is backwards for the person the owner described:
 * somebody who wants to group, sort, total and export, and for whom a picture
 * is at best a sanity check. Over a one-day range the chart was worse than
 * useless, drawing one stub that reads as a broken control.
 *
 * Sorting is a link, not a click handler, so the whole thing stays a Server
 * Component: a sorted report is a URL that can be pasted into a message,
 * survives a refresh, and steps back through the back button.
 */
export function DataTable<T>({
  rows,
  columns,
  sort,
  sortHref,
  rowKey,
  totalsOver,
  totalsLabel = "Total",
  emptyLabel = "Nothing in this range",
}: {
  /** The rows to draw - already sorted, and already paged if the caller pages. */
  rows: T[];
  columns: Column<T>[];
  sort?: Sort;
  /** Where a header click goes. Absent, no header sorts. */
  sortHref?: (key: string) => string;
  rowKey: (row: T, index: number) => string;
  /**
   * What the footer is a total OF. Pass the whole filtered set when `rows` is
   * one page of it - a footer that silently totals the visible page instead is
   * how a report comes to disagree with the figure printed above it.
   */
  totalsOver?: T[];
  totalsLabel?: string;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-line px-3 py-8 text-center text-xs text-faint">
        {emptyLabel}
      </p>
    );
  }

  const totalRows = totalsOver ?? rows;
  const hasTotals = columns.some((column) => column.total);

  return (
    <TableWrap>
      <Thead>
        {columns.map((column) => (
          <th
            key={column.key}
            className={cx("th whitespace-nowrap", column.align === "right" && "text-right")}
          >
            {sortHref && column.sortBy ? (
              <SortHeader
                label={column.label}
                sortKey={column.key}
                sort={sort}
                href={sortHref}
                align={column.align}
              />
            ) : (
              column.label
            )}
          </th>
        ))}
      </Thead>

      <Tbody>
        {rows.map((row, index) => (
          <Tr key={rowKey(row, index)}>
            {columns.map((column) => {
              const href = column.href?.(row) ?? null;
              const body = column.cell(row);
              return (
                <td
                  key={column.key}
                  className={cx(
                    "td",
                    column.align === "right" && "text-right tabular-nums",
                    column.className,
                  )}
                >
                  {href ? (
                    <Link href={href} className="text-ink transition hover:text-brand-500">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </td>
              );
            })}
          </Tr>
        ))}
      </Tbody>

      {hasTotals ? (
        <tfoot className="border-t-2 border-line-strong bg-raised/60">
          <tr>
            {columns.map((column, index) => (
              <td
                key={column.key}
                className={cx(
                  "td text-sm font-semibold text-strong",
                  column.align === "right" && "text-right tabular-nums",
                )}
              >
                {/* The first column carries the label, so the footer reads as a
                    sentence rather than as a row of orphaned figures. */}
                {column.total ? column.total(totalRows) : index === 0 ? totalsLabel : null}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </TableWrap>
  );
}

/**
 * A number with what it is measured against.
 *
 * The change is against the window immediately before this one, which is the
 * only fair comparison when the window itself is adjustable: comparing a
 * 90-day range against "last month" would make every long range look enormous.
 *
 * A rise is not automatically good. `goodWhen` says which direction is welcome,
 * so "credits given away, up 40%" is not painted green.
 */
export function MetricCard({
  label,
  value,
  hint,
  change,
  goodWhen = "up",
  icon,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Percentage change against the previous window. Null when there is nothing to compare. */
  change?: number | null;
  goodWhen?: "up" | "down" | "neither";
  icon?: ReactNode;
  /** Given, the whole card is a link to wherever the detail lives. */
  href?: string;
}) {
  const rising = (change ?? 0) > 0;
  const flat = change === null || change === undefined || Math.abs(change) < 0.5;
  const tone =
    flat || goodWhen === "neither"
      ? "text-muted"
      : rising === (goodWhen === "up")
        ? "text-good-500"
        : "text-bad-500";

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</p>
        {icon ? <span className="shrink-0 text-faint">{icon}</span> : null}
      </div>
      <p className="mt-2 text-2xl font-semibold break-words tabular-nums text-strong">{value}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs">
        {change !== undefined ? (
          flat ? (
            <span className="text-faint">
              {change === null ? "no earlier figure" : "level"}
            </span>
          ) : (
            <span className={cx("font-medium tabular-nums", tone)}>
              {rising ? "▲" : "▼"} {Math.abs(change).toFixed(change >= 100 ? 0 : 1)}%
            </span>
          )
        ) : null}
        {hint ? <span className="text-muted">{hint}</span> : null}
      </div>
    </>
  );

  /*
   * next/link rather than a bare anchor: every href these cards carry is a
   * route inside the console, and a full page reload to move from a figure to
   * the report behind it throws away the layout, the sidebar and the scroll
   * position for a navigation that should be instant.
   */
  if (href) {
    return (
      <Link
        href={href}
        className="panel relative block px-4 py-3.5 transition hover:border-brand-500/50 hover:bg-sunken/40"
      >
        {body}
        {/* Childless: the wash and ring only. A card whose whole content is a
            figure must not have that figure replaced by a spinner. */}
        <LinkPending />
      </Link>
    );
  }

  return <div className="panel px-4 py-3.5">{body}</div>;
}

/**
 * A column header that sorts.
 *
 * The arrow appears only on the column actually in force. Every other header
 * shows its dash on hover alone, so the row says "these are sortable" when a
 * reader goes looking without four arrows competing for attention when they
 * are not.
 *
 * EXCEPT BELOW sm, WHERE THERE IS NO HOVER AT ALL. A dash revealed only by a
 * pointer is a control that does not exist on a phone, and the credit ledger's
 * header is the only sort control that screen has. So the hint is painted from
 * the start on a narrow viewport and hover-revealed from sm up, which leaves
 * every wide table looking exactly as it did.
 */
export function SortHeader({
  label,
  sortKey,
  sort,
  href,
  align = "left",
  order = { desc: "highest first", asc: "lowest first" },
  className,
}: {
  label: string;
  sortKey: string;
  sort?: Sort;
  href: (key: string) => string;
  align?: "left" | "right";
  /**
   * How this column's two directions read out. The default suits a magnitude;
   * a date column is not sorted "highest first", and a screen reader is the
   * only place the direction is ever spelled out rather than drawn.
   */
  order?: { desc: string; asc: string };
  /**
   * For a header outside a `th`, which has to carry its own tap target rather
   * than inherit one from the cell's padding - `min-h-10` here overrides the
   * min-h-8 below, since Tailwind orders one property's utilities by value.
   */
  className?: string;
}) {
  const on = sort?.key === sortKey;

  return (
    <Link
      href={href(sortKey)}
      aria-label={
        on
          ? `Sorted by ${label}, ${sort?.desc ? order.desc : order.asc}. Reverse it.`
          : `Sort by ${label}`
      }
      className={cx(
        "group relative inline-flex min-h-8 items-center gap-1 rounded transition",
        align === "right" && "flex-row-reverse",
        on ? "text-brand-500" : "text-muted hover:text-ink",
        className,
      )}
    >
      {/* Sorting a large table is the slowest navigation on these screens and
          had the least feedback: the arrow does not move until the new page
          arrives, so a tap looked ignored. Wash only - swapping the arrow for
          a spinner would lose which way it is currently sorted. */}
      <LinkPending />
      {label}
      {on ? (
        sort?.desc ? (
          <ArrowDown size={12} className="shrink-0" />
        ) : (
          <ArrowUp size={12} className="shrink-0" />
        )
      ) : (
        <Minus
          size={12}
          className="shrink-0 text-faint transition sm:opacity-0 sm:group-hover:opacity-100"
        />
      )}
    </Link>
  );
}

/* -------------------------------------------------------------------------- */
/* Headline figures                                                            */
/* -------------------------------------------------------------------------- */
