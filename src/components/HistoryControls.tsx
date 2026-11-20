"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Loader2 } from "lucide-react";

import { RANGE_LABEL, istDay, type RangeKey } from "@/lib/history-range";

/**
 * The client half of the account history filters (Payments, Activity).
 *
 * Every control writes the URL and nothing else: the page reads the URL on the
 * server, filters in the database and renders. `params` is the rest of the
 * page's current query (other filters), already without the page number, so a
 * change of filter always lands on page 1 and never fights the pager.
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

/** One compact select that navigates on change (sort, truck picker). */
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
    <label className={`hist-select ${className ?? ""}`} aria-busy={pending}>
      {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : icon}
      <span className="sr-only">{label}</span>
      <select
        value={value}
        aria-label={label}
        onChange={(event) => {
          const next = event.target.value;
          const href = hrefFor(basePath, params, { [name]: next === fallback ? null : next });
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

/**
 * The date control: one select (7 / 30 / 90 days, All time where allowed,
 * Custom). Custom reveals two date inputs and an Apply button.
 */
export function RangeControl({
  basePath,
  params,
  current,
  from,
  to,
  fallback,
  options,
}: {
  basePath: string;
  /** The rest of the query, WITHOUT range/from/to/page. */
  params: Record<string, string>;
  current: RangeKey;
  from: string | null;
  to: string | null;
  fallback: RangeKey;
  options: RangeKey[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState<RangeKey>(current);
  const today = istDay();
  const [start, setStart] = useState(from ?? istDay(-6));
  const [end, setEnd] = useState(to ?? today);

  /* A navigation (back button, a link) changes the range under us. */
  useEffect(() => setChoice(current), [current]);

  function go(patch: Record<string, string | null>) {
    startTransition(() => router.replace(hrefFor(basePath, params, patch), { scroll: false }));
  }

  return (
    <div className="hist-range" aria-busy={pending}>
      <label className="hist-select">
        {pending ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <CalendarDays size={14} aria-hidden />}
        <span className="sr-only">Date range</span>
        <select
          value={choice}
          aria-label="Date range"
          onChange={(event) => {
            const next = event.target.value as RangeKey;
            setChoice(next);
            if (next === "custom") return;
            go({ range: next === fallback ? null : next, from: null, to: null });
          }}
        >
          {options.map((key) => (
            <option key={key} value={key}>
              {RANGE_LABEL[key]}
            </option>
          ))}
        </select>
      </label>

      {choice === "custom" ? (
        <form
          className="hist-custom"
          onSubmit={(event) => {
            event.preventDefault();
            if (!start || !end) return;
            go({ range: "custom", from: start <= end ? start : end, to: start <= end ? end : start });
          }}
        >
          <input
            type="date"
            aria-label="From"
            value={start}
            max={today}
            onChange={(event) => setStart(event.target.value)}
            required
          />
          <span aria-hidden className="hist-custom-dash">–</span>
          <input
            type="date"
            aria-label="To"
            value={end}
            max={today}
            onChange={(event) => setEnd(event.target.value)}
            required
          />
          <button type="submit" className="hist-apply">
            Apply
          </button>
        </form>
      ) : null}
    </div>
  );
}
