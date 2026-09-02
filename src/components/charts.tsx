import Link from "next/link";
import type { ReactNode } from "react";

import { cx } from "@/components/ui";
import { fmtNumber } from "@/lib/format";

/**
 * The charts the reports are made of.
 *
 * All Server Components, all plain HTML and CSS. There is no charting library
 * here on purpose: every one of these is a stacked bar or a share bar, the data
 * is already grouped by the database, and a client-side chart library would
 * ship far more JavaScript than the whole console to redraw rectangles the
 * server can render as rectangles.
 *
 * Hover is CSS, not script - a tooltip that is a sibling revealed by
 * group-hover works on a mouse, and the same content is read out by the title
 * attribute for touch and for a screen reader.
 *
 * The rules these follow, and why they are not up for taste:
 *
 *   - Identity is never colour alone. Two or more series always get a legend,
 *     and every chart carries a table underneath it that says the same numbers
 *     in text. Someone who cannot separate two hues can still read the report.
 *
 *   - Series colours come from the --color-series-* tokens, which were checked
 *     for colour-vision separation against the surface they are drawn on. They
 *     are deliberately not good/warn/bad: a red segment means "this category",
 *     and a reader who has learned that red means trouble should never have to
 *     unlearn it inside a chart.
 *
 *   - A 2px gap between stacked segments and between neighbouring bars, so two
 *     touching fills read as two values rather than one longer one.
 *
 *   - Text never wears the series colour. The swatch beside a label carries the
 *     identity; the label itself stays in the ordinary ink tokens, where it is
 *     readable.
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
export function seriesClass(index: number): string {
  return SERIES_CLASS[index] ?? REST_CLASS;
}

export type Series = {
  key: string;
  label: string;
  /** Values, one per bucket, in the same order as `buckets`. */
  values: number[];
};

/* -------------------------------------------------------------------------- */
/* Legend                                                                      */
/* -------------------------------------------------------------------------- */

export function Legend({
  series,
  totals,
  format = fmtNumber,
}: {
  series: Series[];
  /** The series total, shown beside its name so the legend is also a summary. */
  totals?: number[];
  format?: (value: number) => string;
}) {
  if (series.length < 2) return null;

  return (
    <ul className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {series.map((item, index) => (
        <li key={item.key} className="flex items-center gap-1.5 text-muted">
          <span className={cx("inline-block size-2.5 shrink-0 rounded-sm", seriesClass(index))} />
          {item.label}
          {totals ? (
            <span className="font-medium tabular-nums text-ink">{format(totals[index] ?? 0)}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */
/* Stacked bars over time                                                      */
/* -------------------------------------------------------------------------- */

/**
 * One bar per bucket, segments stacked in series order.
 *
 * Empty buckets keep their slot and draw a 2px baseline stub rather than
 * disappearing: a fortnight with no sales has to look like a gap, and a chart
 * drawn only from the buckets that have rows silently closes it.
 */
export function StackedBars({
  buckets,
  series,
  format = fmtNumber,
  height = "h-40",
  emptyLabel = "Nothing in this range",
}: {
  /** Axis labels, already formatted for the grain. */
  buckets: string[];
  series: Series[];
  format?: (value: number) => string;
  height?: string;
  emptyLabel?: string;
}) {
  const totals = buckets.map((_, i) => series.reduce((sum, s) => sum + (s.values[i] ?? 0), 0));
  const peak = Math.max(...totals, 0);
  const seriesTotals = series.map((s) => s.values.reduce((sum, v) => sum + (v ?? 0), 0));
  const grandTotal = seriesTotals.reduce((sum, v) => sum + v, 0);

  if (grandTotal === 0) {
    return (
      <div>
        <Legend series={series} totals={seriesTotals} format={format} />
        <div
          className={cx(
            "flex items-center justify-center rounded-lg border border-dashed border-line",
            height,
          )}
        >
          <p className="text-xs text-faint">{emptyLabel}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Legend series={series} totals={seriesTotals} format={format} />

      {/* Scrolls sideways rather than squeezing 90 bars into 300px on a phone.
          min-w keeps each bar wide enough to be a hit target when it does. */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div
          className={cx("flex items-end gap-[2px]", height)}
          style={{ minWidth: `${Math.max(buckets.length * 9, 120)}px` }}
        >
          {buckets.map((label, i) => {
            const total = totals[i];
            // A tenth of a percent still gets a visible sliver, so a day with
            // one sale beside a day with a thousand is not drawn as zero.
            const fill = peak === 0 ? 0 : Math.max((total / peak) * 100, total > 0 ? 2.5 : 0);
            const tip = [
              label,
              ...series.map((s) => `${s.label}: ${format(s.values[i] ?? 0)}`),
              `Total: ${format(total)}`,
            ].join("\n");

            return (
              <div key={label + i} className="group relative flex flex-1 flex-col justify-end">
                {total === 0 ? (
                  <div className="h-0.5 w-full rounded-full bg-sunken" title={`${label}\nNothing`} />
                ) : (
                  <div
                    title={tip}
                    className="flex w-full flex-col-reverse gap-[2px]"
                    style={{ height: `${fill}%` }}
                  >
                    {series.map((s, si) => {
                      const value = s.values[i] ?? 0;
                      if (value <= 0) return null;
                      return (
                        <div
                          key={s.key}
                          className={cx(
                            "w-full min-h-[3px] first:rounded-t-[3px] last:rounded-b-[1px]",
                            seriesClass(si),
                          )}
                          style={{ height: `${(value / total) * 100}%` }}
                        />
                      );
                    })}
                  </div>
                )}

                {/* The hover card. Pointer-events-none so it never eats the
                    hover that summoned it and flickers. */}
                <div
                  role="presentation"
                  className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden -translate-x-1/2 rounded-lg border border-line bg-panel px-2.5 py-2 text-left shadow-[var(--shadow-pop)] group-hover:block"
                >
                  <p className="mb-1 text-[11px] font-semibold whitespace-nowrap text-strong">
                    {label}
                  </p>
                  {series.map((s, si) => (
                    <p
                      key={s.key}
                      className="flex items-center gap-1.5 text-[11px] whitespace-nowrap text-muted"
                    >
                      <span
                        className={cx("inline-block size-2 shrink-0 rounded-sm", seriesClass(si))}
                      />
                      {s.label}
                      <span className="ml-auto pl-2 font-medium tabular-nums text-ink">
                        {format(s.values[i] ?? 0)}
                      </span>
                    </p>
                  ))}
                  {series.length > 1 ? (
                    <p className="mt-1 border-t border-divider pt-1 text-[11px] whitespace-nowrap text-muted">
                      Total
                      <span className="ml-2 font-semibold tabular-nums text-strong">
                        {format(total)}
                      </span>
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Only the ends are labelled. A tick under every bar is unreadable at
          this width, and the hover card names the bucket you are looking at. */}
      <div className="mt-1.5 flex justify-between text-[11px] text-faint">
        <span>{buckets[0]}</span>
        <span className="font-medium text-muted tabular-nums">
          Peak {format(peak)}
        </span>
        <span>{buckets[buckets.length - 1]}</span>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Share of a whole                                                            */
/* -------------------------------------------------------------------------- */

export type Slice = { key: string; label: string; value: number; hint?: string };

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
          <div
            key={slice.key}
            className="flex items-baseline gap-2 border-b border-divider py-2 last:border-0"
          >
            <span
              className={cx("mt-1 inline-block size-2.5 shrink-0 rounded-sm", seriesClass(index))}
            />
            <dt className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">{slice.label}</span>
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
 * Collapsed by default, one click from any chart.
 *
 * This is what makes a chart accessible rather than decorative: whatever a
 * reader cannot get from the picture - because of colour vision, a screen
 * reader, or simply wanting the exact figure - is here as text, from the same
 * arrays the bars were drawn from, so the two cannot disagree.
 */
export function ChartTable({
  buckets,
  series,
  format = fmtNumber,
  label = "the numbers",
}: {
  buckets: string[];
  series: Series[];
  format?: (value: number) => string;
  label?: string;
}) {
  return (
    <details className="mt-3 border-t border-divider pt-2">
      <summary className="inline-flex min-h-8 cursor-pointer list-none items-center text-xs font-medium text-brand-500 transition hover:text-brand-600">
        Show {label}
      </summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 bg-panel">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium text-muted">Period</th>
              {series.map((s) => (
                <th key={s.key} className="px-2 py-1.5 text-right font-medium text-muted">
                  {s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-divider">
            {buckets.map((bucket, i) => (
              <tr key={bucket + i}>
                <td className="px-2 py-1.5 whitespace-nowrap text-muted">{bucket}</td>
                {series.map((s) => (
                  <td key={s.key} className="px-2 py-1.5 text-right tabular-nums text-ink">
                    {format(s.values[i] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

/* -------------------------------------------------------------------------- */
/* Headline figures                                                            */
/* -------------------------------------------------------------------------- */

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
        className="panel block px-4 py-3.5 transition hover:border-brand-500/50 hover:bg-sunken/40"
      >
        {body}
      </Link>
    );
  }

  return <div className="panel px-4 py-3.5">{body}</div>;
}
