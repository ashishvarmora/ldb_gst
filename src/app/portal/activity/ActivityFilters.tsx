import Link from "next/link";
import { CalendarDays, ChevronDown } from "lucide-react";

import { Badge, buttonClass, cx } from "@/components/ui";

/**
 * The one control group at the top of /portal/activity.
 *
 * Same shape as the records controls, for the same reason: four bare dropdowns
 * stack into four full-width lines on a phone before a single entry is
 * visible. What is filtered reads as one line - "Last 30 days · everything" -
 * and opens only when someone wants to change it.
 *
 * Which kind of entry is the question people arrive with, so those three sit in
 * the always-visible bar. The date range is one tap inside the fold, as links
 * rather than a select with an Apply button - a range change is a page, so a
 * link does it in one tap and works with no JavaScript at all.
 */

export const ACTIVITY_RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "30", label: "Last 30 days" },
  { key: "90", label: "Last 90 days" },
  { key: "all", label: "Everything kept" },
] as const;

/**
 * A month covers the question this page is for - "where did this month's
 * credits go" - without reaching for rows the app may already have cleared.
 */
export const DEFAULT_RANGE = "30";

export type ActivityKind = "all" | "search" | "credit";

export type ActivityQuery = { kind?: string; range?: string; page?: string };

const KINDS: { key: ActivityKind; label: string; summary: string }[] = [
  { key: "all", label: "Everything", summary: "everything" },
  { key: "search", label: "Searches", summary: "searches only" },
  { key: "credit", label: "Credits", summary: "credit movements only" },
];

/** An activity URL with some parameters changed. Paging always starts over. */
export function activityHref(params: ActivityQuery, overrides: ActivityQuery = {}): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value && key !== "page") next.set(key, value);
  }
  const query = next.toString();
  return query ? `/portal/activity?${query}` : "/portal/activity";
}

export function ActivityControls({
  params,
  kind,
  range,
}: {
  params: ActivityQuery;
  kind: ActivityKind;
  range: string;
}) {
  const rangeLabel = ACTIVITY_RANGES.find((r) => r.key === range)?.label ?? "Last 30 days";
  const kindSummary = KINDS.find((k) => k.key === kind)?.summary ?? "everything";
  const narrowed = range !== DEFAULT_RANGE;

  return (
    <div className="panel mb-4 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-divider p-2">
        <div className="inline-flex flex-1 rounded-lg bg-sunken p-1">
          {KINDS.map((tab) => (
            <Link
              key={tab.key}
              href={activityHref(params, { kind: tab.key === "all" ? "" : tab.key })}
              aria-current={kind === tab.key ? "page" : undefined}
              className={cx(
                "inline-flex min-h-9 flex-1 items-center justify-center rounded-md px-2 text-xs font-medium whitespace-nowrap transition",
                kind === tab.key
                  ? "bg-brand-500 text-on-brand"
                  : "text-muted hover:bg-panel hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Open already when the range is not the default, so a narrowed page
          never hides the reason it is showing so little. */}
      <details className="group" open={narrowed}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 transition hover:bg-raised/70 [&::-webkit-details-marker]:hidden">
          <CalendarDays size={14} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">
            {rangeLabel} · {kindSummary}
          </span>
          {narrowed ? <Badge tone="brand">{rangeLabel.toLowerCase()}</Badge> : null}
          <ChevronDown
            size={16}
            aria-hidden
            className="shrink-0 text-faint transition group-open:rotate-180"
          />
        </summary>

        <div className="flex flex-wrap gap-2 border-t border-divider p-3">
          {ACTIVITY_RANGES.map((option) => (
            <Link
              key={option.key}
              href={activityHref(params, { range: option.key })}
              aria-current={range === option.key ? "page" : undefined}
              className={buttonClass(
                range === option.key ? "primary" : "secondary",
                "sm",
                "flex-1 sm:flex-none",
              )}
            >
              {option.label}
            </Link>
          ))}
        </div>
      </details>
    </div>
  );
}
