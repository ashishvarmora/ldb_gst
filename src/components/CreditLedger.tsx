import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  Coins,
  Download,
  Minus,
  Plus,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { EmptyState, Mono, Panel, buttonClass, cx } from "@/components/ui";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { fmtDateTime } from "@/lib/format";
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
 * The filter bar is two rows deep rather than five. Group-by and the date range
 * are what people reach for; show, reason and order sit behind a native
 * <details> so they cost no JavaScript and no height until wanted. Anything in
 * force is echoed as a pill that clears only itself, so a folded control can
 * never leave a filter quietly applied.
 *
 * State lives in the URL. No JavaScript, every view is linkable, the back button
 * works, and the CSV export is the same query string with a different path.
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

const SORT_LABEL: Record<LedgerSort, string> = {
  newest: "Newest first",
  oldest: "Oldest first",
  largest: "Biggest first",
};

const KIND_LABEL: Record<LedgerKind, string> = {
  all: "Everything",
  used: "Credits used",
  added: "Credits added",
};

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

/** A reason label a customer should read, never the raw column value. */
function reasonLabel(reason: string): string {
  return CREDIT_REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

type LedgerFilters = {
  userId: string | null;
  since: string;
  until: string | null;
  kind: LedgerKind;
  reason?: string;
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

  /* Which reasons this ledger actually contains, so the filter offers what is
     there rather than a fixed list of mostly-empty options. */
  let reasonQuery = admin.from("credit_ledger_daily").select("reason").gte("last_at", since);
  if (userId) reasonQuery = reasonQuery.eq("user_id", userId);
  const { data: reasonRows } = await reasonQuery;
  const reasons = [
    ...new Set(((reasonRows ?? []) as { reason: string }[]).map((r) => r.reason)),
  ].sort((a, b) => reasonLabel(a).localeCompare(reasonLabel(b)));

  const filters: LedgerFilters = {
    userId,
    since,
    until,
    kind,
    reason: query.reason,
    truck: query.truck,
  };

  /* The export is this view, as a file. Same query string, different path, so
     what downloads is exactly what is on screen rather than a second reading
     of the filters. */
  const csvHref = href("/api/export/credits", query, {}, userId ? { user: userId } : {});

  return (
    <Panel
      title={title}
      description="Every credit added and spent, straight from the ledger. Nothing here is recalculated — each figure is what was charged at the time."
      bodyClassName="p-0"
      actions={
        <a href={csvHref} className={buttonClass("secondary", "sm")} download>
          <Download size={13} />
          CSV
        </a>
      }
    >
      <div className="space-y-3 border-b border-divider px-4 py-3">
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
          <span className="ml-1 text-[11px] text-faint">
            {rawEntries ? "every individual charge" : "turn all off for every charge"}
          </span>
        </div>

        <form method="get" action={basePath} className="flex flex-wrap items-end gap-2">
          {Object.entries({ ...keep, ...query }).map(([k, v]) =>
            v && k !== "from" && k !== "to" && k !== "page" ? (
              <input key={k} type="hidden" name={k} value={String(v)} />
            ) : null,
          )}
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wider text-faint uppercase">
              From
            </span>
            <input
              type="date"
              name="from"
              defaultValue={from ?? ""}
              className="field w-auto py-1.5 text-xs"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-semibold tracking-wider text-faint uppercase">
              To
            </span>
            <input
              type="date"
              name="to"
              defaultValue={to ?? ""}
              className="field w-auto py-1.5 text-xs"
            />
          </label>
          <button type="submit" className={buttonClass("secondary", "sm")}>
            Apply
          </button>
          {ranged ? (
            <Link
              href={href(basePath, query, { from: undefined, to: undefined }, keep)}
              className="inline-flex min-h-9 items-center gap-1 rounded-lg px-1.5 text-[11px] font-medium text-muted transition hover:text-ink"
            >
              <ArrowLeft size={12} />
              Last 60 days
            </Link>
          ) : null}
        </form>

        {/* Native <details>, so the fold costs no JavaScript and the three
            controls behind it cost no height until somebody wants them. */}
        <details className="group">
          <summary className="inline-flex min-h-8 cursor-pointer list-none items-center gap-1.5 rounded-lg text-xs font-medium text-muted transition hover:text-ink">
            <SlidersHorizontal size={13} />
            More filters
            <ChevronRight size={13} className="transition group-open:rotate-90" />
          </summary>

          <div className="mt-3 space-y-3 border-t border-divider pt-3">
            <ChipRow label="Show">
              {(Object.keys(KIND_LABEL) as LedgerKind[]).map((value) => (
                <Chip
                  key={value}
                  href={href(basePath, query, { kind: value }, keep)}
                  active={kind === value}
                >
                  {KIND_LABEL[value]}
                </Chip>
              ))}
            </ChipRow>

            {reasons.length > 1 ? (
              <ChipRow label="Reason">
                <Chip
                  href={href(basePath, query, { reason: undefined }, keep)}
                  active={!query.reason}
                >
                  Any
                </Chip>
                {reasons.map((value) => (
                  <Chip
                    key={value}
                    href={href(basePath, query, { reason: value }, keep)}
                    active={query.reason === value}
                  >
                    {reasonLabel(value)}
                  </Chip>
                ))}
              </ChipRow>
            ) : null}

            <ChipRow label="Order">
              {(Object.keys(SORT_LABEL) as LedgerSort[]).map((value) => (
                <Chip
                  key={value}
                  href={href(basePath, query, { sort: value }, keep)}
                  active={sort === value}
                >
                  {SORT_LABEL[value]}
                </Chip>
              ))}
            </ChipRow>
          </div>
        </details>

        {/* Anything in force, echoed - so a folded control cannot leave a filter
            quietly applied. Each pill clears only itself. */}
        {query.truck || query.reason || kind !== "all" || ranged ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-divider pt-3">
            <span className="mr-0.5 shrink-0 text-[11px] font-semibold tracking-wider text-faint uppercase">
              Filtered
            </span>
            {ranged ? (
              <Pill href={href(basePath, query, { from: undefined, to: undefined }, keep)}>
                {from ?? "start"} → {to ?? "today"}
              </Pill>
            ) : null}
            {query.truck ? (
              <Pill href={href(basePath, query, { truck: undefined }, keep)}>{query.truck}</Pill>
            ) : null}
            {query.reason ? (
              <Pill href={href(basePath, query, { reason: undefined }, keep)}>
                {reasonLabel(query.reason)}
              </Pill>
            ) : null}
            {kind !== "all" ? (
              <Pill href={href(basePath, query, { kind: undefined }, keep)}>
                {KIND_LABEL[kind]}
              </Pill>
            ) : null}
          </div>
        ) : null}
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
  if (filters.reason) request = request.eq("reason", filters.reason);
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

  /* Fold onto whichever dimensions are on. A dimension that is off becomes null
     on the key, so "truck off" genuinely merges every truck rather than
     silently keeping the first one's number. */
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

          const heading = [
            row.truck_number ? <Mono key="t">{row.truck_number}</Mono> : null,
            row.ist_date ? <span key="d">{row.ist_date}</span> : null,
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
    if (filters.reason) request = request.eq("reason", filters.reason);
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

function ChipRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 shrink-0 text-[11px] font-semibold tracking-wider text-faint uppercase">
        {label}
      </span>
      {children}
    </div>
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
function Pill({ href: to, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={to}
      className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/8 px-2.5 text-xs font-medium whitespace-nowrap text-brand-500 transition hover:bg-brand-500/16"
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
