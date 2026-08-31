import type { ReactNode } from "react";

/**
 * The two things the admin lists need that the shared Pager does not carry.
 *
 * Everything else - Pager, ShowMore, pagerHref, pageSlice, pageCount,
 * pageFromParam - comes from @/components/Pager and is imported directly.
 */

/**
 * The [from, to] pair PostgREST's .range() wants for page N.
 *
 * Server-side paging has to ask for the rows before it knows how many there
 * are, so there is nothing to clamp against here. A page past the end returns
 * no rows; the pages say so on screen and the Pager still links back.
 */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = Math.max(0, (page - 1) * pageSize);
  return { from, to: from + pageSize - 1 };
}

/**
 * A cap the reader needs to know about. A truncated list that looks complete is
 * worse than a slow one, so wherever a limit stays for cost reasons it says so
 * on screen rather than quietly ending.
 */
export function CapNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs text-faint">{children}</p>;
}
