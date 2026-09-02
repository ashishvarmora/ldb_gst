import Link from "next/link";
import { ChevronDown, Download, SlidersHorizontal } from "lucide-react";

import { FilterSubmitButton } from "@/components/NavPending";
import { directionLabel } from "@/components/Timeline";
import { Field, Input, Select } from "@/components/form";
import { Badge, buttonClass, cx } from "@/components/ui";

/**
 * The one control group at the top of /portal/records: which view, what is
 * filtered, and the export.
 *
 * It used to be a row of four bare dropdowns that wrapped into four full-width
 * lines on a phone before a single record was visible. Now the filters read as
 * one line - "Last 7 days · all trucks" - and open only when someone wants to
 * change them.
 *
 * Plain GET form, plain links, native <details>: no client bundle, and the open
 * filters survive a refresh because a filtered page opens them itself.
 */

export const RECORD_RANGES = [
  { key: "7", label: "Last 7 days" },
  { key: "14", label: "Last 14 days" },
  { key: "30", label: "Last 30 days" },
  { key: "all", label: "Everything kept" },
] as const;

export type RecordsView = "trucks" | "all";

export type RecordsQuery = {
  view?: string;
  truck?: string;
  q?: string;
  range?: string;
  direction?: string;
  page?: string;
};

/** A records URL with some parameters changed. Paging always starts over. */
export function recordsHref(params: RecordsQuery, overrides: RecordsQuery = {}): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value && key !== "page") next.set(key, value);
  }
  const query = next.toString();
  return query ? `/portal/records?${query}` : "/portal/records";
}

const VIEWS: { key: RecordsView; label: string }[] = [
  { key: "trucks", label: "By truck" },
  { key: "all", label: "All crossings" },
];

const DIRECTIONS = ["N", "S", "E", "W"];

export function RecordsControls({
  params,
  view,
  range,
  trucks,
  exportHref,
}: {
  params: RecordsQuery;
  view: RecordsView;
  range: string;
  /** Truck numbers actually present in the records. */
  trucks: string[];
  exportHref: string;
}) {
  const active = [params.truck, params.direction, params.q].filter(Boolean).length;

  // A truck reached by link may sit outside the range that built the list, so
  // it is added back rather than silently dropping the filter.
  const options =
    params.truck && !trucks.includes(params.truck) ? [params.truck, ...trucks] : trucks;

  const rangeLabel = RECORD_RANGES.find((r) => r.key === range)?.label ?? "Last 7 days";
  const summary = [
    rangeLabel,
    params.truck ?? "all trucks",
    params.direction ? directionLabel(params.direction) : null,
    params.q ? `plaza "${params.q}"` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="panel mb-4 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-divider p-2">
        <div className="inline-flex flex-1 rounded-lg bg-sunken p-1 sm:flex-none">
          {VIEWS.map((tab) => (
            <Link
              key={tab.key}
              href={recordsHref(params, { view: tab.key })}
              aria-current={view === tab.key ? "page" : undefined}
              className={cx(
                "inline-flex min-h-9 flex-1 items-center justify-center rounded-md px-3 text-xs font-medium whitespace-nowrap transition sm:flex-none",
                view === tab.key
                  ? "bg-brand-500 text-on-brand"
                  : "text-muted hover:bg-panel hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {/* Not a Link: it is a file download, not a page. */}
        <a href={exportHref} className={buttonClass("secondary", "sm", "ml-auto shrink-0")}>
          <Download size={13} />
          CSV
        </a>
      </div>

      {/* Open already when something is filtered, so a filtered page never hides
          the reason it is showing so little. */}
      <details className="group" open={active > 0}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 py-2 transition hover:bg-raised/70 [&::-webkit-details-marker]:hidden">
          <SlidersHorizontal size={14} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate text-sm text-ink">{summary}</span>
          {active > 0 ? (
            <Badge tone="brand">
              {active} filter{active === 1 ? "" : "s"}
            </Badge>
          ) : null}
          <ChevronDown
            size={16}
            aria-hidden
            className="shrink-0 text-faint transition group-open:rotate-180"
          />
        </summary>

        <form method="get" className="border-t border-divider p-3">
          {/* Filtering should keep the reader on the tab they were on. */}
          <input type="hidden" name="view" value={view} />

          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Date range" name="range">
              <Select name="range" defaultValue={range}>
                {RECORD_RANGES.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Truck" name="truck">
              <Select name="truck" defaultValue={params.truck ?? ""}>
                <option value="">All trucks</option>
                {options.map((truck) => (
                  <option key={truck} value={truck}>
                    {truck}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Direction" name="direction">
              <Select name="direction" defaultValue={params.direction ?? ""}>
                <option value="">Any direction</option>
                {DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {directionLabel(d)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Toll plaza" name="q">
              <Input name="q" defaultValue={params.q ?? ""} placeholder="Part of the name" />
            </Field>
          </div>

          <div className="mt-3 flex items-center gap-2">
            <FilterSubmitButton variant="primary" size="sm" className="flex-1 sm:flex-none">
              Apply filters
            </FilterSubmitButton>
            {active > 0 ? (
              <Link
                href={recordsHref({ view, range })}
                className={buttonClass("ghost", "sm", "flex-1 sm:flex-none")}
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>
      </details>
    </div>
  );
}
