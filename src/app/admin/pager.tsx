import type { ReactNode } from "react";

import { pageCount, pageFromParam } from "@/components/Pager";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The small pieces every admin list needs that the shared Pager does not carry:
 * the window a server-paged query asks for, a note about a cap the reader has
 * to know about, and a search term that cannot break the query it goes into.
 *
 * Everything else - Pager, ShowMore, pagerHref, pageSlice, pageCount,
 * pageFromParam - comes from @/components/Pager and is imported directly.
 */

/**
 * The [from, to] pair PostgREST's .range() wants for page N.
 *
 * Nothing is clamped here, so this is only safe for a page number that has
 * already been checked against a real row count - see pageWindow, which does
 * both and is what a server-paged list should be using.
 */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = Math.max(0, (page - 1) * pageSize);
  return { from, to: from + pageSize - 1 };
}

/**
 * The page to show, and the range to ask PostgREST for, given how many rows
 * there really are.
 *
 * A range that starts past the last row is not an empty page: PostgREST answers
 * it with 416 and PGRST103, which arrives as data null, count null AND an
 * error. Null count reads as zero rows, zero rows is one page, and the Pager
 * hides itself on a single page - so a stale ?page=9 rendered as "there is
 * nothing here" with no link back to the rows that do exist. Reading the count
 * first, in its own head request, costs one round trip and means the reader
 * lands on the last page instead of being stranded.
 */
export function pageWindow(
  raw: string | undefined | null,
  total: number,
  pageSize: number,
): { page: number; from: number; to: number } {
  const page = pageFromParam(raw, pageCount(total, pageSize));
  return { page, ...pageRange(page, pageSize) };
}

/**
 * A PostgREST read with its filters on, before a range or an order.
 *
 * Counting first means every filter has to be applied twice - once to the head
 * request, once to the rows - and two copies of a filter chain is two chances
 * to narrow one and forget the other. Naming the builder lets a page write its
 * filters in a single function and hand both reads through it. The admin client
 * is deliberately untyped, so every select() gives back this same shape.
 */
export type AdminQuery = ReturnType<
  ReturnType<ReturnType<typeof getSupabaseAdmin>["from"]>["select"]
>;

/**
 * Strips what would otherwise break a PostgREST or/ilike filter.
 *
 * A comma separates the branches of an .or(), so a customer searching for
 * "Sharma, Rajesh" split the filter mid-word and got a raw parse error - a
 * failure that reads as a broken console rather than as a search that found
 * nothing. Brackets, wildcards and backslashes are dropped for the same reason.
 */
export function safeTerm(raw: string): string {
  return raw.replace(/[(),*%\\]/g, " ").trim();
}

/**
 * A cap the reader needs to know about. A truncated list that looks complete is
 * worse than a slow one, so wherever a limit stays for cost reasons it says so
 * on screen rather than quietly ending.
 */
export function CapNote({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-xs text-faint">{children}</p>;
}
