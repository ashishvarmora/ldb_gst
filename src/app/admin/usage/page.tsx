import Link from "next/link";
import { AlertTriangle, Download, Gauge, Search, Timer, Users, Wallet, Zap } from "lucide-react";

import {
  ChartTable,
  MetricCard,
  ShareBreakdown,
  StackedBars,
  type Series,
  type Slice,
} from "@/components/charts";
import { DateRangeBar } from "@/components/DateRangeBar";
import { LinkCard, PageHeader, Panel, PanelAction, buttonClass } from "@/components/ui";
import {
  bucketLabel,
  fillBuckets,
  loadCreditSeries,
  percentChange,
  previousRange,
  rangeParams,
  resolveRange,
  sumBy,
} from "@/lib/analytics";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtNumber } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const metadata = { title: "Usage — Admin" };

/**
 * What the platform is asking the upstream toll network for, and what that
 * costs in credits.
 *
 * This page used to carry a per-account consumption table: account, credits
 * left, spent today, spent this month, last active. Three other screens carried
 * the same table with four of the same columns, each with its own sort
 * vocabulary, and an admin could not tell which one to open. Per-account
 * comparison is /admin/users now, and every column that made this a fourth copy
 * is gone.
 *
 * What is left is the thing no other screen answers: call volume, the manual
 * against automatic split, how often the upstream API refuses, how slow it is,
 * and what a call actually costs. That is a capacity question, not a customer
 * question, and it belongs on its own.
 */
type UsageParams = {
  range?: string;
  from?: string;
  to?: string;
  bucket?: string;
};

/** Above this, the upstream API is having a bad day rather than a bad call. */
const FAILURE_ALARM = 0.05;

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<UsageParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const range = resolveRange(params);
  const admin = getSupabaseAdmin();

  const previous = previousRange(range);

  /*
   * Two different sources on purpose, and the page says which is which.
   *
   * credit_transactions is the authority on how many calls were CHARGED - it
   * is the same ledger the customer is billed from, and it is never trimmed.
   * search_logs is the only record of how each call WENT: the status code, the
   * latency, whether it came back at all. It is retention-trimmed, and the
   * tracking worker only writes a row for a successful automatic check when
   * new crossings were found, so its totals are lower by design. Reading one
   * for the other is why "Automatic: 40" once sat beside "Automatic: 333" on
   * the same screen.
   */
  const fromAt = `${range.from}T00:00:00+05:30`;
  const toAt = `${nextDay(range.to)}T00:00:00+05:30`;

  const [credits, creditsPrev, { data: logs, error: logError }] = await Promise.all([
    loadCreditSeries(admin, range),
    loadCreditSeries(admin, { ...previous, bucket: "month" }),
    admin
      .from("search_logs")
      .select("ok, response_ms, source")
      .gte("created_at", fromAt)
      .lt("created_at", toAt)
      .limit(20_000),
  ]);

  const callRows = credits.filter(
    (row) => row.reason === "manual_search" || row.reason === "auto_check",
  );
  const manualCalls = sumBy(
    callRows.filter((row) => row.reason === "manual_search"),
    (row) => row.entries,
  );
  const autoCalls = sumBy(
    callRows.filter((row) => row.reason === "auto_check"),
    (row) => row.entries,
  );
  const calls = manualCalls + autoCalls;

  const spent = Math.abs(sumBy(callRows, (row) => row.credits));
  const spentPrev = Math.abs(
    sumBy(
      creditsPrev.filter(
        (row) => row.reason === "manual_search" || row.reason === "auto_check",
      ),
      (row) => row.credits,
    ),
  );
  const callsPrev = sumBy(
    creditsPrev.filter((row) => row.reason === "manual_search" || row.reason === "auto_check"),
    (row) => row.entries,
  );

  /* Distinct accounts that spent anything, taken as the max across buckets
     rather than summed - an account active on two days is one account. */
  const busiestBucketAccounts = Math.max(0, ...callRows.map((row) => Number(row.accounts) || 0));

  const logRows = (logs ?? []) as { ok: boolean; response_ms: number | null; source: string }[];
  const logged = logRows.length;
  const failures = logRows.filter((row) => !row.ok).length;
  const failureRate = logged > 0 ? failures / logged : 0;

  const latencies = logRows
    .map((row) => Number(row.response_ms))
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b);
  const median = latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)] : 0;
  // The 95th percentile, because a median hides the tail that people actually
  // complain about - a search that takes eight seconds is the one they mention.
  const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : 0;

  const series: Series[] = [
    {
      key: "manual",
      label: "Manual searches",
      values: fillBuckets(
        callRows.filter((row) => row.reason === "manual_search"),
        range,
        (row) => Number(row.entries) || 0,
      ).map((point) => point.value),
    },
    {
      key: "auto",
      label: "Automatic checks",
      values: fillBuckets(
        callRows.filter((row) => row.reason === "auto_check"),
        range,
        (row) => Number(row.entries) || 0,
      ).map((point) => point.value),
    },
  ];
  const buckets = fillBuckets(callRows, range, (row) => Number(row.entries) || 0).map((point) =>
    bucketLabel(point.bucket, range.bucket),
  );

  const spendSlices: Slice[] = [
    {
      key: "manual",
      label: "Manual searches",
      value: Math.abs(
        sumBy(
          callRows.filter((row) => row.reason === "manual_search"),
          (row) => row.credits,
        ),
      ),
      hint: `${fmtNumber(manualCalls)} calls`,
    },
    {
      key: "auto",
      label: "Automatic checks",
      value: Math.abs(
        sumBy(
          callRows.filter((row) => row.reason === "auto_check"),
          (row) => row.credits,
        ),
      ),
      hint: `${fmtNumber(autoCalls)} calls`,
    },
  ];

  const perCall = calls > 0 ? spent / calls : 0;

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle="Every charged call to the toll network, what it cost, and how the upstream API behaved. Per-account comparison is on the Users report."
        actions={
          <a href="/admin/usage/export" className={buttonClass("secondary")}>
            <Download size={14} />
            Export CSV
          </a>
        }
      />

      <DateRangeBar range={range} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          label="Charged calls"
          value={fmtNumber(calls)}
          change={percentChange(calls, callsPrev)}
          hint={`${fmtNumber(manualCalls)} manual · ${fmtNumber(autoCalls)} auto`}
          goodWhen="neither"
          icon={<Gauge size={15} />}
        />
        <MetricCard
          label="Credits spent"
          value={formatCredits(spent)}
          change={percentChange(spent, spentPrev)}
          hint={`vs ${formatCredits(spentPrev)} before`}
          goodWhen="neither"
          icon={<Wallet size={15} />}
        />
        <MetricCard
          label="Cost per call"
          value={formatCredits(Math.round(perCall * 100) / 100)}
          hint="credits, averaged over both kinds"
          goodWhen="neither"
          icon={<Zap size={15} />}
        />
        <MetricCard
          label="Accounts active"
          value={fmtNumber(busiestBucketAccounts)}
          hint="on the busiest day in range"
          icon={<Users size={15} />}
          href="/admin/users?sort=spent"
        />
        <MetricCard
          label="Failed calls"
          value={fmtNumber(failures)}
          hint={
            logged > 0
              ? `${(failureRate * 100).toFixed(1)}% of ${fmtNumber(logged)} logged`
              : "nothing logged in range"
          }
          goodWhen="down"
          icon={<AlertTriangle size={15} />}
          href="/admin/logs?type=searches&status=failed"
        />
        <MetricCard
          label="Response time"
          value={median > 0 ? `${fmtNumber(median)} ms` : "—"}
          hint={p95 > 0 ? `95th percentile ${fmtNumber(p95)} ms` : "no timings recorded"}
          goodWhen="down"
          icon={<Timer size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title={`Calls, by ${range.bucket}`}
            description="Counted from the credit ledger, so this is exactly what was charged, across every customer account."
            actions={<PanelAction href="/admin/logs?type=searches">Call by call</PanelAction>}
          >
            <StackedBars
              buckets={buckets}
              series={series}
              emptyLabel="No charged calls in this range"
            />
            <ChartTable buckets={buckets} series={series} />
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel
            title="What the credits went on"
            description="The same calls, priced. A manual search and an automatic check cost different amounts."
          >
            <ShareBreakdown
              slices={spendSlices}
              format={formatCredits}
              emptyLabel="Nothing spent in this range"
            />
            <p className="mt-3 text-xs text-muted">
              The rates behind these figures are on{" "}
              <Link href="/admin/plans?tab=rules" className="text-brand-500 hover:text-brand-600">
                Plans &amp; credits
              </Link>
              . Changing one changes what every future call costs, not what past ones did.
            </p>
          </Panel>

          {logError ? (
            <Panel className="border-warn-500/40" bodyClassName="px-5 py-3">
              <p className="text-xs text-warn-500">
                Call outcomes could not be read: {logError.message}. The call counts above come from
                the credit ledger and are unaffected.
              </p>
            </Panel>
          ) : null}

          {failureRate >= FAILURE_ALARM && logged > 0 ? (
            <LinkCard
              href="/admin/logs?type=searches&status=failed"
              icon={<AlertTriangle size={16} />}
              title="The upstream API is refusing more than usual"
              description={`${(failureRate * 100).toFixed(1)}% of logged calls failed in this range. Usually a registration number the toll network cannot answer for — but a sustained rise is worth checking.`}
              value={fmtNumber(failures)}
              tone="warn"
            />
          ) : null}

          <LinkCard
            href="/admin/users?sort=spent"
            icon={<Users size={16} />}
            title="Who is spending it"
            description="Consumption per account, alongside what each has paid and where they stand."
          />

          <LinkCard
            href="/admin/logs?type=searches"
            icon={<Search size={16} />}
            title="Every search and background check"
            description="Across all accounts, filterable by account, truck or day."
          />
        </div>
      </div>

      {/*
        The one honest caveat on this page. The ledger figures above are exact;
        the outcome figures are a sample of a trimmed table, and saying so is
        cheaper than someone reconciling two numbers that were never meant to
        match.
      */}
      {logged >= 20_000 ? (
        <p className="mt-3 text-xs text-faint">
          Failure rate and response times are measured over the most recent 20,000 logged calls in
          this range. The call and credit figures above are complete.
        </p>
      ) : null}
    </>
  );
}

/** The day after a YYYY-MM-DD, for a half-open upper bound. */
function nextDay(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}
