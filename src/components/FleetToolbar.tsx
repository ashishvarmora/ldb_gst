"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { announceNavigation } from "@/components/NavProgress";
import { ArrowDownUp, Loader2, Search, X } from "lucide-react";

/**
 * Search and sort for My trucks (owner, 20 Nov 2026). Shown once the list is
 * long enough to need them; the list itself is filtered on the server, so the
 * URL carries the state (?q=…&sort=…) and a refresh or a shared link keeps it.
 *
 * Typing updates the list after a short pause; Enter applies at once. Changing
 * either control goes back to page 1.
 */
export type FleetSort = "crossing" | "number";

export function FleetToolbar({
  basePath,
  params,
  query,
  sort,
  showSearch,
}: {
  basePath: string;
  /** The other params to keep (the Tracking / Paused filter). */
  params: Record<string, string>;
  query: string;
  sort: FleetSort;
  showSearch: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(query);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* A navigation elsewhere (the filter tabs) brings its own q. */
  useEffect(() => setValue(query), [query]);

  function go(nextQuery: string, nextSort: FleetSort) {
    const search = new URLSearchParams(params);
    const trimmed = nextQuery.trim();
    if (trimmed) search.set("q", trimmed);
    if (nextSort !== "crossing") search.set("sort", nextSort);
    const qs = search.toString();
    const href = qs ? `${basePath}?${qs}` : basePath;
    announceNavigation(href);
    startTransition(() => router.replace(href, { scroll: false }));
  }

  function onType(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => go(next, sort), 350);
  }

  return (
    <div className="fleet-toolbar" aria-busy={pending}>
      {showSearch ? (
        <form
          role="search"
          className="fleet-search"
          onSubmit={(event) => {
            event.preventDefault();
            if (timer.current) clearTimeout(timer.current);
            go(value, sort);
          }}
        >
          {pending ? (
            <Loader2 size={15} aria-hidden className="fleet-search-icon animate-spin" />
          ) : (
            <Search size={15} aria-hidden className="fleet-search-icon" />
          )}
          <input
            type="search"
            value={value}
            onChange={(event) => onType(event.target.value)}
            placeholder="Search number or label"
            aria-label="Search trucks by number or label"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            enterKeyHint="search"
          />
          {value ? (
            <button
              type="button"
              className="fleet-search-clear"
              aria-label="Clear search"
              onClick={() => {
                setValue("");
                if (timer.current) clearTimeout(timer.current);
                go("", sort);
              }}
            >
              <X size={15} aria-hidden />
            </button>
          ) : null}
        </form>
      ) : null}

      <label className="fleet-sort">
        <ArrowDownUp size={14} aria-hidden />
        <span className="sr-only">Sort trucks</span>
        <select
          value={sort}
          onChange={(event) => go(value, event.target.value as FleetSort)}
          aria-label="Sort trucks"
        >
          <option value="crossing">Latest crossing</option>
          <option value="number">Truck number</option>
        </select>
      </label>
    </div>
  );
}
