import Link from "next/link";
import { AlertTriangle, Download, Gauge, Search, Users, Wallet, Zap } from "lucide-react";

import { MetricCard, ShareBreakdown, type Slice } from "@/components/charts";
import { DateRangeBar } from "@/components/DateRangeBar";
import { FacetFilters, GroupByBar } from "@/components/PivotControls";
import {
  ACCOUNTS_MEASURE,
  CREDITS_MEASURE,
  ENTRIES_MEASURE,
  PivotTable,
  TRUCKS_MEASURE,
  lastSeenMeasure,
  type Measure,
} from "@/components/PivotTable";
import {
  bucketRange,
  dimsSentence,
  joinList,
  parseDims,
  parseList,
  parseSort,
  queryString,
  sortHrefFor,
  sortPivotRows,
  type ExplorerParams,
} from "@/components/report";
import { LinkCard, PageHeader, Panel, PanelAction, buttonClass } from "@/components/ui";
import {
  loadFacets,
  loadPivot,
  loadPivotTotals,
  percentChange,
  previousRange,
  rangeParams,
  resolveRange,
  type PivotDimension,
} from "@/lib/analytics";
import { requireSuperAdmin } from "@/lib/auth";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { fmtNumber } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const metadata = { title: "Usage — Admin" };

/**
 * What the platform is asking the toll network for, sliced however you ask.
 *
 * This screen was a chart and a row of stat cards. The owner's verdict was that
 * it was "plain" and "not for a data scientist", and they were right: it could
 * answer "how many calls this month" and nothing else. There was no way to ask
 * which lorry a customer's spending went on, or which account drove Tuesday's
 * spike, because the only grouping in existence was the one baked into the
 * function behind the chart.
 *
 * It is a pivot now, and built deliberately out of the SAME pieces as Finance
 * and Users - GroupByBar, FacetFilters, PivotTable, and the parsing and sorting
 * in report.ts. Three screens asking three questions of one ledger should share
 * one vocabulary: `?dims=account,truck` means the same thing wherever it
 * appears, and a link from one report into another lands on the slicing it
 * named. The alternative is what this console had before, which was four
 * near-identical account tables each free to be wrong on its own.
 *
 * What survives from the old screen is the upstream-API panel, because nothing
 * else answers "is the toll network answering, and how slowly" - a capacity
 * question rather than a customer one.
 */

type UsageParams = ExplorerParams & {
  range?: string;
  from?: string;
  to?: string;
  bucket?: string;
};

/** Usage is about work done, so where a credit CAME from is not its question. */
const OFFERED_DIMENSIONS: PivotDimension[] = ["bucket", "account", "truck", "reason"];

/** Period first: an ungrouped report is a single number. */
const DEFAULT_DIMS: PivotDimension[] = ["bucket"];

/** Above this the toll network is having a bad day rather than a bad call. */
const FAILURE_ALARM = 0.05;

/** Grouped rows rendered. Past this, narrow it - that is what the filters are for. */
const ROW_CAP = 300;

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<UsageParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const range = resolveRange(params);
  const admin = getSupabaseAdmin();

  const dims = parseDims(params.dims, DEFAULT_DIMS).filter((dim) =>
    OFFERED_DIMENSIONS.includes(dim),
  );

  const accounts = parseList(params.account);
  const trucks = parseList(params.truck);
  const reasons = parseList(params.reason);

  // Descending by default: on a report about consumption the interesting end is
  // always the big one.
  const sort = parseSort(params, { key: "credits", desc: true });

  const previous = previousRange(range);
  const filters = { users: accounts, trucks, reasons };
  const query = { from: range.from, to: range.to, kind: "spend" as const, ...filters };

  const fromAt = `${range.from}T00:00:00+05:30`;
  const toAt = `${nextDay(range.to)}T00:00:00+05:30`;

  const [rows, totals, previousTotals, byReason, facets, { data: logs, error: logError }] =
    await Promise.all([
      loadPivot(admin, { ...query, dims, bucket: range.bucket }),
      loadPivotTotals(admin, query),
      loadPivotTotals(admin, { ...previous, kind: "spend", ...filters }),
      // The split by action, for the share panel. Its own call rather than a
      // re-fold of `rows`, because `rows` is grouped however the reader asked
      // and may not carry the action at all.
      loadPivot(admin, { ...query, dims: ["reason"] }),
      loadFacets(admin, range, "spend"),
      /*
       * How each call WENT, which the ledger cannot say.
       *
       * credit_transactions is the authority on what was CHARGED and is never
       * trimmed. search_logs is the only record of the status code and the
       * latency, it IS retention-trimmed, and the worker writes a row for a
       * successful automatic check only when it found something - so its totals
       * are lower by design. The panel says so rather than inviting anyone to
       * reconcile two numbers that were never the same.
       */
      admin
        .from("search_logs")
        .select("ok, response_ms")
        .gte("created_at", fromAt)
        .lt("created_at", toAt)
        .limit(20_000),
    ]);

  const spent = Math.abs(Number(totals?.credits ?? 0));
  const spentBefore = Math.abs(Number(previousTotals?.credits ?? 0));
  const calls = Number(totals?.entries ?? 0);
  const callsBefore = Number(previousTotals?.entries ?? 0);

  const logRows = (logs ?? []) as { ok: boolean; response_ms: number | null }[];
  const logged = logRows.length;
  const failures = logRows.filter((row) => !row.ok).length;
  const failureRate = logged > 0 ? failures / logged : 0;

  const latencies = logRows
    .map((row) => Number(row.response_ms))
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b);
  const median = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : 0;
  // The 95th percentile, because a median hides the tail people complain about.
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  const reasonSlices: Slice[] = byReason.map((row) => ({
    key: row.reason ?? "unknown",
    label: row.reason ? (CREDIT_REASON_LABEL[row.reason] ?? row.reason) : "Unknown",
    value: Math.abs(Number(row.credits) || 0),
    hint: `${fmtNumber(Number(row.entries) || 0)} charges`,
  }));

  /* ----------------------------------------------------------------------- */
  /* The state every link has to carry                                        */
  /* ----------------------------------------------------------------------- */

  /*
   * Built once and threaded through every control, because the failure this
   * prevents is the ordinary one: sort a report and lose its filters, or filter
   * it and lose its grouping. The page number is deliberately absent - see
   * report.ts, which explains why narrowing a report invalidates its pages.
   */
  const carried: Record<string, string | undefined> = {
    ...rangeParams(range),
    dims: dims.join(","),
    account: joinList(accounts),
    truck: joinList(trucks),
    reason: joinList(reasons),
    sort: sort.key,
    dir: sort.desc ? undefined : "asc",
  };

  const hrefWith = (changes: Record<string, string | undefined>): string => {
    const search = queryString({ ...carried, ...changes });
    return search ? `/admin/usage?${search}` : "/admin/usage";
  };

  const measures: Measure[] = [
    { ...CREDITS_MEASURE, label: "Credits spent" },
    { ...ENTRIES_MEASURE, label: "Calls" },
    // A count of customers is meaningless on a row that IS one customer.
    ...(dims.includes("account") ? [] : [ACCOUNTS_MEASURE]),
    ...(dims.includes("truck") ? [] : [TRUCKS_MEASURE]),
    lastSeenMeasure(),
  ];

  const sorted = sortPivotRows(rows, sort, measures);
  const shown = sorted.slice(0, ROW_CAP);

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle="Every charged call to the toll network. Group it, filter it, sort it, export it."
        actions={
          /* Carries the page's own query string, so the spreadsheet is the slice
             on screen. A plain anchor rather than a Link: it is a download, and
             client-side navigation would try to render a CSV as a page. */
          <a
            href={hrefWith({}).replace("/admin/usage", "/admin/usage/export")}
            className={buttonClass("secondary")}
          >
            <Download size={14} />
            Export CSV
          </a>
        }
      />

      <DateRangeBar range={range} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          label="Credits spent"
          value={formatCredits(spent)}
          change={percentChange(spent, spentBefore)}
          hint={`vs ${formatCredits(spentBefore)} before`}
          goodWhen="neither"
          icon={<Wallet size={15} />}
        />
        <MetricCard
          label="Charged calls"
          value={fmtNumber(calls)}
          change={percentChange(calls, callsBefore)}
          hint="one per charge"
          goodWhen="neither"
          icon={<Gauge size={15} />}
        />
        <MetricCard
          label="Cost per call"
          value={formatCredits(calls > 0 ? Math.round((spent / calls) * 100) / 100 : 0)}
          hint="credits, averaged"
          goodWhen="neither"
          icon={<Zap size={15} />}
        />
        {/* Every count opens the grouping that explains it, which is the whole
            of the owner's "use redirection": a figure the reader cannot open is
            a dead end, however prettily it is presented. */}
        <MetricCard
          label="Customers spending"
          value={fmtNumber(Number(totals?.accounts ?? 0))}
          hint="in this range"
          icon={<Users size={15} />}
          href={hrefWith({ dims: "account", sort: "credits", dir: undefined })}
        />
        <MetricCard
          label="Trucks charged for"
          value={fmtNumber(Number(totals?.trucks ?? 0))}
          hint="distinct registrations"
          icon={<Search size={15} />}
          href={hrefWith({ dims: "truck", sort: "credits", dir: undefined })}
        />
        <MetricCard
          label="Failed calls"
          value={fmtNumber(failures)}
          hint={
            logged > 0
              ? `${(failureRate * 100).toFixed(1)}% of ${fmtNumber(logged)} logged`
              : "nothing logged"
          }
          goodWhen="down"
          icon={<AlertTriangle size={15} />}
          href="/admin/logs?type=searches&status=failed"
        />
      </div>

      {/* The controls above the table they change, not beside it: the reader's
          question is "how do I slice this", and the answer should not be
          somewhere the table has already scrolled past. */}
      <Panel className="mb-4" bodyClassName="space-y-3 p-4 sm:p-5">
        <GroupByBar
          dims={dims}
          offer={OFFERED_DIMENSIONS}
          hrefFor={(next) => hrefWith({ dims: next.join(",") })}
        />
        <div className="border-t border-divider pt-3">
          <FacetFilters
            action="/admin/usage"
            carried={carried}
            facets={facets}
            kind="spend"
            /* Off: this screen only ever looks at charges, so a control offering
               "credits added" would be offering an empty report. */
            showKind={false}
            offer={["account", "truck", "reason"]}
            accounts={accounts}
            trucks={trucks}
            reasons={reasons}
            clearHref={hrefWith({ account: undefined, truck: undefined, reason: undefined })}
          />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title={dims.length === 0 ? "The whole range, as one row" : dimsSentence(dims)}
            description={
              dims.length === 0
                ? "Turn a grouping on above to break it apart."
                : `${fmtNumber(rows.length)} group${rows.length === 1 ? "" : "s"}. Tap a customer, a truck or a period to open it.`
            }
            bodyClassName="p-0"
            actions={<PanelAction href="/admin/logs?type=searches">Call by call</PanelAction>}
          >
            <PivotTable
              rows={shown}
              dims={dims}
              grain={range.bucket}
              measures={measures}
              sort={sort}
              sortHref={sortHrefFor("/admin/usage", carried, sort)}
              links={{
                account: (row) => (row.user_id ? `/admin/officers/${row.user_id}` : null),
                truck: (row) =>
                  row.truck_number
                    ? `/admin/explore?q=${encodeURIComponent(row.truck_number)}`
                    : null,
                /* A period narrows the report to itself and re-groups by the two
                   dimensions that explain a spike. bucketRange, not the bucket
                   date twice: a monthly row is stored as the 1st, and passing
                   that as both ends would answer for one day and look as though
                   the other thirty had vanished. */
                bucket: (row) => {
                  if (!row.bucket) return null;
                  const span = bucketRange(row.bucket, range.bucket);
                  return hrefWith({
                    range: "custom",
                    from: span.from,
                    to: span.to,
                    dims: "account,truck",
                  });
                },
              }}
              totals={totals}
              totalsLabel="Everything in range"
              emptyTitle="Nothing was charged in this range"
              emptyDescription="Widen the dates, or clear a filter above."
            />

            {sorted.length > ROW_CAP ? (
              <p className="border-t border-divider px-4 py-3 text-xs text-faint sm:px-5">
                Showing the top {fmtNumber(ROW_CAP)} of {fmtNumber(sorted.length)} groups by{" "}
                {sort.key}. The totals row counts all of them — narrow the range or add a filter to
                reach the rest, or export the CSV, which is not capped.
              </p>
            ) : null}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel
            title="What the credits went on"
            description="The same charges, split by action. A manual search and an automatic check cost different amounts."
          >
            <ShareBreakdown
              slices={reasonSlices}
              format={formatCredits}
              emptyLabel="Nothing spent in this range"
            />
            <p className="mt-3 text-xs text-muted">
              The rates behind these figures are on{" "}
              <Link href="/admin/plans?tab=rules" className="text-brand-500 hover:text-brand-600">
                Plans &amp; credits
              </Link>
              . Changing one changes what future calls cost, not what past ones did.
            </p>
          </Panel>

          <Panel
            title="Is the toll network answering?"
            description="Measured from the call log, which is a different source from the figures above."
          >
            <dl className="space-y-0">
              <Row label="Failure rate">
                {logged > 0 ? `${(failureRate * 100).toFixed(1)}%` : "—"}
              </Row>
              <Row label="Median response">{median > 0 ? `${fmtNumber(median)} ms` : "—"}</Row>
              <Row label="95th percentile">{p95 > 0 ? `${fmtNumber(p95)} ms` : "—"}</Row>
              <Row label="Calls logged">{fmtNumber(logged)}</Row>
            </dl>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              The call log is retention-trimmed and a successful automatic check is only written
              when it found something, so this count is lower than the charged-call figure above by
              design. The two are not meant to reconcile.
            </p>
            {logError ? (
              <p className="mt-2 text-xs text-warn-500">
                The call log could not be read: {logError.message}. The charged figures above are
                unaffected.
              </p>
            ) : null}
          </Panel>

          {failureRate >= FAILURE_ALARM && logged > 0 ? (
            <LinkCard
              href="/admin/logs?type=searches&status=failed"
              icon={<AlertTriangle size={16} />}
              title="The toll network is refusing more than usual"
              description={`${(failureRate * 100).toFixed(1)}% of logged calls failed. Usually a registration the network cannot answer for — a sustained rise is worth checking.`}
              value={fmtNumber(failures)}
              tone="warn"
            />
          ) : null}

          <LinkCard
            href="/admin/finance?section=credits"
            icon={<Wallet size={16} />}
            title="Where the credits came from"
            description="What was bought, what was given away, and who claimed it — the other half of this ledger."
          />

          <LinkCard
            href="/admin/users"
            icon={<Users size={16} />}
            title="Every customer's standing"
            description="Lifecycle stage, lifetime value and consumption side by side."
          />
        </div>
      </div>

      {logged >= 20_000 ? (
        <p className="mt-3 text-xs text-faint">
          Failure rate and response times are measured over the most recent 20,000 logged calls in
          this range. The credit and call figures are complete.
        </p>
      ) : null}
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-divider py-2 last:border-0">
      <dt className="text-xs tracking-wide text-muted uppercase">{label}</dt>
      <dd className="text-right text-sm tabular-nums text-ink">{children}</dd>
    </div>
  );
}

/** The day after a YYYY-MM-DD, for a half-open upper bound. */
function nextDay(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}
