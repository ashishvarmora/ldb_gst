"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CalendarRange, Check, X } from "lucide-react";

import { BUCKETS, RANGE_PRESETS, type DateRange } from "@/lib/analytics";
import { cx } from "@/components/ui";

/**
 * The one date control every report on this console uses.
 *
 * The presets are plain links, so the common case - "show me last month" - is
 * one click, works without JavaScript, can be middle-clicked into a new tab and
 * leaves a real entry in the back stack. Only the custom range needs state, and
 * only while its two date boxes are open.
 *
 * Every other query parameter on the page is carried through untouched. That is
 * the whole reason this is shared: three screens each rebuilding the query
 * string was three chances to drop a filter when somebody changed the dates.
 */
export function DateRangeBar({
  range,
  /** Show the daily/weekly/monthly toggle. Off for screens with no chart. */
  showBucket = true,
}: {
  range: DateRange;
  showBucket?: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);

  /**
   * A link that changes only what it names.
   *
   * Paging is the exception: any change to the window invalidates which rows
   * page three held, so the page number is dropped rather than carried into a
   * result set it no longer describes.
   */
  function hrefWith(changes: Record<string, string | null>): string {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    for (const key of ["page", "accounts", "attention"]) next.delete(key);
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  }

  function applyCustom() {
    if (!from || !to) return;
    router.push(hrefWith({ range: "custom", from, to }));
    setCustom(false);
  }

  return (
    <div className="mb-5 flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
        {/* Scrolls sideways on a phone rather than stacking into four rows and
            pushing the report itself below the fold. */}
        <div className="-mx-4 flex-1 overflow-x-auto px-4 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <div className="flex w-max min-w-full items-center gap-1.5">
            {RANGE_PRESETS.map((preset) => (
              <Link
                key={preset.key}
                href={hrefWith({ range: preset.key, from: null, to: null })}
                aria-current={range.key === preset.key ? "true" : undefined}
                className={cx(
                  "inline-flex min-h-9 shrink-0 items-center rounded-lg border px-3 text-xs font-medium whitespace-nowrap transition",
                  range.key === preset.key
                    ? "border-brand-500 bg-brand-500/10 text-brand-500"
                    : "border-line text-muted hover:bg-sunken hover:text-ink",
                )}
              >
                {preset.label}
              </Link>
            ))}

            <button
              type="button"
              onClick={() => setCustom((open) => !open)}
              aria-expanded={custom}
              className={cx(
                "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium whitespace-nowrap transition",
                range.key === "custom"
                  ? "border-brand-500 bg-brand-500/10 text-brand-500"
                  : "border-line text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              <CalendarRange size={13} />
              {range.key === "custom" ? `${range.from} → ${range.to}` : "Custom"}
            </button>
          </div>
        </div>

        {showBucket ? (
          <div
            role="group"
            aria-label="Group by"
            className="flex shrink-0 items-center rounded-lg border border-line p-0.5"
          >
            {BUCKETS.map((option) => (
              <Link
                key={option.key}
                href={hrefWith({ bucket: option.key })}
                aria-current={range.bucket === option.key ? "true" : undefined}
                className={cx(
                  "inline-flex min-h-8 items-center rounded-md px-2.5 text-xs font-medium transition",
                  range.bucket === option.key
                    ? "bg-brand-500/12 text-brand-500"
                    : "text-muted hover:text-ink",
                )}
              >
                {option.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      {custom ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-panel p-3">
          <label className="flex-1 basis-36 text-xs">
            <span className="mb-1 block text-muted">From</span>
            <input
              type="date"
              value={from}
              max={to}
              onChange={(event) => setFrom(event.target.value)}
              className="field"
            />
          </label>
          <label className="flex-1 basis-36 text-xs">
            <span className="mb-1 block text-muted">To</span>
            <input
              type="date"
              value={to}
              min={from}
              onChange={(event) => setTo(event.target.value)}
              className="field"
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={applyCustom}
              className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-transparent bg-brand-500 px-3 text-sm font-medium text-on-brand transition hover:bg-brand-600"
            >
              <Check size={14} />
              Apply
            </button>
            <button
              type="button"
              onClick={() => setCustom(false)}
              aria-label="Close custom range"
              className="inline-flex min-h-10 items-center rounded-lg border border-line px-3 text-sm text-muted transition hover:bg-sunken hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        </div>
      ) : null}

      {/* The grouping is only mentioned when there is one. With showBucket
          off there are no buckets and no toggle, so "grouped by month" was
          describing something the page does not do - on the payment history,
          for one, where every row is a single payment. */}
      <p className="text-xs text-faint">
        {range.from === range.to ? range.from : `${range.from} → ${range.to}`} ·{" "}
        {range.days.toLocaleString("en-IN")} day{range.days === 1 ? "" : "s"}
        {showBucket ? ` · grouped by ${range.bucket}` : ""} · all dates IST
      </p>
    </div>
  );
}
