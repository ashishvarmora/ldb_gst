import {
  PIVOT_DIMENSIONS,
  isPivotDimension,
  shiftDate,
  type Bucket,
  type LedgerKind,
  type PivotDimension,
  type PivotRow,
} from "@/lib/analytics";
import type { Measure } from "@/components/PivotTable";
import type { Sort } from "@/components/charts";

/**
 * The plumbing every report screen shares: how it reads itself out of the URL,
 * how it sorts, and how it hands the same rows over as a spreadsheet.
 *
 * All of it lives here because Finance and Users are two views of one ledger and
 * one account population, and the last time this console grew four near-copies
 * of an account table it also grew four sort vocabularies - "?sort=spent" on one
 * screen and "?order=credits_desc" on the next, for the same column. A reader
 * who learns one report then knows the other.
 *
 * The URL is the whole state, without exception. Group-by, filters, sort
 * direction and the date range are all query parameters, so a report is a link:
 * it can be pasted into a message, opened in a second tab beside another
 * slicing, survives a refresh, and the back button steps through the analysis
 * rather than out of it. That is not a preference in this codebase - it is why
 * an owner can say "look at this" instead of "click these six things".
 */

/* -------------------------------------------------------------------------- */
/* What a pivot explorer reads out of its URL                                  */
/* -------------------------------------------------------------------------- */

/**
 * The explorer's own parameters, beside whatever the date range contributes.
 *
 * Every facet filter is a LIST, and its parameter can arrive in either of the
 * two shapes a URL can carry one in: repeated (`?truck=A&truck=B`, which is
 * what a form full of checkboxes submits) or comma-joined (`?truck=A,B`, which
 * is what a hand-built link should say because it stays short enough to read).
 * parseList takes both, so the control and the links do not have to agree on a
 * convention - and a filter that only understood one of them would silently
 * ignore the other, which is a filter that looks applied and is not.
 */
export type ExplorerParams = {
  dims?: string | string[];
  kind?: string;
  account?: string | string[];
  truck?: string | string[];
  reason?: string | string[];
  source?: string | string[];
  sort?: string;
  dir?: string;
};

/**
 * A filter's chosen values, however the URL spelled them.
 *
 * Blanks are dropped rather than kept as an empty string, which is what makes
 * "no filter at all" the natural state: an unticked checkbox group submits
 * nothing, a cleared select submits `?truck=`, and both have to mean the same
 * thing - every truck - rather than "the truck whose number is the empty
 * string", which matches nothing and empties the report.
 */
export function parseList(raw: string | string[] | undefined): string[] {
  if (raw === undefined) return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const part of parts) {
    for (const value of part.split(",")) {
      const trimmed = value.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
  }
  return out;
}

/** The compact form of a chosen list, for a link. Empty means leave it out. */
export function joinList(values: string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}

/**
 * The dimensions in force, in the order they should read as columns.
 *
 * Unknown names are dropped rather than refused, and duplicates collapse: this
 * is a read-only screen, and blanking a report because a stale link carried a
 * dimension that has since been renamed helps nobody. An explicitly empty
 * `dims=` is honoured as "no grouping" - the totals row on its own - which is
 * how a reader asks for one number instead of a table.
 */
export function parseDims(
  /* Typed loosely because a URL can carry `?dims=a&dims=b`, and Next hands that
     over as an array. Calling .split on it would throw and turn a mistyped link
     into a 500 on a read-only report. */
  raw: string | string[] | undefined,
  fallback: PivotDimension[],
): PivotDimension[] {
  if (raw === undefined) return fallback;

  const seen: PivotDimension[] = [];
  for (const key of parseList(raw)) {
    if (isPivotDimension(key) && !seen.includes(key)) seen.push(key);
  }
  return seen;
}

export function parseKind(raw: string | undefined): LedgerKind {
  return raw === "spend" || raw === "grant" ? raw : "all";
}

/** How the current grouping reads in a sentence: "Customer, then Source". */
export function dimsSentence(dims: PivotDimension[]): string {
  if (dims.length === 0) return "Not grouped — one total row";
  return dims
    .map((dim) => PIVOT_DIMENSIONS.find((d) => d.key === dim)?.label ?? dim)
    .join(", then ");
}

/**
 * Adding or removing one dimension, keeping the rest in place.
 *
 * Appended rather than inserted in PIVOT_DIMENSIONS order, because the order
 * the reader switched them on in is the order they want to read them: somebody
 * who picks Customer and then Truck is asking "per customer, broken down by
 * truck", and silently reversing that is the report answering a different
 * question from the one that was asked.
 */
export function toggleDim(dims: PivotDimension[], dim: PivotDimension): PivotDimension[] {
  return dims.includes(dim) ? dims.filter((d) => d !== dim) : [...dims, dim];
}

/* -------------------------------------------------------------------------- */
/* Drilling into one period                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The inclusive IST dates one bucket covers, so clicking a period narrows the
 * report to exactly that period.
 *
 * A bucket is stored as the date it STARTS on, which is why this is needed at
 * all: a monthly row labelled "Mar 2026" is the single date 2026-03-01 in the
 * data, and a drill-through that passed that date as both ends of a custom
 * range would answer for one day and look like the other thirty had vanished.
 *
 * Months are walked as calendar months rather than by adding 30 days, so
 * February does not spill into March and December does not lose a day.
 */
export function bucketRange(bucket: string, grain: Bucket): { from: string; to: string } {
  if (grain === "day") return { from: bucket, to: bucket };
  if (grain === "week") return { from: bucket, to: shiftDate(bucket, 6) };

  const [year, month] = bucket.split("-").map(Number);
  const firstOfNext =
    month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, "0")}-01`;
  return { from: bucket, to: shiftDate(firstOfNext, -1) };
}

/* -------------------------------------------------------------------------- */
/* Sorting                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The sort, read out of `?sort=` and `?dir=`.
 *
 * Descending is the default for a newly chosen column. Every measure on these
 * screens is a magnitude - credits, rupees, charges, accounts - and "biggest
 * first" is what somebody clicking a total wants. A dimension column gets the
 * same treatment for consistency; one click reverses it.
 */
export function parseSort(params: { sort?: string; dir?: string }, fallback: Sort): Sort {
  if (!params.sort) return fallback;
  return { key: params.sort, desc: params.dir !== "asc" };
}

/**
 * A query string from parameters that may be absent.
 *
 * Undefined is dropped; an empty string is KEPT. The difference is load bearing
 * for exactly one parameter: `dims=` is how a reader asks for no grouping at
 * all - one totals row - and dropping it would let the screen's default
 * grouping reappear the moment they sorted a column or applied a filter, which
 * reads as the report undoing what they just asked for.
 *
 * This exists because URLSearchParams' own constructor will not take a record
 * with optional values, and every screen that built one by hand instead reached
 * for a spread that turned a missing filter into the literal string
 * "undefined".
 */
export function queryString(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value === undefined) continue;
    query.set(name, value);
  }
  return query.toString();
}

/**
 * Which two parameters a table's order lives in.
 *
 * Configurable because a screen can carry two sortable tables, and one shared
 * `?sort=` would mean clicking a header on either reorders both - leaving one
 * of them sorted by a column it does not have, which lands on its fallback and
 * reads as the click having done nothing.
 */
export type SortKeys = { sort: string; dir: string };

const DEFAULT_SORT_KEYS: SortKeys = { sort: "sort", dir: "dir" };

/**
 * A link that sorts by one column, flipping the direction when it is already
 * the column in force.
 *
 * `base` is the path and `carried` is everything that must survive the click -
 * the date range, the grouping, the filters, the section, the OTHER table's
 * order. Sorting a report and losing its filters is the failure this exists to
 * make impossible, and it is why no screen builds this query string by hand.
 *
 * `hash` is worth passing for any table that is not at the top of its page.
 * Sorting is a navigation, Next scrolls a navigation to the top, and a reader
 * who clicks a column header two screens down and is thrown back to the
 * headline figures has to find their place again on every click.
 */
export function sortHrefFor(
  base: string,
  carried: Record<string, string | undefined>,
  sort: Sort,
  { keys = DEFAULT_SORT_KEYS, hash }: { keys?: SortKeys; hash?: string } = {},
): (key: string) => string {
  return (key: string) => {
    // Same column: reverse it. New column: start at the top. A sorted report is
    // a new result set, so page three of the old one is meaningless and the
    // page number is left out rather than carried into it.
    const desc = sort.key === key ? !sort.desc : true;
    const query = queryString({
      ...carried,
      page: undefined,
      [keys.sort]: key,
      [keys.dir]: desc ? "desc" : "asc",
    });
    return `${base}?${query}${hash ? `#${hash}` : ""}`;
  };
}

/** The current sort as parameters, for a link that must preserve it. */
export function sortParams(sort: Sort, keys: SortKeys = DEFAULT_SORT_KEYS): Record<string, string> {
  return { [keys.sort]: sort.key, [keys.dir]: sort.desc ? "desc" : "asc" };
}

/** Where a grouped row's own dimension value sorts. */
function dimensionSortValue(row: PivotRow, key: PivotDimension): string {
  switch (key) {
    case "bucket":
      // The ISO date, not the rendered "12 Mar" - which would sort April before
      // February for every month of the year.
      return row.bucket ?? "";
    case "account":
      return row.account ?? "";
    case "truck":
      return row.truck_number ?? "";
    case "reason":
      return row.reason ?? "";
    case "source":
      return row.source ?? "";
  }
}

/**
 * Reorder grouped rows by a dimension or a measure.
 *
 * In JavaScript rather than in the database on purpose. A grouped result is at
 * most a few hundred rows - one per customer per source, say - so ordering it
 * here costs nothing measurable and it means a measure the screen invented, like
 * what a giveaway cost in rupees, is sortable without a matching ORDER BY
 * clause existing in SQL. The ROWS are always grouped in the database; only
 * their order is decided here.
 */
export function sortPivotRows(rows: PivotRow[], sort: Sort, measures: Measure[]): PivotRow[] {
  const measure = measures.find((m) => m.key === sort.key);
  const direction = sort.desc ? -1 : 1;

  if (measure) {
    return [...rows].sort((a, b) => (measure.value(a) - measure.value(b)) * direction);
  }

  if (isPivotDimension(sort.key)) {
    const key = sort.key;
    return [...rows].sort(
      (a, b) => dimensionSortValue(a, key).localeCompare(dimensionSortValue(b, key)) * direction,
    );
  }

  // An unrecognised column leaves the database's own order alone rather than
  // scrambling it, so a stale link still renders a readable report.
  return rows;
}

/* -------------------------------------------------------------------------- */
/* The same rows, as a spreadsheet                                             */
/* -------------------------------------------------------------------------- */

/** Quote only when the cell would otherwise break the row. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(header: string[], rows: (string | number | null | undefined)[][]): string {
  // CRLF, because Excel on Windows is where these land and a bare LF puts the
  // whole sheet on one line in older versions of it.
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/**
 * A CSV as a download.
 *
 * The BOM is not decoration: without it Excel reads the file as the system
 * codepage, and every officer name with a Devanagari or accented character
 * arrives as mojibake in the one place somebody is about to email it onward.
 */
export function csvFile(filename: string, body: string): Response {
  return new Response(`﻿${body}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      // A report is a snapshot of a moving ledger, so a cached copy is a wrong
      // copy the moment anything is charged.
      "Cache-Control": "no-store",
    },
  });
}

/**
 * The grouped ledger as a spreadsheet: one column per dimension, one per
 * measure, and the totals row last.
 *
 * The dimension columns carry RAW values where the screen carries prose - the
 * ISO bucket date rather than "12 Mar", the ledger's own reason key rather than
 * "Automatic check", the account's uuid beside its name. A CSV exists to be
 * joined against something else, and a label that has been through a lookup
 * table is the one thing that cannot be joined on.
 */
export function pivotCsv({
  rows,
  dims,
  measures,
  totals,
  bucket,
}: {
  rows: PivotRow[];
  dims: PivotDimension[];
  measures: Measure[];
  totals?: PivotRow | null;
  bucket: Bucket;
}): string {
  /*
   * The label column, and why it is conditional.
   *
   * With no dimensions the pivot returns exactly one row - the totals row for
   * the whole window - and a sheet whose first column is a credit figure with
   * no heading is unreadable. With dimensions, the dimension columns already
   * name every row and a label column would be an empty first column.
   *
   * Header and body are built from the same flag rather than one being patched
   * afterwards, because the first version of this prepended a heading to the
   * header only: every body row then sat one column to the left of its own
   * column name, which is the kind of error a spreadsheet does not complain
   * about and a person does not notice until they have filtered on it.
   */
  const labelled = dims.length === 0;

  const header: string[] = labelled ? ["Everything"] : [];
  for (const dim of dims) {
    if (dim === "bucket") header.push(`Period (${bucket}, IST)`);
    // The uuid alongside the name: a sheet exists to be joined against
    // something else, and two officers with one name are two rows the name
    // cannot separate.
    else if (dim === "account") header.push("Customer", "Customer id");
    else if (dim === "truck") header.push("Truck");
    else if (dim === "reason") header.push("Reason");
    else header.push("Source");
  }
  header.push(...measures.map((measure) => measure.label));
  header.push("First entry", "Last entry");

  const line = (row: PivotRow, label: string): (string | number | null)[] => {
    const cells: (string | number | null)[] = labelled ? [label] : [];
    for (const dim of dims) {
      if (dim === "bucket") cells.push(row.bucket);
      else if (dim === "account") cells.push(row.account, row.user_id);
      else if (dim === "truck") cells.push(row.truck_number);
      else if (dim === "reason") cells.push(row.reason);
      else cells.push(row.source);
    }
    // The raw number, unformatted: a spreadsheet cannot add up "1,234.5" once a
    // locale has put a group separator in it.
    cells.push(...measures.map((measure) => measure.value(row)));
    cells.push(row.first_at, row.last_at);
    return cells;
  };

  const body = rows.map((row) => line(row, "All rows"));

  /*
   * The totals row last, and marked in the first column whatever that column
   * is, so a reader who re-sorts the sheet in Excel can still tell which row it
   * was. Only ONE cell says TOTAL: an earlier version wrote it once per
   * dimension and produced "TOTAL,TOTAL," across three columns.
   */
  if (totals) {
    const totalsLine = line(totals, "TOTAL");
    if (!labelled) {
      for (let i = 0; i < header.length - measures.length - 2; i += 1) {
        totalsLine[i] = i === 0 ? "TOTAL" : "";
      }
    }
    body.push(totalsLine);
  }

  return toCsv(header, body);
}
