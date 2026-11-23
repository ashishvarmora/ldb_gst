"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, Loader2, Pencil } from "lucide-react";

import { cx } from "@/components/ui";
import { HISTORY_RANGE_KEYS, RANGE_LABEL, istDay, rangeLabel, type RangeKey } from "@/lib/history-range";

/**
 * The client half of the account history filters (Payments, Credits,
 * Activity). Three controls, the same on every page:
 *
 *   ChipToggles       compact on/off chips (Activity: Auto / Manual, Day / Truck)
 *   DateRangeControl  All / Last 7 days / Custom (Start, End, Apply, Cancel)
 *   UrlSelect         one compact select (sort, group order)
 *
 * Every control writes the URL and nothing else: the page reads the URL on the
 * server, filters in the database and renders. `params` is the rest of the
 * page's current query (other filters), already without the page number and
 * any open rows, so a change of filter always lands on page 1, everything
 * closed.
 */

function hrefFor(basePath: string, params: Record<string, string>, patch: Record<string, string | null>) {
  const search = new URLSearchParams(params);
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === "") search.delete(key);
    else search.set(key, value);
  }
  search.delete("page");
  const qs = search.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** One compact select that navigates on change (sort, group order). */
export function UrlSelect({
  basePath,
  params,
  name,
  value,
  fallback,
  options,
  label,
  icon,
  className,
}: {
  basePath: string;
  params: Record<string, string>;
  name: string;
  value: string;
  /** The value that is the page default, and therefore left out of the URL. */
  fallback: string;
  options: { value: string; label: string }[];
  label: string;
  icon?: ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <label className={cx("hist-select", className)} aria-busy={pending}>
      {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : icon}
      <span className="sr-only">{label}</span>
      <select
        value={value}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value;
          const href = hrefFor(basePath, params, {
            [name]: next === fallback ? null : next,
          });
          startTransition(() => router.replace(href, { scroll: false }));
        }}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export type Chip = {
  key: string;
  label: string;
  on: boolean;
  /** Where tapping goes; null = cannot be changed (the last chip left on). */
  href: string | null;
  /** Said when the chip cannot be changed. */
  lockedHint?: string;
};

/**
 * Independent on/off chips. Each chip is a real toggle button (aria-pressed)
 * whose new state is a URL the server worked out, so the rules (at least one
 * on, and so on) live in one place - the page.
 */
export function ChipToggles({ label, caption, items }: { label: string; caption?: string; items: Chip[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  return (
    <div role="group" aria-label={label} className="hist-chips" aria-busy={pending}>
      {caption ? (
        <span aria-hidden className="hist-chips-caption">
          {caption}
        </span>
      ) : null}
      {items.map((item) => {
        const locked = item.href === null;
        return (
          <button
            key={item.key}
            type="button"
            aria-pressed={item.on}
            aria-disabled={locked || undefined}
            title={locked ? item.lockedHint : undefined}
            className={cx("hist-chip", item.on && "is-on", locked && "is-locked")}
            onClick={() => {
              if (!item.href) return;
              setBusy(item.key);
              const href = item.href;
              startTransition(() => router.replace(href, { scroll: false }));
            }}
          >
            {pending && busy === item.key ? (
              <Loader2 size={13} aria-hidden className="animate-spin" />
            ) : item.on ? (
              <Check size={13} aria-hidden strokeWidth={2.6} />
            ) : null}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The date control: a select (All / Last 7 days / Custom). Custom opens a
 * small panel - Start date, End date, Apply, Cancel - under the filters, the
 * same on a phone and a desktop (native date inputs). While a custom range is
 * on, the select shows its dates and a pencil re-opens the panel.
 */
export function DateRangeControl({
  basePath,
  params,
  current,
  from,
  to,
  fallback,
  options = HISTORY_RANGE_KEYS,
}: {
  basePath: string;
  /** The rest of the query, WITHOUT range/from/to/page/open rows. */
  params: Record<string, string>;
  current: RangeKey;
  from: string | null;
  to: string | null;
  fallback: RangeKey;
  options?: readonly RangeKey[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const today = istDay();
  const [start, setStart] = useState(from ?? istDay(-6));
  const [end, setEnd] = useState(to ?? today);

  /* A navigation (back button, a link) changes the range under us. */
  useEffect(() => {
    setEditing(false);
    setStart(from ?? istDay(-6));
    setEnd(to ?? istDay());
  }, [current, from, to]);

  function go(patch: Record<string, string | null>) {
    startTransition(() => router.replace(hrefFor(basePath, params, patch), { scroll: false }));
  }

  const customLabel = current === "custom" && from && to ? rangeLabel({ key: "custom", from, to }) : RANGE_LABEL.custom;
  const valid = Boolean(start && end);

  return (
    <div className={cx("hist-range", editing && "is-editing")} aria-busy={pending}>
      <div className="hist-range-row">
        <label className="hist-select">
          {pending ? (
            <Loader2 size={14} aria-hidden className="animate-spin" />
          ) : (
            <CalendarDays size={14} aria-hidden />
          )}
          <span className="sr-only">Date range</span>
          <select
            value={editing ? "custom" : current}
            aria-label="Date range"
            onChange={(event) => {
              const next = event.target.value as RangeKey;
              if (next === "custom") {
                setEditing(true);
                return;
              }
              setEditing(false);
              go({
                range: next === fallback ? null : next,
                from: null,
                to: null,
              });
            }}
          >
            {options.map((key) => (
              <option key={key} value={key}>
                {key === "custom" ? customLabel : RANGE_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
        {current === "custom" && !editing ? (
          <button type="button" className="hist-icon-btn" aria-label="Change dates" onClick={() => setEditing(true)}>
            <Pencil size={14} aria-hidden />
          </button>
        ) : null}
      </div>

      {editing ? (
        <form
          className="hist-custom"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            const [a, b] = start <= end ? [start, end] : [end, start];
            go({ range: "custom", from: a, to: b > today ? today : b });
          }}
        >
          <div className="hist-custom-fields">
            <label>
              <span>Start date</span>
              <input
                type="date"
                value={start}
                max={today}
                onChange={(event) => setStart(event.target.value)}
                required
              />
            </label>
            <label>
              <span>End date</span>
              <input type="date" value={end} max={today} onChange={(event) => setEnd(event.target.value)} required />
            </label>
          </div>
          <div className="hist-custom-actions">
            <button
              type="button"
              className="hist-cancel"
              onClick={() => {
                setEditing(false);
                setStart(from ?? istDay(-6));
                setEnd(to ?? today);
              }}
            >
              Cancel
            </button>
            <button type="submit" className="hist-apply" disabled={!valid || pending}>
              {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : null}
              Apply
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
