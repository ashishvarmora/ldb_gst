import Link from "next/link";
import { Filter } from "lucide-react";

import { directionLabel } from "@/components/Timeline";
import { Input, Select } from "@/components/form";
import { buttonClass, cx } from "@/components/ui";

/**
 * Filters and the view switch for /portal/records. A plain GET form and plain
 * links, so the page stays server-rendered - there is no state here worth a
 * client bundle.
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

export function RecordsViewSwitch({ view, params }: { view: RecordsView; params: RecordsQuery }) {
  return (
    <div className="inline-flex rounded-lg border border-line bg-panel p-1">
      {VIEWS.map((tab) => (
        <Link
          key={tab.key}
          href={recordsHref(params, { view: tab.key })}
          aria-current={view === tab.key ? "page" : undefined}
          className={cx(
            "inline-flex min-h-9 items-center rounded-md px-3 text-xs font-medium transition",
            view === tab.key
              ? "bg-brand-500 text-on-brand"
              : "text-muted hover:bg-sunken hover:text-ink",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}

export function RecordsFilters({
  params,
  view,
  range,
  trucks,
}: {
  params: RecordsQuery;
  view: RecordsView;
  range: string;
  /** Truck numbers actually present in the records, newest activity first. */
  trucks: string[];
}) {
  const filtered = Boolean(params.truck || params.q || params.direction);

  // A truck reached by link may sit outside the range that built the list, so
  // it is added back rather than silently dropping the officer's filter.
  const options = params.truck && !trucks.includes(params.truck) ? [params.truck, ...trucks] : trucks;

  return (
    <form method="get" className="flex flex-wrap items-end gap-2">
      {/* Filtering should keep the officer on the tab they were reading. */}
      <input type="hidden" name="view" value={view} />

      <Select name="truck" defaultValue={params.truck ?? ""} className="w-full sm:w-48">
        <option value="">All trucks</option>
        {options.map((truck) => (
          <option key={truck} value={truck}>
            {truck}
          </option>
        ))}
      </Select>

      <Select name="range" defaultValue={range} className="w-full sm:w-44">
        {RECORD_RANGES.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </Select>

      <Select name="direction" defaultValue={params.direction ?? ""} className="w-full sm:w-40">
        <option value="">Any direction</option>
        {["N", "S", "E", "W"].map((d) => (
          <option key={d} value={d}>
            {directionLabel(d)}
          </option>
        ))}
      </Select>

      <Input
        name="q"
        defaultValue={params.q ?? ""}
        placeholder="Toll plaza name"
        className="w-full sm:min-w-48 sm:flex-1"
      />

      <button type="submit" className={buttonClass("secondary")}>
        <Filter size={14} />
        Apply
      </button>
      {filtered ? (
        <Link href={recordsHref({ view, range })} className={buttonClass("ghost")}>
          Clear
        </Link>
      ) : null}
    </form>
  );
}
