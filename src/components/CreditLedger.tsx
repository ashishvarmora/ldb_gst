import Link from "next/link";
import { ArrowLeft, ChevronRight, Coins, Minus, Plus, Truck } from "lucide-react";

import { EmptyState, Mono, Panel, buttonClass, cx } from "@/components/ui";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { fmtDateTime } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Where the credits went. One component, mounted twice.
 *
 * The officer's own page and the admin's per-customer tab render this same
 * file, differing only in whose id is passed and where the filter links point.
 * They used to be two implementations over two different views, which is how
 * the two screens ended up disagreeing about the same day.
 *
 * Everything is read from credit_ledger_daily and credit_transactions, and
 * NOTHING here computes a cost. The charge was decided once, by spend_credits()
 * at the moment it happened, and is stored. This screen only ever adds up what
 * is already on the ledger - so what a customer is shown cannot drift from what
 * they were actually charged, even if an admin changes a rate tomorrow.
 *
 * Three levels, because three different questions get asked:
 *
 *   per truck per day   the default, and the question people actually have:
 *                       which lorry is eating the balance?
 *   per day             the shape of the bill - was yesterday normal?
 *   every charge        the audit trail. Deliberately unaggregated and
 *                       deliberately long; it is what a disputed bill is
 *                       settled against.
 *
 * State lives in the URL, not in a client component. It costs no JavaScript,
 * every view is linkable, and the back button works - which on an audit screen
 * matters more than a smooth transition.
 */

export type LedgerView = "truck-day" | "day" | "entries";
export type LedgerKind = "all" | "used" | "added";

export type LedgerQuery = {
  view?: string;
  kind?: string;
  reason?: string;
  truck?: string;
  date?: string;
  page?: string;
};

/** How many days back the rollups look. Long enough for a monthly bill. */
const WINDOW_DAYS = 60;
const ROLLUP_PAGE = 30;
const ENTRY_PAGE = 50;

const VIEW_LABEL: Record<LedgerView, string> = {
  "truck-day": "Per truck, per day",
  day: "Per day",
  entries: "Every charge",
};

function parseView(raw: string | undefined): LedgerView {
  return raw === "day" || raw === "entries" ? raw : "truck-day";
}

function parseKind(raw: string | undefined): LedgerKind {
  return raw === "used" || raw === "added" ? raw : "all";
}

/** A reason label a customer should read, never the raw column value. */
function reasonLabel(reason: string): string {
  return CREDIT_REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

type RollupRow = {
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
  reason: string;
  delta: number;
  balance_after: number;
  truck_number: string | null;
  note: string | null;
};

/**
 * Same query string, one key changed. Keeps every chip a plain link.
 *
 * `keep` is for params that belong to the page rather than the ledger - the
 * admin console carries tab=credits, and dropping it would send a chip click
 * back to the first tab.
 */
function href(
  basePath: string,
  query: LedgerQuery,
  patch: Partial<LedgerQuery>,
  keep: Record<string, string> = {},
): string {
  const merged = { ...keep, ...query, ...patch };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    // page is dropped on any filter change: staying on page 4 of a list that
    // just became six rows long shows an empty screen.
    if (key === "page" && patch.page === undefined) continue;
    if (value) params.set(key, value);
  }
  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

export async function CreditLedger({
  userId,
  basePath,
  query,
  keep = {},
  title = "Credit history",
}: {
  userId: string;
  /** Where the chips link. The admin mounts this under its own route. */
  basePath: string;
  query: LedgerQuery;
  /** Page-level params every link must carry through, e.g. the admin's tab. */
  keep?: Record<string, string>;
  title?: string;
}) {
  const admin = getSupabaseAdmin();
  const view = parseView(query.view);
  const kind = parseKind(query.kind);
  const page = Math.max(Number(query.page) || 1, 1);

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

  /* Which reasons exist for this account, so the filter offers only what is
     actually there rather than a fixed list of mostly-empty options. */
  const { data: reasonRows } = await admin
    .from("credit_ledger_daily")
    .select("reason")
    .eq("user_id", userId);

  const reasons = [...new Set(((reasonRows ?? []) as { reason: string }[]).map((r) => r.reason))]
    .sort((a, b) => reasonLabel(a).localeCompare(reasonLabel(b)));

  return (
    <div className="space-y-3">
      <Panel
        title={title}
        description="Every credit added and spent, straight from the ledger. Nothing here is recalculated — each figure is what was charged at the time."
        bodyClassName="p-0"
      >
        {/* ------------------------------- controls ------------------------ */}
        <div className="space-y-3 border-b border-divider px-4 py-3">
          <ChipRow label="Group by">
            {(Object.keys(VIEW_LABEL) as LedgerView[]).map((value) => (
              <Chip
                key={value}
                href={href(basePath, query, { view: value, date: undefined, truck: undefined }, keep)}
                active={view === value}
              >
                {VIEW_LABEL[value]}
              </Chip>
            ))}
          </ChipRow>

          <ChipRow label="Show">
            {(["all", "used", "added"] as LedgerKind[]).map((value) => (
              <Chip key={value} href={href(basePath, query, { kind: value }, keep)} active={kind === value}>
                {value === "all" ? "Everything" : value === "used" ? "Credits used" : "Credits added"}
              </Chip>
            ))}
          </ChipRow>

          {reasons.length > 1 ? (
            <ChipRow label="Reason">
              <Chip href={href(basePath, query, { reason: undefined }, keep)} active={!query.reason}>
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

          {/* A drill-down is a filter, so it is shown and cleared like one. */}
          {query.truck || query.date ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-divider pt-3">
              <span className="text-[11px] font-semibold tracking-wider text-faint uppercase">
                Showing
              </span>
              {query.truck ? <Mono className="text-xs">{query.truck}</Mono> : null}
              {query.date ? <span className="text-xs text-ink">{query.date}</span> : null}
              <Link
                href={href(basePath, query, { truck: undefined, date: undefined }, keep)}
                className="ml-auto inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-[11px] font-medium text-muted transition hover:text-ink"
              >
                <ArrowLeft size={12} />
                Clear
              </Link>
            </div>
          ) : null}
        </div>

        {view === "entries" ? (
          <EntryList
            userId={userId}
            basePath={basePath}
            query={query}
            keep={keep}
            kind={kind}
            page={page}
            since={since}
          />
        ) : (
          <RollupList
            userId={userId}
            basePath={basePath}
            query={query}
            keep={keep}
            view={view}
            kind={kind}
            page={page}
            since={since}
          />
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* rollups                                                                     */
/* -------------------------------------------------------------------------- */

async function RollupList({
  userId,
  basePath,
  query,
  keep,
  view,
  kind,
  page,
  since,
}: {
  userId: string;
  basePath: string;
  query: LedgerQuery;
  keep: Record<string, string>;
  view: Exclude<LedgerView, "entries">;
  kind: LedgerKind;
  page: number;
  since: string;
}) {
  let request = getSupabaseAdmin()
    .from("credit_ledger_daily")
    .select("ist_date,reason,truck_number,entries,credits,last_at,balance_after")
    .eq("user_id", userId)
    .gte("last_at", since)
    .order("ist_date", { ascending: false })
    .order("credits", { ascending: true });

  if (query.reason) request = request.eq("reason", query.reason);
  if (query.truck) request = request.eq("truck_number", query.truck);
  if (query.date) request = request.eq("ist_date", query.date);
  if (kind === "used") request = request.lt("credits", 0);
  if (kind === "added") request = request.gt("credits", 0);

  const { data } = await request;
  const rows = (data ?? []) as RollupRow[];

  /*
   * Per day is the per-truck-per-day rows summed. Done here rather than in a
   * second database view on purpose: another aggregate is another thing that
   * can disagree with the ledger, and the row count over a 60-day window is
   * small enough that folding it in memory costs nothing.
   */
  const grouped =
    view === "day"
      ? Object.values(
          rows.reduce<Record<string, RollupRow>>((acc, row) => {
            const existing = acc[row.ist_date];
            if (!existing) {
              acc[row.ist_date] = { ...row, truck_number: null };
              return acc;
            }
            existing.entries += row.entries;
            existing.credits = Number(existing.credits) + Number(row.credits);
            if (row.last_at > existing.last_at) {
              existing.last_at = row.last_at;
              existing.balance_after = row.balance_after;
            }
            return acc;
          }, {}),
        ).sort((a, b) => b.ist_date.localeCompare(a.ist_date))
      : rows;

  const pageCount = Math.max(Math.ceil(grouped.length / ROLLUP_PAGE), 1);
  const current = Math.min(page, pageCount);
  const shown = grouped.slice((current - 1) * ROLLUP_PAGE, current * ROLLUP_PAGE);

  if (shown.length === 0) {
    return (
      <EmptyState
        title="Nothing here"
        description="No credit movements match that filter in the last 60 days."
      />
    );
  }

  return (
    <>
      <ul className="divide-y divide-divider">
        {shown.map((row) => {
          const spent = Number(row.credits) < 0;
          const magnitude = Math.abs(Number(row.credits));

          /* Per-truck rows drill into that truck's own charges for that day;
             per-day rows drill into the trucks that made up the day. */
          const drill =
            view === "truck-day"
              ? href(
                  basePath,
                  query,
                  { view: "entries", date: row.ist_date, truck: row.truck_number ?? undefined },
                  keep,
                )
              : href(basePath, query, { view: "truck-day", date: row.ist_date }, keep);

          return (
            <li key={`${row.ist_date}-${row.reason}-${row.truck_number ?? "none"}`}>
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
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    {row.truck_number ? (
                      <Mono className="text-sm font-medium text-ink">{row.truck_number}</Mono>
                    ) : (
                      <span className="text-sm font-medium text-ink">{row.ist_date}</span>
                    )}
                    <span className="text-xs text-muted">{reasonLabel(row.reason)}</span>
                  </span>
                  <span className="mt-0.5 block text-[11px] text-faint">
                    {row.truck_number ? `${row.ist_date} · ` : ""}
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
                    {formatCredits(magnitude)}
                  </span>
                  <span className="text-[10px] text-faint">credits</span>
                </span>

                <ChevronRight size={15} className="shrink-0 text-faint" />
              </Link>
            </li>
          );
        })}
      </ul>
      <Pager basePath={basePath} query={query} keep={keep} page={current} pageCount={pageCount} />
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* every charge                                                                */
/* -------------------------------------------------------------------------- */

async function EntryList({
  userId,
  basePath,
  query,
  keep,
  kind,
  page,
  since,
}: {
  userId: string;
  basePath: string;
  query: LedgerQuery;
  keep: Record<string, string>;
  kind: LedgerKind;
  page: number;
  since: string;
}) {
  let request = getSupabaseAdmin()
    .from("credit_transactions")
    .select("id,created_at,reason,delta,balance_after,truck_number,note", { count: "exact" })
    .eq("user_id", userId)
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (query.reason) request = request.eq("reason", query.reason);
  if (query.truck) request = request.eq("truck_number", query.truck);
  if (kind === "used") request = request.lt("delta", 0);
  if (kind === "added") request = request.gt("delta", 0);

  /* One IST day, expressed as the UTC instants that bound it. Filtering on a
     cast date here would stop the index being used. */
  if (query.date) {
    const start = new Date(`${query.date}T00:00:00+05:30`);
    if (!Number.isNaN(start.getTime())) {
      request = request
        .gte("created_at", start.toISOString())
        .lt("created_at", new Date(start.getTime() + 86_400_000).toISOString());
    }
  }

  const from = (page - 1) * ENTRY_PAGE;
  const { data, count } = await request.range(from, from + ENTRY_PAGE - 1);
  const rows = (data ?? []) as EntryRow[];
  const pageCount = Math.max(Math.ceil((count ?? rows.length) / ENTRY_PAGE), 1);

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing here"
        description="No individual charges match that filter in the last 60 days."
      />
    );
  }

  return (
    <>
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
      <Pager basePath={basePath} query={query} keep={keep} page={page} pageCount={pageCount} />
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

function Pager({
  basePath,
  query,
  keep,
  page,
  pageCount,
}: {
  basePath: string;
  query: LedgerQuery;
  keep: Record<string, string>;
  page: number;
  pageCount: number;
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
        Page {page} of {pageCount}
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
    { key: "month", icon: Truck, label: "Used in 31 days", value: spentMonth },
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
