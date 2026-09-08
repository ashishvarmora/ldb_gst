"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";

import { cx } from "@/components/ui";

import type { SearchEntry } from "./lib";

/**
 * The search box, and the only client component in the help centre.
 *
 * IT FILTERS IN THE BROWSER. No API route, no Server Action, no round trip per
 * keystroke. The whole index is a few kilobytes of strings and it arrives with
 * the page, so an officer on a slow connection gets an answer as fast as they
 * can type - which is the difference between a search box and a search box
 * nobody uses twice. A server search would be a request per keystroke over the
 * exact connection this product's customers have.
 *
 * The index comes in as a prop rather than being imported here on purpose. An
 * import would pull ./lib.ts - and through it every article's blocks - into
 * the browser bundle, so a reader would download the entire manual as
 * JavaScript in order to search the titles of it.
 *
 * RESULTS PUSH THE PAGE DOWN, they do not float over it. An absolutely
 * positioned dropdown on a phone covers the thing the reader is trying to
 * choose between and closes on the wrong tap. With an empty box nothing is
 * rendered at all, so the hub costs nothing for this.
 */
export function GuideSearch({
  index,
  labels,
  placeholder = "Search the guide — try “telegram” or “credit”",
}: {
  index: SearchEntry[];
  /** Category id to its plain-English title, so a result can say where it lives. */
  labels: Record<string, string>;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");

  const results = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    return index
      .filter((entry) => {
        /* Title, summary and the author's keywords, once per entry. Every
           token has to appear somewhere in it - "telegram silent" should find
           the one article about both, not everything about either. */
        const hay = `${entry.title} ${entry.summary} ${entry.keywords.join(" ")}`.toLowerCase();
        return tokens.every((token) => hay.includes(token));
      })
      .slice(0, 8);
  }, [index, query]);

  const searching = query.trim().length > 0;

  return (
    <div>
      <div className="relative">
        <SearchIcon
          size={16}
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-faint"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label="Search the guide"
          /* min-h-12: this is the one control on the page and a thumb has to
             hit it first time. pr-10 leaves room for the clear button, and the
             .field rule already forces 16px text on a phone so iOS does not
             zoom the whole page when it is focused. */
          className="field min-h-12 pr-10 pl-10"
        />
        {searching ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Clear the search"
            className="absolute top-1/2 right-1 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-faint transition hover:text-ink"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      {searching ? (
        <div className="mt-2.5">
          {results.length === 0 ? (
            <p className="rounded-xl border border-line bg-panel px-4 py-3.5 text-sm text-muted">
              Nothing matched <span className="font-medium text-ink">“{query.trim()}”</span>. Try a
              shorter word, or{" "}
              <Link href="/support" className="font-medium text-brand-500 hover:underline">
                ask us
              </Link>
              .
            </p>
          ) : (
            <ul className="divide-y divide-divider overflow-hidden rounded-xl border border-line bg-panel">
              {results.map((entry) => (
                <li key={`${entry.kind}-${entry.href}-${entry.title}`}>
                  <Link
                    href={entry.href}
                    className="flex min-h-12 flex-col justify-center gap-0.5 px-4 py-2.5 transition hover:bg-sunken"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 text-sm font-medium text-ink">
                        {entry.title}
                      </span>
                      <span
                        className={cx(
                          "shrink-0 text-[10px] font-semibold tracking-wider uppercase",
                          entry.kind === "faq" ? "text-good-500" : "text-faint",
                        )}
                      >
                        {entry.kind === "faq" ? "answer" : "guide"}
                      </span>
                    </span>
                    <span className="line-clamp-2 text-xs leading-relaxed text-muted">
                      {entry.summary}
                    </span>
                    <span className="text-[11px] text-faint">
                      {labels[entry.category] ?? entry.category}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
