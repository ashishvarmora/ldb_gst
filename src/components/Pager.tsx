import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { LinkPending } from "@/components/NavPending";
import { buttonClass, cx } from "@/components/ui";
import { fmtNumber } from "@/lib/format";

/**
 * One pagination control for the whole app.
 *
 * Every long list had grown its own Previous/Next block with its own idea of
 * how to rebuild the query string, which is three chances to drop a filter when
 * someone turns the page. This owns that rebuild once.
 *
 * It is a Server Component on purpose: pages are links, so a shared list stays
 * server-rendered, survives a refresh, and can be opened in a new tab.
 *
 * Which also means turning a page is a server round trip that loading.tsx never
 * sees - only ?page= changes, so the route segment is the same and no skeleton
 * runs. On a long table that is a second or two of a screen that has not
 * visibly reacted, and the reader taps Next again. The step links carry their
 * own pending state for that reason; see NavPending.tsx.
 *
 * USAGE
 *
 *   // total rows + page size, carrying the current filters
 *   <Pager
 *     page={page}
 *     total={rows.length}
 *     pageSize={50}
 *     noun="crossings"
 *     href={{ path: "/portal/records", params: { view, range, truck } }}
 *   />
 *
 *   // pages already known, href built by hand
 *   <Pager page={page} pages={pages} href={(n) => `/admin/officers?p=${n}`} />
 *
 *   // the short variant, for a list that grows in place
 *   <ShowMore href={moreHref} remaining={rest} noun="crossings" />
 */

/** Anything that can go in a query string. Empty values are dropped. */
export type PagerParams = Record<string, string | number | boolean | null | undefined>;

/**
 * Where page N lives. Either build the href yourself, or hand over the path and
 * the parameters to carry and let the Pager write the page number in.
 */
export type PagerHref =
  | ((page: number) => string)
  | { path: string; params?: PagerParams; pageKey?: string };

/** The href for one page. Exported so a caller can reuse it for a Show more. */
export function pagerHref(href: PagerHref, page: number): string {
  if (typeof href === "function") return href(page);

  const key = href.pageKey ?? "page";
  const query = new URLSearchParams();

  for (const [name, value] of Object.entries(href.params ?? {})) {
    // The page number comes from the argument, so a stale one carried in the
    // params can never win.
    if (name === key) continue;
    if (value === null || value === undefined || value === "" || value === false) continue;
    query.set(name, String(value));
  }

  // Page 1 is the default, so it is left out - the first page keeps a clean URL
  // and two links to it are the same link.
  if (page > 1) query.set(key, String(page));

  const search = query.toString();
  return search ? `${href.path}?${search}` : href.path;
}

/**
 * How many pages `total` rows make. Never below 1, so an empty list has page 1.
 *
 * Worth pairing with pageFromParam before a server-paged query runs: PostgREST
 * refuses a range that starts past the last row outright, so the page number
 * has to be clamped against a real count rather than corrected afterwards.
 */
export function pageCount(total: number, pageSize: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(pageSize) || pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The slice of an in-memory array that page N shows. */
export function pageSlice<T>(rows: T[], page: number, pageSize: number): T[] {
  const start = Math.max(0, (page - 1) * pageSize);
  return rows.slice(start, start + pageSize);
}

/** Clamps a raw ?page= value to something usable. */
export function pageFromParam(raw: string | undefined | null, pages = Number.MAX_SAFE_INTEGER): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(1, Math.trunc(value)), Math.max(1, pages));
}

export function Pager({
  page,
  pages,
  total,
  pageSize,
  href,
  noun = "rows",
  className,
  alwaysShow = false,
}: {
  /** Current page, 1-based. */
  page: number;
  /** Total pages. Give this, or `total` + `pageSize`. */
  pages?: number;
  /** Total rows, when the page count should be worked out here. */
  total?: number;
  pageSize?: number;
  href: PagerHref;
  /** What the rows are, for the count line: "of 431 crossings". */
  noun?: string;
  className?: string;
  /** Keep the control on screen even when everything fits on one page. */
  alwaysShow?: boolean;
}) {
  const totalPages =
    pages ?? (total !== undefined && pageSize ? pageCount(total, pageSize) : 1);
  const current = Math.min(Math.max(1, page), totalPages);

  /*
   * A page past the end always gets a way back.
   *
   * A list paged in the database cannot be relied on to know its own total
   * here: PostgREST answers a .range() that begins past the last row with an
   * error and no count at all, so `total` arrives as 0, this works out one
   * page, hides itself - and the reader is left on an empty screen with nothing
   * to click. Callers should clamp the page number before they query, and this
   * is what happens when one has not.
   */
  if (page > totalPages) {
    return (
      <nav
        aria-label="Pagination"
        className={cx("flex flex-wrap items-center gap-x-3 gap-y-2", className ?? "mt-3")}
      >
        <p className="text-xs tabular-nums text-muted">
          Page {fmtNumber(page)} is past the end of this list.
        </p>
        <Link href={pagerHref(href, 1)} className={buttonClass("secondary", "sm", "relative")}>
          <LinkPending size={14}>
            <ChevronLeft size={14} />
          </LinkPending>
          Back to the first page
        </Link>
      </nav>
    );
  }

  if (totalPages <= 1 && !alwaysShow) return null;

  // "1-50 of 431 crossings" when the totals are known, "Page 2 of 9" otherwise.
  const first = pageSize ? (current - 1) * pageSize + 1 : null;
  const last =
    pageSize && total !== undefined ? Math.min(current * pageSize, total) : null;
  const summary =
    first !== null && last !== null && total !== undefined
      ? `${fmtNumber(Math.min(first, total))}–${fmtNumber(last)} of ${fmtNumber(total)} ${noun}`
      : `Page ${fmtNumber(current)} of ${fmtNumber(totalPages)}`;

  return (
    <nav
      aria-label="Pagination"
      className={cx(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-2",
        className ?? "mt-3",
      )}
    >
      {/* The count reads second on a phone: the buttons are what a thumb wants. */}
      <p className="order-2 w-full text-xs tabular-nums text-muted sm:order-1 sm:w-auto">
        {summary}
      </p>

      <div className="order-1 flex w-full items-center gap-2 sm:order-2 sm:w-auto">
        <Step href={href} page={current - 1} disabled={current <= 1} label="Previous">
          <LinkPending size={14}>
            <ChevronLeft size={14} />
          </LinkPending>
          Previous
        </Step>

        <span className="shrink-0 px-1 text-xs tabular-nums text-muted">
          {fmtNumber(current)} / {fmtNumber(totalPages)}
        </span>

        <Step href={href} page={current + 1} disabled={current >= totalPages} label="Next">
          Next
          <LinkPending size={14}>
            <ChevronRight size={14} />
          </LinkPending>
        </Step>
      </div>
    </nav>
  );
}

function Step({
  href,
  page,
  disabled,
  label,
  children,
}: {
  href: PagerHref;
  page: number;
  disabled: boolean;
  label: string;
  children: ReactNode;
}) {
  // flex-1 on a phone so both steps are wide enough to hit; natural width once
  // there is room for the count line beside them. `relative` is what LinkPending
  // positions its wash against, and it costs nothing when nothing is loading.
  const shape = "relative flex-1 sm:flex-none";

  if (disabled) {
    return (
      <span
        aria-disabled
        className={cx(buttonClass("secondary", "sm", shape), "pointer-events-none opacity-45")}
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      href={pagerHref(href, page)}
      aria-label={label}
      className={buttonClass("secondary", "sm", shape)}
    >
      {children}
    </Link>
  );
}

/**
 * The short variant: one link that lengthens a list instead of replacing it.
 * Better than Previous/Next wherever the reader is scanning rather than
 * looking something up - credit history, a truck's recent crossings.
 */
export function ShowMore({
  href,
  remaining,
  noun = "more",
  className,
  children,
}: {
  /** Usually pagerHref(...) for the next page, or a link to the full list. */
  href: string;
  /** How many rows are still hidden. Shown when known. */
  remaining?: number;
  noun?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cx(
        buttonClass("ghost", "sm", "relative w-full justify-center gap-1.5 text-brand-500"),
        className,
      )}
    >
      <LinkPending size={13}>
        <Plus size={13} />
      </LinkPending>
      {children ??
        (remaining !== undefined ? `Show ${fmtNumber(remaining)} ${noun}` : `Show ${noun}`)}
    </Link>
  );
}
