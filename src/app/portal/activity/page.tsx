import Link from "next/link";
import { Coins, RefreshCw, Search } from "lucide-react";

import {
  ACTIVITY_RANGES,
  ActivityControls,
  DEFAULT_RANGE,
  type ActivityKind,
  type ActivityQuery,
} from "./ActivityFilters";
import { Pager, pageFromParam } from "@/components/Pager";
import { publicSettings } from "@/components/SiteFooter";
import {
  Badge,
  EmptyState,
  LinkButton,
  Mono,
  PageHeader,
  Panel,
  StatCard,
  cx,
} from "@/components/ui";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { friendlyError, reportError } from "@/lib/errors";
import { fmtDateTime, fmtNumber, fmtRelative, istDaysAgo } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { MyActivity, RetentionRule } from "@/lib/types";

/** Rows per page. Each entry is two lines on a phone, so a page is a scroll. */
const PAGE_SIZE = 25;

/**
 * How many rows the totals read. Well past what any one account puts in a
 * quarter, and a hard stop so an unusually busy account cannot stall the page.
 */
const SUMMARY_LIMIT = 5000;

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Activity — ${brandName}` };
}

/** Only the columns the totals need - the feed reads the whole row separately. */
type SummaryRow = Pick<MyActivity, "kind" | "detail" | "credits" | "ok">;

/** What a search row is called. The stored value is manual or tracking. */
const SEARCH_LABEL: Record<string, string> = {
  manual: "Manual search",
  tracking: "Automatic check",
};

/**
 * Where every credit went.
 *
 * The one question this page exists to answer, and until now only the admin
 * console could: a customer could see a balance dropping and nothing that
 * explained it. So it is one feed, newest first, of what was looked up, when,
 * whether it worked and what it cost - not a second copy of the rolled-up
 * credit history on the plan page.
 *
 * my_activity is a union of search_logs and credit_transactions, so a paid
 * search shows up twice: once as the lookup, once as the charge. That is worth
 * saying out loud rather than hiding, because the two together are the answer -
 * and the tabs are there for anyone who only wants one of them.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<ActivityQuery>;
}) {
  const { overview } = await requirePortalSession();
  const params = await searchParams;
  const admin = getSupabaseAdmin();

  const kind: ActivityKind =
    params.kind === "search" || params.kind === "credit" ? params.kind : "all";
  const range = ACTIVITY_RANGES.some((r) => r.key === params.range)
    ? params.range!
    : DEFAULT_RANGE;
  const since = range === "all" ? null : `${istDaysAgo(Number(range))}T00:00:00+05:30`;

  const page = pageFromParam(params.page);
  const from = (page - 1) * PAGE_SIZE;

  let feedQuery = admin
    .from("my_activity")
    .select("*", { count: "exact" })
    .eq("user_id", overview.id)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (kind !== "all") feedQuery = feedQuery.eq("kind", kind);
  if (since) feedQuery = feedQuery.gte("created_at", since);

  // Deliberately not filtered by kind: all four totals describe the range, and
  // three of them would read as zero the moment someone opened a single tab.
  let summaryQuery = admin
    .from("my_activity")
    .select("kind, detail, credits, ok")
    .eq("user_id", overview.id)
    .order("created_at", { ascending: false })
    .limit(SUMMARY_LIMIT);
  if (since) summaryQuery = summaryQuery.gte("created_at", since);

  const [feed, summary, retention] = await Promise.all([
    feedQuery,
    summaryQuery,
    // Read, never written: how long a log is kept is a platform setting the
    // operator owns. It is read here so the page can state the real number
    // instead of a guess a reader would plan around.
    admin
      .from("retention_rules")
      .select("entity, keep_days, is_enabled")
      .in("entity", ["search_logs", "credit_transactions"]),
  ]);

  const rows = (feed.data ?? []) as MyActivity[];
  const total = feed.count ?? rows.length;
  const summaryRows = (summary.data ?? []) as SummaryRow[];
  const capped = summaryRows.length === SUMMARY_LIMIT;

  const totals = tally(summaryRows);
  const rangeLabel = ACTIVITY_RANGES.find((r) => r.key === range)?.label ?? "Last 30 days";
  const rangeSub = range === "all" ? "everything kept" : rangeLabel.toLowerCase();

  const rules = (retention.data ?? []) as Pick<
    RetentionRule,
    "entity" | "keep_days" | "is_enabled"
  >[];

  return (
    <>
      <PageHeader
        title="Activity"
        subtitle="Every search you have run and every credit that has moved, newest first."
        actions={
          /* The other half of the pair: this page is the itemised one, the plan
             page is the balance, the top-up and the per-day summary. */
          <LinkButton href="/portal/plan" size="sm" variant="secondary">
            Plan and credits
          </LinkButton>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="Credits spent"
          value={formatCredits(totals.spent)}
          sub={rangeSub}
          tone={totals.spent > 0 ? "brand" : "neutral"}
        />
        <StatCard
          label="Credits added"
          value={formatCredits(totals.added)}
          sub="top-ups, plans and rewards"
          tone={totals.added > 0 ? "good" : "neutral"}
        />
        <StatCard
          label="Searches"
          value={fmtNumber(totals.manual)}
          sub={
            totals.failed > 0
              ? `${fmtNumber(totals.failed)} did not work`
              : "you ran by hand"
          }
        />
        <StatCard
          label="Automatic checks"
          value={fmtNumber(totals.autoChecks)}
          sub="run for your tracked trucks"
        />
      </div>

      <ActivityControls params={params} kind={kind} range={range} />

      {capped ? (
        <p className="mb-3 rounded-lg border border-line bg-panel px-3 py-2 text-xs leading-relaxed text-muted">
          This range holds more than {fmtNumber(SUMMARY_LIMIT)} entries. The four figures above
          cover the newest {fmtNumber(SUMMARY_LIMIT)} — pick a shorter range for exact totals. The
          list below is complete.
        </p>
      ) : null}

      <Panel
        title={
          kind === "search" ? "Searches" : kind === "credit" ? "Credit movements" : "Everything"
        }
        description={
          kind === "credit"
            ? "Every change to your balance, spent and added."
            : kind === "search"
              ? "Every lookup, by hand or automatic, and what it found."
              : /* Said plainly, because the doubling looks like a bug otherwise. */
                "A paid search appears twice — once as the lookup, once as the credit it drew."
        }
        bodyClassName="p-0"
      >
        {feed.error ? (
          <EmptyState
            title="Could not load your activity"
            description={reportError("my_activity query", feed.error)}
          />
        ) : rows.length === 0 ? (
          <EmptyState
            title={
              range === "all" && kind === "all"
                ? "Nothing here yet"
                : "Nothing in this range"
            }
            description={
              range === "all" && kind === "all"
                ? "Search a truck and this fills up: what you looked for, what it found, and what it cost."
                : "Try a wider date range, or another tab."
            }
            action={
              range === "all" && kind === "all" ? (
                <LinkButton href="/portal/search">Search a truck</LinkButton>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-divider">
            {rows.map((row, index) => (
              <FeedRow key={`${row.kind}-${row.created_at}-${index}`} row={row} />
            ))}
          </ul>
        )}
      </Panel>

      <Pager
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        href={{ path: "/portal/activity", params: { kind: kind === "all" ? "" : kind, range } }}
        noun="entries"
      />

      {/* Nobody should discover the retention window by finding a month missing.
          It sits under the list, where someone who has just scrolled to the
          oldest entry on screen is asking exactly this. */}
      <p className="mt-4 rounded-lg border border-line bg-panel px-3 py-2.5 text-xs leading-relaxed text-muted">
        {retentionSentence(rules)}{" "}
        <Link href="/portal/settings" className="font-medium text-brand-500 hover:underline">
          Connect your own Google Sheet
        </Link>{" "}
        in Settings and the copy is written there, where it stays yours.
      </p>

      <p className="mt-2 text-xs leading-relaxed text-muted">
        Looking for payments, or usage totalled per day rather than entry by entry? Those are on{" "}
        <Link href="/portal/plan#history" className="font-medium text-brand-500 hover:underline">
          Plan and credits
        </Link>
        .
      </p>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* totals                                                                      */
/* -------------------------------------------------------------------------- */

type Totals = {
  spent: number;
  added: number;
  manual: number;
  autoChecks: number;
  failed: number;
};

/**
 * Spent is reported as a positive number: credits arrive negative when they
 * leave the balance, and "-42 spent" asks the reader to cancel two negatives.
 */
function tally(rows: SummaryRow[]): Totals {
  const totals: Totals = { spent: 0, added: 0, manual: 0, autoChecks: 0, failed: 0 };

  for (const row of rows) {
    if (row.kind === "credit") {
      const change = Number(row.credits ?? 0);
      if (change < 0) totals.spent += -change;
      else totals.added += change;
      continue;
    }
    if (row.detail === "tracking") totals.autoChecks += 1;
    else totals.manual += 1;
    if (!row.ok) totals.failed += 1;
  }

  // Credit rates can be fractions, so a few hundred part-credits accumulate
  // float dust. Two decimals is as fine as a credit is ever quoted.
  totals.spent = Math.round(totals.spent * 100) / 100;
  totals.added = Math.round(totals.added * 100) / 100;
  return totals;
}

/* -------------------------------------------------------------------------- */
/* retention                                                                   */
/* -------------------------------------------------------------------------- */

type Rule = Pick<RetentionRule, "entity" | "keep_days" | "is_enabled">;

/** Days a table is actually kept for, or null when nothing is ever cleared. */
function keepDays(rules: Rule[], entity: string): number | null {
  const rule = rules.find((r) => r.entity === entity);
  if (!rule || !rule.is_enabled || rule.keep_days < 1) return null;
  return rule.keep_days;
}

/**
 * The real windows, read from the rules rather than written into the copy - a
 * number in a sentence here would go stale the moment the operator changed it,
 * and a reader would plan around a promise the app was no longer keeping.
 */
function retentionSentence(rules: Rule[]): string {
  const searches = keepDays(rules, "search_logs");
  const credits = keepDays(rules, "credit_transactions");

  const first =
    searches === null
      ? "Searches stay in the app for as long as your account is open."
      : `Searches stay in the app for ${searches} day${searches === 1 ? "" : "s"}. After that they are copied to a Google Sheet and cleared from here, so the sheet is the long-term copy.`;

  const second =
    credits === null
      ? " Credit movements are kept for as long as your account is open — a balance has to stay explainable."
      : ` Credit movements are kept for ${credits} day${credits === 1 ? "" : "s"} and copied out the same way.`;

  return `${first}${second}`;
}

/* -------------------------------------------------------------------------- */
/* one entry                                                                   */
/* -------------------------------------------------------------------------- */

function FeedRow({ row }: { row: MyActivity }) {
  return row.kind === "credit" ? <CreditRow row={row} /> : <SearchRow row={row} />;
}

function CreditRow({ row }: { row: MyActivity }) {
  const change = Number(row.credits ?? 0);
  const added = change > 0;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <RowIcon tone={added ? "good" : "brand"}>
        <Coins size={14} />
      </RowIcon>

      <span className="min-w-0 flex-1">
        <span className="block text-sm text-ink">
          {CREDIT_REASON_LABEL[row.detail] ?? row.detail}
        </span>
        <span className="block text-xs text-faint">
          {fmtDateTime(row.created_at)}
          {row.truck_number ? (
            <>
              {" · "}
              <Mono className="text-muted">{row.truck_number}</Mono>
            </>
          ) : null}
        </span>
      </span>

      <span
        className={cx(
          "shrink-0 text-sm font-medium tabular-nums",
          added ? "text-good-500" : "text-bad-500",
        )}
      >
        {added ? "+" : "−"}
        {formatCredits(Math.abs(change))}
      </span>
    </li>
  );
}

function SearchRow({ row }: { row: MyActivity }) {
  const automatic = row.detail === "tracking";
  const found = row.new_events ?? 0;

  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <RowIcon tone={row.ok ? "neutral" : "bad"}>
        {automatic ? <RefreshCw size={14} /> : <Search size={14} />}
      </RowIcon>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {row.truck_number ? (
            <Link
              href={`/portal/search/${row.truck_number}`}
              className="transition hover:text-brand-500"
            >
              <Mono className="font-semibold text-ink">{row.truck_number}</Mono>
            </Link>
          ) : (
            <span className="text-sm text-ink">A truck</span>
          )}
          <span className="text-xs text-muted">{SEARCH_LABEL[row.detail] ?? row.detail}</span>
          {row.ok ? null : <Badge tone="bad">did not work</Badge>}
        </span>

        <span className="mt-0.5 block text-xs text-faint">
          {fmtDateTime(row.created_at)} · {fmtRelative(row.created_at)}
        </span>

        {/* Why the credit was worth spending, or why it was not. */}
        {row.ok ? (
          <span className="mt-0.5 block text-xs text-muted">
            {found > 0
              ? `${fmtNumber(found)} new crossing${found === 1 ? "" : "s"} recorded`
              : "Nothing new since the last look"}
          </span>
        ) : (
          <span className="mt-0.5 block text-xs text-bad-500">
            {friendlyError(row.error, "The toll portal did not answer. Nothing was recorded.")}
          </span>
        )}
      </span>
    </li>
  );
}

/** The small square that carries the entry's kind, at a real size on a phone. */
function RowIcon({
  tone,
  children,
}: {
  tone: "neutral" | "brand" | "good" | "bad";
  children: React.ReactNode;
}) {
  const skin = {
    neutral: "border-line bg-sunken text-muted",
    brand: "border-brand-500/30 bg-brand-500/12 text-brand-400",
    good: "border-good-500/35 bg-good-500/12 text-good-500",
    bad: "border-bad-500/35 bg-bad-500/12 text-bad-500",
  }[tone];

  return (
    <span
      aria-hidden
      className={cx(
        "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg border",
        skin,
      )}
    >
      {children}
    </span>
  );
}
