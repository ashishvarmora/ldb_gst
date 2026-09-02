import Link from "next/link";
import {
  ArrowDown,
  ArrowDownUp,
  ArrowDownWideNarrow,
  ArrowUp,
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  Download,
  Minus,
  Plus,
  Tag,
  X,
  type LucideIcon,
} from "lucide-react";

import { FilterSubmitButton } from "@/components/NavPending";
import { FilterPill } from "@/components/FilterPill";
import { EmptyState, Mono, Panel, buttonClass, cx } from "@/components/ui";
import { CREDIT_SOURCES } from "@/lib/analytics";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { fmtDateTime, istDaysAgo, istMonthStart, istToday } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Where the credits went. One component, mounted for one account or for all.
 *
 * The officer's own page, the admin's per-customer tab and the platform-wide
 * view render this same file. Everything is read from credit_ledger_daily and
 * credit_transactions, and NOTHING here computes a cost: the charge was decided
 * once, by spend_credits() at the moment it happened, and stored. This screen
 * only ever adds up what is already on the ledger, so what a customer is shown
 * cannot drift from what they were charged even if a rate changes tomorrow.
 *
 * GROUPING IS A SET OF DIMENSIONS, not a mode. It used to be three fixed
 * choices - per-truck-per-day, per-day, every-charge - which left most of the
 * useful combinations unreachable. Day, truck and account are toggles now:
 * day+truck is the old default, truck alone answers "what has this lorry cost
 * me this month", account alone ranks customers, and turning them all off
 * leaves the raw ledger. One control, and the combinations come free.
 *
 * THE FILTER BAR IS TWO ROWS: what arranges the rows, then what narrows them.
 *
 * It used to be five rows - group-by, a date range in three rows of its own, and
 * a "More filters" fold that opened three more rows of chips - which on a 390px
 * phone put roughly 400px of controls above the first charge. Every chip row
 * showed all of its options all of the time, so the reader had to read twelve
 * chips to find out that nothing was filtered.
 *
 * Now each filter is one pill that reads as its own current answer, and the
 * options only exist while somebody is choosing (see FilterPill). Nothing is
 * hidden by that: a pill off its default takes the brand colour, so a filter can
 * never be quietly in force - which on a page people reconcile a bill on is the
 * whole point. The date range gets presets, so the common windows are one tap
 * and the two date boxes only appear for a range that is genuinely custom.
 *
 * SORTING IS NOT FILTERING, and the two rows say which is which. Order was a
 * pill in the filter row, which claimed to narrow a list it only rearranges -
 * and it went brand off its default, so "Biggest first" wore the colour this
 * screen uses to mean "something is being hidden from you". It is a sort button
 * now, square-cornered and always neutral, on the row with the grouping
 * toggles: both of those arrange rows, and everything on the second row removes
 * them.
 *
 * A REASON THAT CANNOT HAPPEN IS NOT OFFERED. The Reason options are whatever
 * the current Show can actually produce - spending reasons under "Credits
 * used", granting ones under "Credits added" - because the pills used to let
 * somebody ask for credits added by a manual search, which is a combination no
 * ledger can ever answer, and the screen replied with an empty list as though
 * the charges were missing. Changing Show rewrites the reason parameter in the
 * same link, so a reason that has just become impossible is gone before the
 * next render rather than after it.
 *
 * Reasons are a SET, not a choice: the URL carries a list, the query uses
 * .in(), and the source buckets - bought, given by an admin, free - are rows
 * that turn their own reasons on together. Everything can be turned off again
 * from inside its own sheet, and nothing selected means nothing filtered.
 *
 * State lives in the URL, and the only client state in the whole screen is
 * whether a pill's sheet is open. Every view is linkable, the back button steps
 * through filter changes, and the CSV export is the same query string with a
 * different path - so what downloads is exactly what is on screen.
 */

export type LedgerKind = "all" | "used" | "added";
export type LedgerSort = "newest" | "oldest" | "largest";

/** What a row may be grouped by. None selected means the raw ledger. */
export type LedgerDimension = "day" | "truck" | "user";

export type LedgerQuery = {
  /** Comma-separated dimensions, or "none" for every individual charge. */
  by?: string;
  /**
   * The old three-mode parameter. Read only so links already in circulation -
   * and anything an admin bookmarked - land where they meant to instead of
   * silently falling back to the default grouping.
   */
  view?: string;
  kind?: string;
  /**
   * One reason, or several separated by commas. A list rather than a single
   * value so a bucket - "given by an admin" is two reasons, "free" is four -
   * is one tap instead of a filter the reader cannot express at all.
   */
  reason?: string;
  /** A filter on one truck, which is a different thing from grouping by truck. */
  truck?: string;
  /** Inclusive IST date range. `from` alone means since; `to` alone, until. */
  from?: string;
  to?: string;
  sort?: string;
  page?: string;
};

const DIMENSIONS: { key: LedgerDimension; label: string; adminOnly?: boolean }[] = [
  { key: "day", label: "Day" },
  { key: "truck", label: "Truck" },
  { key: "user", label: "Account", adminOnly: true },
];

/**
 * The orders, each with the arrow that shows which way it runs.
 *
 * Two labels because the control has two jobs. The sheet spells the order out -
 * "Newest first" is the sentence somebody is choosing - and the button carries
 * only the word that changes, because the button sits on a row that has to fit
 * a phone alongside the grouping toggles.
 */
const SORT_OPTIONS = [
  { key: "newest", label: "Newest first", short: "Newest", icon: ArrowDown },
  { key: "oldest", label: "Oldest first", short: "Oldest", icon: ArrowUp },
  { key: "largest", label: "Biggest first", short: "Biggest", icon: ArrowDownWideNarrow },
] as const satisfies readonly {
  key: LedgerSort;
  label: string;
  short: string;
  icon: LucideIcon;
}[];

const KIND_LABEL: Record<LedgerKind, string> = {
  all: "Everything",
  used: "Credits used",
  added: "Credits added",
};

/**
 * The buckets a reason can fall into, in the order they are offered.
 *
 * These are credit_source()'s own buckets - see 0022_credit_sources_and_bonus
 * _coupons.sql - and credit_ledger_daily carries the answer in a column, so
 * this screen never has to re-derive which bucket a row belongs to. Which
 * matters most for plan_grant, the one reason that is 'paid' when a payment
 * caused it and 'admin' when somebody assigned the plan by hand: guessing from
 * the reason alone would file half of them under the wrong heading.
 *
 * 'spend' is in the list because negative rows carry it, even though it is not
 * a source of credits at all.
 */
const BUCKETS = ["spend", "paid", "admin", "free", "other"] as const;

type ReasonBucket = (typeof BUCKETS)[number];

/** A bucket of reasons, as one heading in the Reason sheet. */
type ReasonGroup = { bucket: ReasonBucket; label: string; reasons: string[] };

/**
 * How a bucket reads. Borrowed from CREDIT_SOURCES so the customer's ledger and
 * the console's own breakdown of where credits came from cannot call one bucket
 * two things; 'spend' has no entry there, because spending is not a source.
 */
function bucketLabel(bucket: ReasonBucket): string {
  if (bucket === "spend") return "Spent";
  return CREDIT_SOURCES.find((source) => source.key === bucket)?.label ?? "Unclassified";
}

/**
 * How far back an unbounded view reaches. A date range overrides it. Without
 * one, reading a busy account's whole ledger would be thousands of rows folded
 * for a screen that shows ten.
 */
const WINDOW_DAYS = 60;

/**
 * Page sizes, chosen per list rather than one number everywhere.
 *
 * A rollup row is a summary somebody reads and decides on, so ten is about a
 * phone screen and a page turn is cheap. A raw ledger row is something somebody
 * SCANS - reconciling a bill, hunting a timestamp - and there density is the
 * point: fifty short rows beat four page turns.
 */
const ROLLUP_PAGE = 10;
const ENTRY_PAGE = 50;

/** Ceiling on rows folded in memory, so one huge account cannot stall a page. */
const FOLD_CAP = 4000;

function parseSort(raw: string | undefined): LedgerSort {
  return raw === "oldest" || raw === "largest" ? raw : "newest";
}

function parseKind(raw: string | undefined): LedgerKind {
  return raw === "used" || raw === "added" ? raw : "all";
}

/**
 * The reasons this ledger can show under the current Show, grouped by bucket.
 *
 * Built from the (reason, source) pairs the ledger actually holds rather than
 * from a list written here, for two reasons. A reason nobody has ever been
 * charged under is an option that only ever returns nothing. And what counts as
 * SPENDING is a fact about the rows, not about the reason: admin_adjust is a
 * granting reason until an administrator takes credits back with it, and then
 * the same reason has spent some - so a hard-coded list of "the two spending
 * reasons" would hide those rows from "Credits used" for ever.
 *
 * A reason that has both granted and spent is listed under what it granted,
 * unless only spending is on screen. Listing it twice would put two rows in one
 * sheet that filter on exactly the same column value.
 */
function reasonGroups(
  pairs: { reason: string; source: string }[],
  kind: LedgerKind,
): ReasonGroup[] {
  const seen = new Map<string, Set<string>>();
  for (const { reason, source } of pairs) {
    const sources = seen.get(reason) ?? new Set<string>();
    // An unrecognised bucket is called out rather than quietly dropped, the
    // same way credit_source() refuses to count an unknown reason as free.
    sources.add((BUCKETS as readonly string[]).includes(source) ? source : "other");
    seen.set(reason, sources);
  }

  const grouped = new Map<ReasonBucket, string[]>();
  for (const [reason, sources] of seen) {
    const granted = BUCKETS.filter((bucket) => bucket !== "spend" && sources.has(bucket));
    if (kind === "used" && !sources.has("spend")) continue;
    if (kind === "added" && granted.length === 0) continue;

    const bucket: ReasonBucket = kind === "used" ? "spend" : (granted[0] ?? "spend");
    grouped.set(bucket, [...(grouped.get(bucket) ?? []), reason]);
  }

  return BUCKETS.filter((bucket) => grouped.has(bucket)).map((bucket) => ({
    bucket,
    label: bucketLabel(bucket),
    reasons: (grouped.get(bucket) ?? []).sort((a, b) =>
      reasonLabel(a).localeCompare(reasonLabel(b)),
    ),
  }));
}

/**
 * The reasons in force.
 *
 * Filtered against what the current Show can produce, which is what stops an
 * impossible combination surviving in a link. Somebody who narrows to a manual
 * search, switches to "Credits added" and bookmarks the result gets a URL whose
 * reason cannot match a single row; read through this, that reason is simply
 * dropped and the ledger answers the question that is left.
 *
 * Sorted, so the two routes to one selection - tapping a bucket, or tapping its
 * reasons one at a time - produce the same URL and the same cache entry.
 */
function parseReasons(raw: string | undefined, possible: Set<string>): string[] {
  if (!raw) return [];
  const asked = new Set(raw.split(",").map((part) => part.trim()));
  return [...possible].filter((reason) => asked.has(reason)).sort();
}

/** A reason selection as the URL carries it. Nothing selected is no parameter. */
function reasonParam(reasons: string[]): string | undefined {
  return reasons.length > 0 ? reasons.join(",") : undefined;
}

/**
 * One reason or a whole bucket, turned on or off.
 *
 * A bucket already fully selected turns all of its reasons off, which is how
 * "given by an admin" gets a way back out that is not the row's Clear - the
 * thing the owner asked for when they said every option must select and
 * deselect.
 */
function toggleReasons(selected: string[], values: string[]): string[] {
  const next = new Set(selected);
  const allOn = values.every((value) => next.has(value));
  for (const value of values) {
    if (allOn) next.delete(value);
    else next.add(value);
  }
  return [...next].sort();
}

/**
 * The dimensions in force.
 *
 * An absent `by` is the default - day and truck, the question people arrive
 * with. "none" is the explicit choice of no grouping, which is how turning the
 * last toggle off differs from never having touched them.
 */
function parseDimensions(
  raw: string | undefined,
  allowUser: boolean,
  legacyView?: string,
): LedgerDimension[] {
  /* An old ?view= link, translated once. Only consulted when `by` is absent, so
     the moment somebody touches a toggle the new parameter takes over. */
  if (raw === undefined && legacyView) {
    if (legacyView === "entries") return [];
    if (legacyView === "day") return ["day"];
    if (legacyView === "truck-day") return ["day", "truck"];
  }
  if (raw === undefined) return ["day", "truck"];
  if (raw === "none") return [];
  const asked = raw.split(",").map((part) => part.trim());
  return DIMENSIONS.filter((dim) => asked.includes(dim.key) && (allowUser || !dim.adminOnly)).map(
    (dim) => dim.key,
  );
}

/** ISO date, or null. Guards against a hand-typed from=yesterday. */
function parseDate(raw: string | undefined): string | null {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return Number.isNaN(Date.parse(`${raw}T00:00:00+05:30`)) ? null : raw;
}

/** One IST day boundary, as the UTC instant it begins. */
function istStart(date: string): string {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

type DatePreset = { key: string; label: string; from: string | null; to: string | null };

/**
 * The date windows worth one tap, resolved to the `from` and `to` this ledger
 * has always taken.
 *
 * Deliberately NOT a new ?range=30d parameter. The CSV export reads from and to
 * off the same query string, and so does the drill-down link on every grouped
 * row, so a window that only the page knew how to expand would download a
 * different set of charges from the one on screen. Absolute dates cost a link
 * that says "last 30 days" its freshness a month later, and that is the right
 * trade for an export that cannot disagree with the screen.
 *
 * The first entry clears both parameters, which is the rolling window the ledger
 * falls back to - named out loud so the default reads as a choice rather than as
 * an absence.
 */
function datePresets(): DatePreset[] {
  const today = istToday();
  return [
    { key: "rolling", label: `Last ${WINDOW_DAYS} days`, from: null, to: null },
    { key: "today", label: "Today", from: today, to: today },
    { key: "7d", label: "Last 7 days", from: istDaysAgo(6), to: today },
    { key: "30d", label: "Last 30 days", from: istDaysAgo(29), to: today },
    { key: "month", label: "This month", from: istMonthStart(), to: today },
  ];
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Aug", and the year as well when it is asked for. */
function dayMonth(date: string, withYear: boolean): string {
  const [year, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}${withYear ? ` ${year}` : ""}`;
}

/**
 * How a hand-picked date range reads on a pill, in a row with no width to spare.
 *
 * Split rather than parsed: a YYYY-MM-DD here is already an IST calendar date,
 * and running it through Date would re-interpret it in whatever zone the server
 * happens to run in, which is how a range ends up labelled a day off its own
 * date boxes.
 *
 * Both ends on the same day is the commonest range on this screen - it is what
 * tapping a grouped row produces - and "2 Sep → 2 Sep" is a wider way of saying
 * "2 Sep". A shared year is printed once, at the end, and the current year not
 * at all, for the same reason: every character this pill takes is one the next
 * pill in the row does not get. A one-sided range says which side it is open on
 * rather than filling the other end with the word "today".
 */
function rangeLabel(from: string | null, to: string | null): string {
  const thisYear = istToday().slice(0, 4);
  if (from && to) {
    const shared = from.slice(0, 4) === to.slice(0, 4);
    const trailingYear = shared && from.slice(0, 4) !== thisYear ? ` ${from.slice(0, 4)}` : "";
    if (from === to) return `${dayMonth(from, false)}${trailingYear}`;
    return `${dayMonth(from, !shared)} → ${dayMonth(to, !shared)}${trailingYear}`;
  }
  if (from) return `since ${dayMonth(from, from.slice(0, 4) !== thisYear)}`;
  if (to) return `until ${dayMonth(to, to.slice(0, 4) !== thisYear)}`;
  return "";
}

/** A reason label a customer should read, never the raw column value. */
function reasonLabel(reason: string): string {
  return CREDIT_REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

type LedgerFilters = {
  userId: string | null;
  since: string;
  until: string | null;
  kind: LedgerKind;
  /** Empty means every reason, which is not the same as one reason called "". */
  reasons: string[];
  truck?: string;
};

type RollupRow = {
  user_id: string;
  ist_date: string;
  reason: string;
  truck_number: string | null;
  entries: number;
  credits: number;
  last_at: string;
  balance_after: number;
};

type EntryRow = {
  id: number;
  created_at: string;
  user_id: string;
  reason: string;
  delta: number;
  balance_after: number;
  truck_number: string | null;
  note: string | null;
};

/** A grouped row and the key it was folded on. */
type Folded = {
  key: string;
  ist_date: string | null;
  truck_number: string | null;
  user_id: string | null;
  entries: number;
  credits: number;
  last_at: string;
  balance_after: number;
};

function href(
  basePath: string,
  query: LedgerQuery,
  patch: Partial<LedgerQuery>,
  keep: Record<string, string> = {},
): string {
  const merged: Record<string, string | undefined> = { ...keep, ...query, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    // Any filter change returns to page one: staying on page 4 of a list that
    // just became six rows long shows an empty screen.
    if (key === "page" && patch.page === undefined) continue;
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/** Toggling one dimension on or off, as a link. */
function dimensionHref(
  basePath: string,
  query: LedgerQuery,
  keep: Record<string, string>,
  active: LedgerDimension[],
  dim: LedgerDimension,
): string {
  const next = active.includes(dim) ? active.filter((d) => d !== dim) : [...active, dim];
  // Canonical order, so two routes to the same view share one URL.
  const ordered = DIMENSIONS.filter((d) => next.includes(d.key)).map((d) => d.key);
  return href(basePath, query, { by: ordered.length === 0 ? "none" : ordered.join(",") }, keep);
}

export async function CreditLedger({
  userId,
  basePath,
  query,
  keep = {},
  title = "Credit history",
}: {
  /** One account, or null for every account - which only the console passes. */
  userId: string | null;
  basePath: string;
  query: LedgerQuery;
  keep?: Record<string, string>;
  title?: string;
}) {
  const admin = getSupabaseAdmin();
  const platformWide = userId === null;
  const dimensions = parseDimensions(query.by, platformWide, query.view);
  const kind = parseKind(query.kind);
  const sort = parseSort(query.sort);
  const page = Math.max(Number(query.page) || 1, 1);

  const from = parseDate(query.from);
  const to = parseDate(query.to);
  const ranged = Boolean(from || to);

  /* A range replaces the rolling window; without one, sixty days back. */
  const since = from
    ? istStart(from)
    : new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();
  /* `to` is inclusive, so the bound is the start of the following day. */
  const until = to ? new Date(Date.parse(istStart(to)) + 86_400_000).toISOString() : null;

  const rawEntries = dimensions.length === 0;

  /* Names once, so no row joins profiles for a label. Only needed where more
     than one account can appear. */
  const nameOf = new Map<string, string>();
  if (platformWide) {
    const { data: people } = await admin.from("profiles").select("id, full_name, email");
    for (const p of (people ?? []) as { id: string; full_name: string | null; email: string }[]) {
      nameOf.set(p.id, p.full_name?.trim() || p.email);
    }
  }

  /* Which reasons this ledger actually contains and which bucket each of them
     has turned up in, so the filter offers what is there rather than a fixed
     list of mostly-empty options. The source column is credit_source() itself,
     so a plan grant an admin made and one a payment made land in the buckets
     the console would put them in too. */
  let reasonQuery = admin.from("credit_ledger_daily").select("reason,source").gte("last_at", since);
  if (userId) reasonQuery = reasonQuery.eq("user_id", userId);
  const { data: reasonRows } = await reasonQuery;
  const reasonPairs = (reasonRows ?? []) as { reason: string; source: string }[];

  const groups = reasonGroups(reasonPairs, kind);
  const possible = new Set(groups.flatMap((group) => group.reasons));
  const reasons = parseReasons(query.reason, possible);

  /*
   * What a reason selection becomes under a different Show, computed for the
   * link rather than after following it.
   *
   * Switching to "Credits added" with a manual search selected has to arrive
   * already free of it. Left to a redirect, or to the parse on the next render,
   * the reader would first be shown an empty ledger under a filter they did not
   * choose and could not see - and this is the screen where an empty list reads
   * as "you were never charged for that".
   */
  const reasonsUnder = (next: LedgerKind): string | undefined => {
    const survives = new Set(reasonGroups(reasonPairs, next).flatMap((group) => group.reasons));
    return reasonParam(reasons.filter((reason) => survives.has(reason)));
  };

  const filters: LedgerFilters = {
    userId,
    since,
    until,
    kind,
    reasons,
    truck: query.truck,
  };

  /*
   * The export is this view, as a file. Same query string, different path, so
   * what downloads is exactly what is on screen rather than a second reading of
   * the filters. The route reads the reason list the way this screen does - one
   * value compared with =, several with in() - so a whole bucket downloads as
   * the bucket.
   *
   * The list is re-serialised from the PARSED reasons rather than passed
   * straight off the query string, because those are not always the same set.
   * A link carrying kind=added&reason=manual_search is a filter this screen
   * ignores - see parseReasons - but the export has no notion of which reasons
   * a Show can produce, so it would apply both, match nothing, and hand over an
   * empty spreadsheet for a screen with rows on it.
   */
  const csvHref = href(
    "/api/export/credits",
    query,
    { reason: reasonParam(reasons) },
    userId ? { user: userId } : {},
  );

  /* Which preset the dates currently amount to, if any. A range typed by hand,
     or arrived at by tapping a grouped row, matches none of them and is spelt
     out on the pill instead. */
  const presets = datePresets();
  const preset = presets.find((option) => option.from === from && option.to === to);
  const dateLabel = preset?.label ?? rangeLabel(from, to);

  /* Sort is not counted: it reorders the list, it does not narrow it, and a
     "Clear" that silently threw away the order somebody chose would be a
     surprise rather than a relief. */
  const narrowed = ranged || kind !== "all" || reasons.length > 0 || Boolean(query.truck);

  const ordering = SORT_OPTIONS.find((option) => option.key === sort) ?? SORT_OPTIONS[0];
  const OrderingIcon = ordering.icon;

  /*
   * How the Reason pill reads when it is closed.
   *
   * A selection that is exactly one bucket says the bucket, because that is the
   * row that was tapped and "2 reasons" would be a worse answer than "Given by
   * an admin". Two buckets, or a hand-picked pair, has no name worth inventing
   * and is counted instead. The single-group case is excluded: with one bucket
   * on offer, selecting all of it is the same set as no filter at all, and
   * naming it would suggest something is being held back.
   */
  const wholeBucket = groups.find(
    (group) =>
      groups.length > 1 &&
      group.reasons.length === reasons.length &&
      group.reasons.every((reason) => reasons.includes(reason)),
  );
  const reasonValue =
    reasons.length === 0
      ? "Any reason"
      : (wholeBucket?.label ??
        (reasons.length === 1 ? reasonLabel(reasons[0]) : `${reasons.length} reasons`));

  return (
    <Panel
      title={title}
      description="Every credit added and spent, straight from the ledger. Nothing here is recalculated — each figure is what was charged at the time."
      bodyClassName="p-0"
    >
      {/*
        THE ARRANGING ROW: what a row is, and what order the rows come in.
        Nothing here removes a charge from the screen, which is the whole reason
        the sort control moved up here off the filter row.
      */}
      <div className="space-y-2 border-b border-divider px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 shrink-0 text-[11px] font-semibold tracking-wider text-faint uppercase">
            Group by
          </span>
          {DIMENSIONS.filter((dim) => platformWide || !dim.adminOnly).map((dim) => (
            <Chip
              key={dim.key}
              href={dimensionHref(basePath, query, keep, dimensions, dim.key)}
              active={dimensions.includes(dim.key)}
            >
              {dim.label}
            </Chip>
          ))}

          {/* Off on a phone, where the toggles plus the sort button already fill
              the row and this sentence is what would wrap it to a second line -
              the thing these two rows exist to avoid. Nothing is lost: the count
              line under the totals says "individual charges" the moment the
              toggles are all off, and the help note on the activity page says it
              in words. */}
          <span className="ml-1 hidden text-[11px] text-faint sm:inline">
            {rawEntries ? "every individual charge" : "turn all off for every charge"}
          </span>

          {/* Pushed to the far end rather than left beside the toggles, so the
              row reads as two controls with a gap between them instead of five
              chips in a queue. */}
          <span className="ml-auto shrink-0 pl-1.5">
            <FilterPill
              variant="sort"
              label="Sort"
              value={ordering.short}
              icon={<OrderingIcon size={13} className="shrink-0" />}
            >
              <div className="space-y-0.5">
                {SORT_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <SheetOption
                      key={option.key}
                      icon={<Icon size={15} className="shrink-0" />}
                      /* The order in force taps back to newest, which is the
                         order this list has when nobody has chosen one. Every
                         other control on this screen can be turned off from
                         inside its own sheet, and an order that could only ever
                         be swapped for another order was the odd one out. */
                      href={href(
                        basePath,
                        query,
                        { sort: option.key === sort ? undefined : option.key },
                        keep,
                      )}
                      active={sort === option.key}
                    >
                      {option.label}
                    </SheetOption>
                  );
                })}
              </div>

              {/* Said here rather than only in the count line, because this is
                  where somebody is choosing it. */}
              <p className="mt-2 border-t border-divider px-3 pt-2 text-[11px] leading-relaxed text-faint">
                Biggest first sorts by size, so a 5,000-credit purchase and a
                5,000-credit spend rank together.
              </p>
            </FilterPill>
          </span>
        </div>

        {/*
          One row, scrolling sideways rather than wrapping - the pattern the
          section tabs and the console's date bar already use. Four pills that
          each say what they are doing come to 555px, so on a 390px phone they
          would wrap to three lines, and three lines of controls is the thing
          this row was built to get rid of. What is off the edge is said twice:
          a pill off its default jumps to the front of the row, and the right
          edge fades so the row does not look finished when it is not.

          scrollbar-width:none needed an `!` here until globals.css was fixed.
          That file set `* { scrollbar-width: thin }` OUTSIDE any cascade layer,
          and unlayered CSS beats every layered rule whatever its specificity -
          so the utility was silently losing and this row kept a stray grey
          scrollbar under the pills. The rule lives in @layer base now, which
          fixes it for every horizontal strip in the app rather than just the
          ones somebody remembered to shout at. The webkit fallback is for the
          Safaris that predate scrollbar-width, and only those: Chrome ignores
          ::-webkit-scrollbar entirely once scrollbar-width is set to anything.

          min-w-0 on the wrapper is what actually keeps the page from scrolling
          sideways. A flex child defaults to min-width:auto, which means it
          refuses to shrink below its content - so an overflow-x-auto box inside
          a flex row is only a scroller once it is allowed to be narrower than
          the thing it is scrolling.
        */}
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <div className="-ml-4 overflow-x-auto pl-4 [scrollbar-width:none] sm:ml-0 sm:pl-0 [&::-webkit-scrollbar]:hidden">
              <div className="flex w-max min-w-full items-center gap-1.5 pr-6 sm:pr-1">
                {/*
                  A truck filter leads the row, ahead of the pills, and only
                  exists when one is set. It is the filter nobody chose from a
                  control - it arrives by tapping a grouped row - so it is the
                  one most likely to leave somebody staring at a three-row
                  ledger wondering where the rest went. First position is the
                  only one this row can guarantee is on screen without
                  scrolling, and order-first keeps it there even once an active
                  pill has jumped the queue behind it - among equal orders the
                  markup decides, and this is first in the markup.
                */}
                {query.truck ? (
                  <Pill
                    href={href(basePath, query, { truck: undefined }, keep)}
                    className="order-first"
                  >
                    {query.truck}
                  </Pill>
                ) : null}

                <FilterPill
                  label="Date range"
                  value={dateLabel}
                  active={ranged}
                  icon={<CalendarRange size={13} className="shrink-0" />}
                >
                  <div className="space-y-0.5">
                    {presets.map((option) => {
                      /* The window in force taps back off, which lands on the
                         rolling window - the first entry in this list and the
                         one the ledger falls back to. Without that, "Today"
                         could only ever be swapped for another window, and the
                         way out of a one-day view was the row's Clear, which
                         also throws away the reason and the truck. */
                      const on = preset?.key === option.key;
                      return (
                        <SheetOption
                          key={option.key}
                          href={href(
                            basePath,
                            query,
                            on
                              ? { from: undefined, to: undefined }
                              : { from: option.from ?? undefined, to: option.to ?? undefined },
                            keep,
                          )}
                          active={on}
                        >
                          {option.label}
                        </SheetOption>
                      );
                    })}
                  </div>

                  {/*
                    Two date boxes are the slowest way to say "last 30 days" and used
                    to be the only way, three rows tall, on every visit. They are
                    still here for the range no preset covers - open already when
                    that is the range in force, so a hand-typed window is never
                    hiding inside a fold that looks shut.
                  */}
                  <details className="group mt-2 border-t border-divider pt-2" open={ranged && !preset}>
                    <summary className="flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-lg px-3 text-sm text-ink transition hover:bg-sunken [&::-webkit-details-marker]:hidden">
                      <span className="flex-1">Custom range</span>
                      <ChevronDown
                        size={15}
                        aria-hidden
                        className="shrink-0 text-faint transition group-open:rotate-180"
                      />
                    </summary>

                    <form method="get" action={basePath} className="mt-2 space-y-2 px-3 pb-1">
                      {/* Everything else on the query string, carried through - a
                          change of dates must not quietly drop a reason filter. */}
                      {Object.entries({ ...keep, ...query }).map(([k, v]) =>
                        v && k !== "from" && k !== "to" && k !== "page" ? (
                          <input key={k} type="hidden" name={k} value={String(v)} />
                        ) : null,
                      )}
                      <label className="block text-xs text-muted">
                        From
                        <input
                          type="date"
                          name="from"
                          defaultValue={from ?? ""}
                          max={to ?? undefined}
                          className="field mt-1"
                        />
                      </label>
                      <label className="block text-xs text-muted">
                        To
                        <input
                          type="date"
                          name="to"
                          defaultValue={to ?? ""}
                          min={from ?? undefined}
                          className="field mt-1"
                        />
                      </label>
                      <FilterSubmitButton
                        icon={<Check size={14} />}
                        iconSize={14}
                        variant="primary"
                        size="md"
                        className="w-full"
                      >
                        Apply range
                      </FilterSubmitButton>
                    </form>
                  </details>
                </FilterPill>

                <FilterPill
                  label="Show"
                  value={KIND_LABEL[kind]}
                  active={kind !== "all"}
                  icon={<ArrowDownUp size={13} className="shrink-0" />}
                >
                  <div className="space-y-0.5">
                    {(Object.keys(KIND_LABEL) as LedgerKind[]).map((value) => {
                      /* Show in force taps back to everything, and every link
                         here carries the reason selection forward already
                         narrowed to what the new Show can produce - see
                         reasonsUnder. Both halves matter: without the first
                         there is no way back to "Everything" except the row's
                         Clear, and without the second a reader who had picked a
                         manual search and tapped "Credits added" would be shown
                         an empty ledger under a filter that cannot match. */
                      const next: LedgerKind = kind === value ? "all" : value;
                      return (
                        <SheetOption
                          key={value}
                          href={href(
                            basePath,
                            query,
                            {
                              kind: next === "all" ? undefined : next,
                              reason: reasonsUnder(next),
                            },
                            keep,
                          )}
                          active={kind === value}
                        >
                          {KIND_LABEL[value]}
                        </SheetOption>
                      );
                    })}
                  </div>
                </FilterPill>

                {/*
                  One option is not a choice, so the pill only appears where
                  there is something to choose between - unless a reason is
                  actually in force, in which case it appears whatever the
                  count, because a filter with no control to unset it is the one
                  state this row must never reach.
                */}
                {possible.size > 1 || reasons.length > 0 ? (
                  <FilterPill
                    label="Reason"
                    value={reasonValue}
                    active={reasons.length > 0}
                    icon={<Tag size={13} className="shrink-0" />}
                  >
                    <div className="space-y-0.5">
                      <SheetOption
                        href={href(basePath, query, { reason: undefined }, keep)}
                        active={reasons.length === 0}
                      >
                        Any reason
                      </SheetOption>

                      {groups.map((group) => {
                        /*
                         * Two tiers, and each tier only appears when it says
                         * something the other one does not.
                         *
                         * A bucket row is worth its height when there is more
                         * than one bucket on offer; with a single bucket - which
                         * is what "Credits used" is - selecting the whole of it
                         * is the same set as selecting nothing, so the row would
                         * be a second "Any reason" wearing a different word.
                         *
                         * The reasons inside a bucket appear when there is more
                         * than one of them. A bucket holding one reason already
                         * filters on exactly that reason, and this account's
                         * ledger really does have buckets like that - one plan
                         * grant, one top-up, one coupon - so the sheet would
                         * otherwise be six rows saying three things.
                         */
                        const asBucket = groups.length > 1;
                        const children = !asBucket || group.reasons.length > 1 ? group.reasons : [];
                        const whole = group.reasons.every((reason) => reasons.includes(reason));

                        return (
                          <div key={group.bucket} className="space-y-0.5">
                            {asBucket ? (
                              <SheetOption
                                href={href(
                                  basePath,
                                  query,
                                  { reason: reasonParam(toggleReasons(reasons, group.reasons)) },
                                  keep,
                                )}
                                active={whole}
                              >
                                {group.label}
                              </SheetOption>
                            ) : null}

                            {children.map((reason) => (
                              <SheetOption
                                key={reason}
                                nested={asBucket}
                                href={href(
                                  basePath,
                                  query,
                                  { reason: reasonParam(toggleReasons(reasons, [reason])) },
                                  keep,
                                )}
                                active={reasons.includes(reason)}
                              >
                                {reasonLabel(reason)}
                              </SheetOption>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  </FilterPill>
                ) : null}
              </div>
            </div>

            {/* The pills run wider than a phone, and the CSV button parked at
                the end of the row hides the fact: the pill that is cut off ends
                flush against the button, which reads as a pill behind a button
                rather than as a row with more in it. Fading the last few pixels
                into the panel is what says "there is more this way". A painted
                overlay rather than a mask on the scroller, because a mask makes
                a stacking context and this row has a position:fixed sheet
                hanging off every pill in it. */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-panel to-transparent sm:hidden"
            />
          </div>

          {/* The way out, pinned rather than left in the scroller. A filtered
              ledger can carry six things in that row, which put "Clear" three
              swipes off the right-hand edge - the one control somebody reaches
              for precisely when the list in front of them looks wrong. */}
          {narrowed ? (
            <Link
              href={href(
                basePath,
                query,
                {
                  from: undefined,
                  to: undefined,
                  kind: undefined,
                  reason: undefined,
                  truck: undefined,
                },
                keep,
              )}
              className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-xs font-medium text-muted transition hover:bg-sunken hover:text-ink"
            >
              <X size={13} className="shrink-0" />
              Clear
            </Link>
          ) : null}

          {/* Pinned outside the scroller rather than left to be scrolled to.
              The export is this exact view as a file, so it belongs with the
              filters that decided it - but it is also the one control here that
              is useless if it cannot be found, and the panel header gave it a
              whole row of its own on a phone to say so. */}
          <a href={csvHref} className={buttonClass("secondary", "sm", "shrink-0")} download>
            <Download size={13} />
            CSV
          </a>
        </div>
      </div>

      {rawEntries ? (
        <EntryList
          basePath={basePath}
          query={query}
          keep={keep}
          filters={filters}
          sort={sort}
          page={page}
          nameOf={nameOf}
          platformWide={platformWide}
        />
      ) : (
        <RollupList
          basePath={basePath}
          query={query}
          keep={keep}
          filters={filters}
          dimensions={dimensions}
          sort={sort}
          page={page}
          nameOf={nameOf}
        />
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* shared query shape                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The rollup rows behind whatever grouping is asked for.
 *
 * Read at credit_ledger_daily's own grain - account, day, reason, truck - and
 * folded here. A coarser grouping is a sum of finer rows, so a second database
 * aggregate would only be another thing that could disagree with the ledger.
 *
 * The error comes back with the rows rather than being dropped: a read that
 * failed and a ledger with nothing in it are not the same thing, and this
 * screen is where somebody checks what they were charged.
 */
async function loadRollups(
  filters: LedgerFilters,
): Promise<{ rows: RollupRow[]; error: string | null }> {
  let request = getSupabaseAdmin()
    .from("credit_ledger_daily")
    .select("user_id,ist_date,reason,truck_number,entries,credits,last_at,balance_after")
    .gte("last_at", filters.since)
    .order("last_at", { ascending: false })
    .limit(FOLD_CAP);

  if (filters.userId) request = request.eq("user_id", filters.userId);
  if (filters.until) request = request.lt("last_at", filters.until);
  if (filters.reasons.length > 0) request = request.in("reason", filters.reasons);
  if (filters.truck) request = request.eq("truck_number", filters.truck);
  if (filters.kind === "used") request = request.lt("credits", 0);
  if (filters.kind === "added") request = request.gt("credits", 0);

  const { data, error } = await request;
  return { rows: (data ?? []) as RollupRow[], error: error?.message ?? null };
}

/**
 * A failed read, said out loud.
 *
 * Both lists used to keep only the data and throw the error away, which turned
 * "the query never ran" into "you have never been charged for anything" - the
 * one answer a ledger must never give by accident.
 */
function LoadFailed({ message }: { message: string }) {
  return (
    <EmptyState
      title="Could not read the ledger"
      description={`${message}. Nothing has been lost — this is the screen failing to read the ledger, not the ledger being empty.`}
    />
  );
}

/** Added, spent and charge count across everything the filters match. */
function totalsOf(rows: { credits: number; entries: number }[]): {
  added: number;
  spent: number;
  entries: number;
} {
  return rows.reduce(
    (acc, row) => {
      const credits = Number(row.credits) || 0;
      if (credits < 0) acc.spent += Math.abs(credits);
      else acc.added += credits;
      acc.entries += Number(row.entries) || 0;
      return acc;
    },
    { added: 0, spent: 0, entries: 0 },
  );
}

/**
 * The figures for the whole filtered set, above the page of rows.
 *
 * Always shown rather than only with a date range: "used 412 over 90 charges"
 * is the answer somebody wants whether or not they narrowed the dates, and a
 * total that appears and disappears with a filter reads as a different total.
 */
function Totals({
  added,
  spent,
  entries,
  scope,
}: {
  added: number;
  spent: number;
  entries: number;
  scope: string;
}) {
  return (
    <div className="border-b border-divider bg-raised/40">
      <dl className="grid grid-cols-3 divide-x divide-divider">
        {[
          { label: "Credits added", value: formatCredits(added), tone: "text-good-500" },
          { label: "Credits used", value: formatCredits(spent), tone: "text-ink" },
          { label: "Charges", value: entries.toLocaleString("en-IN"), tone: "text-ink" },
        ].map(({ label, value, tone }) => (
          <div key={label} className="px-4 py-2.5">
            <dt className="text-[10px] font-semibold tracking-wider text-faint uppercase">
              {label}
            </dt>
            <dd className={cx("mt-0.5 text-sm font-semibold tabular-nums", tone)}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-divider px-4 py-1.5 text-[11px] text-faint">{scope}</p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* grouped rows                                                                */
/* -------------------------------------------------------------------------- */

async function RollupList({
  basePath,
  query,
  keep,
  filters,
  dimensions,
  sort,
  page,
  nameOf,
}: {
  basePath: string;
  query: LedgerQuery;
  keep: Record<string, string>;
  filters: LedgerFilters;
  dimensions: LedgerDimension[];
  sort: LedgerSort;
  page: number;
  nameOf: Map<string, string>;
}) {
  const { rows, error } = await loadRollups(filters);
  if (error) return <LoadFailed message={error} />;

  const totals = totalsOf(rows);

  /*
   * Fold onto whichever dimensions are on. A dimension that is off becomes null
   * on the key, so "truck off" genuinely merges every truck rather than
   * silently keeping the first one's number.
   *
   * With day and truck both on - the default - the key is (day, truck) and
   * nothing else, so a day on which five trucks were checked folds to five
   * rows: one per truck, each holding every charge that truck took that day,
   * whatever the reason. The rollup's own grain is finer than that (account,
   * day, reason, source, truck), which is why the reasons have to be summed
   * here rather than read off a row.
   */
  const folded = new Map<string, Folded>();
  for (const row of rows) {
    const date = dimensions.includes("day") ? row.ist_date : null;
    const truck = dimensions.includes("truck") ? row.truck_number : null;
    const user = dimensions.includes("user") ? row.user_id : null;
    const key = `${date ?? ""}|${truck ?? ""}|${user ?? ""}`;

    const existing = folded.get(key);
    if (!existing) {
      folded.set(key, {
        key,
        ist_date: date,
        truck_number: truck,
        user_id: user,
        entries: Number(row.entries) || 0,
        credits: Number(row.credits) || 0,
        last_at: row.last_at,
        balance_after: row.balance_after,
      });
      continue;
    }
    existing.entries += Number(row.entries) || 0;
    existing.credits += Number(row.credits) || 0;
    if (row.last_at > existing.last_at) {
      existing.last_at = row.last_at;
      existing.balance_after = row.balance_after;
    }
  }

  /*
   * Newest and oldest sort on the last charge in the group, which is what makes
   * the default view day-driven without a second sort key: every group of one
   * IST day has its last charge inside that day, and IST days do not overlap,
   * so the five trucks of Tuesday are contiguous and sit as a block above the
   * four of Monday. Biggest first deliberately breaks that - it is asked for
   * when the question is "what cost the most", and answering it inside each day
   * would be a different question.
   */
  const list = [...folded.values()].sort((a, b) => {
    if (sort === "largest") return Math.abs(b.credits) - Math.abs(a.credits);
    if (sort === "oldest") return a.last_at.localeCompare(b.last_at);
    return b.last_at.localeCompare(a.last_at);
  });

  const pageCount = Math.max(Math.ceil(list.length / ROLLUP_PAGE), 1);
  const current = Math.min(page, pageCount);
  const shown = list.slice((current - 1) * ROLLUP_PAGE, current * ROLLUP_PAGE);

  const grouping = dimensions
    .map((d) => DIMENSIONS.find((x) => x.key === d)!.label.toLowerCase())
    .join(" and ");
  /* A cap that bit is said out loud. A truncated total reads as an exact one. */
  const capped =
    rows.length >= FOLD_CAP
      ? ` — capped at the ${FOLD_CAP.toLocaleString("en-IN")} most recent rows, so narrow the dates for an exact total`
      : "";
  const scope = `${list.length.toLocaleString("en-IN")} group${list.length === 1 ? "" : "s"}, by ${grouping}${capped}`;

  /* Once per list rather than once per row: istToday reads the clock, and the
     year is the same for every row on the page. */
  const thisYear = istToday().slice(0, 4);

  if (shown.length === 0) {
    return (
      <EmptyState
        title="Nothing here"
        description="No credit movements match those filters. Widen the dates or clear a filter above."
      />
    );
  }

  return (
    <>
      <Totals added={totals.added} spent={totals.spent} entries={totals.entries} scope={scope} />

      <ul className="divide-y divide-divider">
        {shown.map((row) => {
          const spent = row.credits < 0;

          /* Drilling in narrows by whatever this row actually is and switches to
             the raw ledger, which is where "why is this number this" is
             answered. A dimension that is off contributes no filter, because the
             row does not represent one value of it. */
          const drill = href(
            basePath,
            query,
            {
              by: "none",
              from: row.ist_date ?? query.from,
              to: row.ist_date ?? query.to,
              truck: row.truck_number ?? query.truck,
            },
            keep,
          );

          /* The day leads, because with day and truck both on the row IS a day
             and the truck is what that day is broken down by - reading "12 Aug
             · GJ27TD6880" down a column groups by eye the way the fold groups
             by key. Spelt "12 Aug" rather than 2026-08-12 for the same reason
             the date pill is: the year is only worth its width when it is not
             this one. */
          const heading = [
            row.ist_date ? (
              <span key="d">{dayMonth(row.ist_date, row.ist_date.slice(0, 4) !== thisYear)}</span>
            ) : null,
            row.truck_number ? <Mono key="t">{row.truck_number}</Mono> : null,
            row.user_id ? (
              <span key="u">{nameOf.get(row.user_id) ?? "Unknown account"}</span>
            ) : null,
          ].filter(Boolean);

          return (
            <li key={row.key}>
              <Link
                href={drill}
                className="flex items-center gap-3 px-4 py-3 transition hover:bg-sunken"
              >
                <span
                  className={cx(
                    "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border",
                    spent
                      ? "border-line bg-raised text-muted"
                      : "border-good-500/30 bg-good-500/12 text-good-500",
                  )}
                >
                  {spent ? <Minus size={15} /> : <Plus size={15} />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2 text-sm font-medium text-ink">
                    {heading.length > 0 ? heading : <span>Everything</span>}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-faint">
                    {row.entries} {row.entries === 1 ? "charge" : "charges"} · balance{" "}
                    {formatCredits(row.balance_after)}
                  </span>
                </span>

                <span className="shrink-0 text-right">
                  <span
                    className={cx(
                      "block text-sm font-semibold tabular-nums",
                      spent ? "text-ink" : "text-good-500",
                    )}
                  >
                    {spent ? "−" : "+"}
                    {formatCredits(Math.abs(row.credits))}
                  </span>
                  <span className="text-[10px] text-faint">credits</span>
                </span>

                <ChevronRight size={15} className="shrink-0 text-faint" />
              </Link>
            </li>
          );
        })}
      </ul>

      <Pager
        basePath={basePath}
        query={query}
        keep={keep}
        page={current}
        pageCount={pageCount}
        total={list.length}
        noun="groups"
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* every charge                                                                */
/* -------------------------------------------------------------------------- */

async function EntryList({
  basePath,
  query,
  keep,
  filters,
  sort,
  page,
  nameOf,
  platformWide,
}: {
  basePath: string;
  query: LedgerQuery;
  keep: Record<string, string>;
  filters: LedgerFilters;
  sort: LedgerSort;
  page: number;
  nameOf: Map<string, string>;
  platformWide: boolean;
}) {
  /* Built by a function because it is run twice - once to count what matches,
     once for the rows - and both have to see exactly the same filters. */
  const build = (head: boolean) => {
    let request = getSupabaseAdmin()
      .from("credit_transactions")
      .select("id,created_at,user_id,reason,delta,balance_after,truck_number,note", {
        count: "exact",
        head,
      })
      .gte("created_at", filters.since);

    if (filters.userId) request = request.eq("user_id", filters.userId);
    if (filters.until) request = request.lt("created_at", filters.until);
    if (filters.reasons.length > 0) request = request.in("reason", filters.reasons);
    if (filters.truck) request = request.eq("truck_number", filters.truck);
    if (filters.kind === "used") request = request.lt("delta", 0);
    if (filters.kind === "added") request = request.gt("delta", 0);

    return request;
  };

  /* The totals describe the whole filtered set, not this page, so they come
     from the rollup - which already has every matching row summed. */
  const rollups = await loadRollups(filters);
  if (rollups.error) return <LoadFailed message={rollups.error} />;

  let rows: EntryRow[];
  let total: number;
  let current: number;
  let capped = false;

  if (sort === "largest") {
    /*
     * Biggest means biggest by SIZE, and a 5,000-credit purchase and a
     * 5,000-credit spend are the same size. This used to order by delta itself,
     * which with "Credits added" on - every delta positive - listed a 1-credit
     * bonus above a 5,000-credit purchase, the exact opposite of what was
     * asked for.
     *
     * Postgres would answer it with abs(delta), but PostgREST cannot order by
     * an expression, so the charges are read once and sorted here, the same way
     * the grouped view has always done it. Capped like the rollups are, and the
     * count line says so when the cap bites.
     */
    const { data, error } = await build(false)
      .order("created_at", { ascending: false })
      .limit(FOLD_CAP);
    if (error) return <LoadFailed message={error.message} />;

    const scanned = (data ?? []) as EntryRow[];
    capped = scanned.length >= FOLD_CAP;
    scanned.sort((a, b) => Math.abs(Number(b.delta)) - Math.abs(Number(a.delta)));

    total = scanned.length;
    current = Math.min(page, Math.max(Math.ceil(total / ENTRY_PAGE), 1));
    rows = scanned.slice((current - 1) * ENTRY_PAGE, current * ENTRY_PAGE);
  } else {
    // Counted before the page is fetched: PostgREST answers a range that starts
    // past the last charge with an error and no rows at all, so a stale link to
    // page 9 read as "you have no charges" instead of "that page has gone".
    const { count, error: countError } = await build(true);
    if (countError) return <LoadFailed message={countError.message} />;

    total = count ?? 0;
    current = Math.min(page, Math.max(Math.ceil(total / ENTRY_PAGE), 1));
    const from = (current - 1) * ENTRY_PAGE;

    const { data, error } = await build(false)
      .order("created_at", { ascending: sort === "oldest" })
      .range(from, from + ENTRY_PAGE - 1);
    if (error) return <LoadFailed message={error.message} />;

    rows = (data ?? []) as EntryRow[];
  }

  const pageCount = Math.max(Math.ceil(total / ENTRY_PAGE), 1);
  const totals = totalsOf(rollups.rows);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing here"
        description="No individual charges match those filters. Widen the dates or clear a filter above."
      />
    );
  }

  return (
    <>
      <Totals
        added={totals.added}
        spent={totals.spent}
        entries={totals.entries}
        scope={`${total.toLocaleString("en-IN")} individual charge${total === 1 ? "" : "s"}${
          capped
            ? ` — the ${FOLD_CAP.toLocaleString("en-IN")} most recent, sorted by size, so narrow the dates for the whole ledger`
            : ""
        }`}
      />

      <ul className="divide-y divide-divider">
        {rows.map((row) => {
          const spent = Number(row.delta) < 0;
          return (
            <li key={row.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-xs font-medium text-ink">{reasonLabel(row.reason)}</span>
                  {row.truck_number ? (
                    <Mono className="text-[11px] text-muted">{row.truck_number}</Mono>
                  ) : null}
                  {platformWide ? (
                    <span className="text-[11px] text-muted">
                      {nameOf.get(row.user_id) ?? "Unknown account"}
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[11px] text-faint">
                  {fmtDateTime(row.created_at)}
                  {row.note ? ` · ${row.note}` : ""}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span
                  className={cx(
                    "block text-xs font-semibold tabular-nums",
                    spent ? "text-ink" : "text-good-500",
                  )}
                >
                  {spent ? "−" : "+"}
                  {formatCredits(Math.abs(Number(row.delta)))}
                </span>
                <span className="text-[10px] text-faint tabular-nums">
                  → {formatCredits(row.balance_after)}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <Pager
        basePath={basePath}
        query={query}
        keep={keep}
        page={current}
        pageCount={pageCount}
        total={total}
        noun="charges"
      />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* small pieces                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One choice inside a filter pill's sheet.
 *
 * A full-width row at min-h-10 rather than another chip: a sheet is where
 * somebody is deliberately choosing, and a list of thumb-sized rows is easier
 * to hit on a phone than a wrapped grid of small pills - which is what the old
 * chip rows were. Server-rendered, so these stay plain links and the filter
 * stays in the URL.
 *
 * Indented rather than smaller for a reason inside a bucket. The two tiers are
 * equally tappable and equally worth hitting, so making the inner one look
 * like a caption would be a lie about the target it has - and the indent alone
 * is enough to say which reasons belong to which heading.
 */
function SheetOption({
  href: to,
  active,
  icon,
  nested,
  children,
}: {
  href: string;
  active: boolean;
  icon?: React.ReactNode;
  /** One tier in: a reason listed under its source bucket. */
  nested?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={to}
      aria-current={active ? "true" : undefined}
      className={cx(
        "flex min-h-10 items-center gap-2 rounded-lg pr-3 text-sm transition",
        nested ? "pl-8" : "pl-3",
        active ? "bg-brand-500/10 font-medium text-brand-500" : "text-ink hover:bg-sunken",
      )}
    >
      {icon}
      <span className="min-w-0 flex-1">{children}</span>
      {active ? <Check size={15} className="shrink-0" /> : null}
    </Link>
  );
}

function Chip({
  href: to,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={to}
      className={cx(
        "inline-flex min-h-8 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition",
        active
          ? "border-brand-500 bg-brand-500/10 text-brand-500"
          : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

/** A filter in force, carrying its own way out. */
function Pill({
  href: to,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={to}
      className={cx(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/8 px-2.5 text-xs font-medium whitespace-nowrap text-brand-500 transition hover:bg-brand-500/16",
        className,
      )}
    >
      {children}
      <X size={11} className="shrink-0 opacity-70" />
    </Link>
  );
}

function Pager({
  basePath,
  query,
  keep,
  page,
  pageCount,
  total,
  noun,
}: {
  basePath: string;
  query: LedgerQuery;
  keep: Record<string, string>;
  page: number;
  pageCount: number;
  total: number;
  noun: string;
}) {
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 border-t border-divider px-4 py-3">
      {page > 1 ? (
        <Link
          href={href(basePath, query, { page: String(page - 1) }, keep)}
          className={buttonClass("secondary", "sm")}
        >
          Previous
        </Link>
      ) : (
        <span />
      )}
      <span className="text-[11px] text-faint tabular-nums">
        Page {page} of {pageCount} · {total.toLocaleString("en-IN")} {noun}
      </span>
      {page < pageCount ? (
        <Link
          href={href(basePath, query, { page: String(page + 1) }, keep)}
          className={buttonClass("secondary", "sm")}
        >
          Next
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}

/**
 * The headline figures above the ledger: today, this month, and the balance.
 *
 * Read from the same view the list is, so the total and the rows it sits above
 * can never tell different stories.
 */
export async function CreditSummary({ userId, balance }: { userId: string; balance: number }) {
  const { data } = await getSupabaseAdmin()
    .from("credit_ledger_daily")
    .select("ist_date,credits")
    .eq("user_id", userId)
    .lt("credits", 0)
    .gte("last_at", new Date(Date.now() - 31 * 86_400_000).toISOString());

  const rows = (data ?? []) as { ist_date: string; credits: number }[];
  // IST today, as the view spells it, so "today" means the same on both sides.
  const today = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

  const spentToday = rows
    .filter((r) => r.ist_date === today)
    .reduce((sum, r) => sum + Math.abs(Number(r.credits)), 0);
  const spentMonth = rows.reduce((sum, r) => sum + Math.abs(Number(r.credits)), 0);

  const tiles = [
    { key: "balance", icon: Coins, label: "Credits left", value: balance },
    { key: "today", icon: Minus, label: "Used today", value: spentToday },
    { key: "month", icon: Minus, label: "Used in 31 days", value: spentMonth },
  ];

  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {tiles.map(({ key, icon: Icon, label, value }) => (
        <div key={key} className="rounded-xl border border-line bg-panel px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted uppercase sm:text-[11px]">
            <Icon size={11} className="shrink-0" />
            <span className="truncate">{label}</span>
          </span>
          <span className="mt-1 block text-lg font-semibold tabular-nums text-strong sm:text-xl">
            {formatCredits(value)}
          </span>
        </div>
      ))}
    </div>
  );
}
