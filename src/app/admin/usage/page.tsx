import Link from "next/link";
import { Download } from "lucide-react";

import { loadDailyCalls } from "./ledger";
import { pageRange } from "../pager";
import { Pager, pageFromParam, pageSlice } from "@/components/Pager";
import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import {
  Avatar,
  Badge,
  EmptyState,
  Mono,
  PageHeader,
  Panel,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtNumber, initials, istMonthStart } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview, SearchLog } from "@/lib/types";

export const metadata = { title: "Usage — Admin" };

/** Two lists on one page, so each carries its own page number. */
const ACCOUNTS_PAGE = 25;
const CALLS_PAGE = 25;

/** Below this a balance is worth chasing before work stops mid-job. */
const LOW_CREDIT_BALANCE = 20;

type Row = SearchLog & { profiles: { full_name: string | null; email: string } | null };

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ accounts?: string; calls?: string }>;
}) {
  await requireSuperAdmin();
  const { accounts: accountsParam, calls: callsParam } = await searchParams;
  const admin = getSupabaseAdmin();

  const accountsPage = pageFromParam(accountsParam);
  const callsPage = pageFromParam(callsParam);
  const { from, to } = pageRange(callsPage, CALLS_PAGE);

  const [{ data: overview }, dailyCalls, { data: recent, count: callCount }] = await Promise.all([
    // Every account, because the totals below are sums of these rows and a
    // page of them would not add up. The table itself is still paged.
    admin.from("officer_overview").select("*").eq("role", "officer"),
    loadDailyCalls(admin, { days: 30 }),
    admin
      .from("search_logs")
      .select("*, profiles(full_name, email)", { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  ]);

  const rows = (overview ?? []) as OfficerOverview[];
  const calls = (recent ?? []) as Row[];
  const callTotal = callCount ?? calls.length;

  const monthStart = istMonthStart();

  const creditsToday = rows.reduce((sum, row) => sum + Number(row.credits_spent_today ?? 0), 0);
  const creditsMonth = rows.reduce((sum, row) => sum + Number(row.credits_spent_month ?? 0), 0);
  const outstanding = rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);

  // Month-to-date call counts come from the same view the account holder sees,
  // so a per-account row and the platform total can never disagree.
  const monthCalls = rows.reduce(
    (acc, row) => {
      acc.manual += Number(row.manual_searches_month ?? 0);
      acc.auto += Number(row.tracking_queries_month ?? 0);
      return acc;
    },
    { manual: 0, auto: 0 },
  );

  const series = buildUsageSeries(dailyCalls, 30);

  const ranked = [...rows].sort(
    (a, b) => Number(b.credits_spent_month ?? 0) - Number(a.credits_spent_month ?? 0),
  );
  const shown = pageSlice(ranked, accountsPage, ACCOUNTS_PAGE);

  const failed = calls.filter((call) => !call.ok).length;

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle={`Credits consumed in ${monthStart.slice(0, 7)}. There are no per-day or per-month allowances any more — an account works until its balance runs out.`}
        actions={
          <a href="/admin/usage/export" className={buttonClass("secondary")}>
            <Download size={14} />
            Export CSV
          </a>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Credits spent this month"
          value={formatCredits(creditsMonth)}
          sub={`${formatCredits(creditsToday)} today`}
          tone="brand"
        />
        <StatCard
          label="Credits outstanding"
          value={formatCredits(outstanding)}
          sub="Still held by accounts"
          tone="good"
        />
        <StatCard
          label="LDB calls this month"
          value={fmtNumber(monthCalls.manual + monthCalls.auto)}
          sub={`${fmtNumber(monthCalls.manual)} manual · ${fmtNumber(monthCalls.auto)} automatic`}
        />
        <StatCard
          label="Failures on this page"
          value={fmtNumber(failed)}
          tone={failed > 0 ? "warn" : "neutral"}
          sub={failed > 0 ? "Check the call log below" : "Every call on this page succeeded"}
        />
      </div>

      <Panel
        className="mb-5"
        title="LDB calls, last 30 days"
        description="Counted from the credit ledger, so this is exactly what was charged, across every account."
      >
        <UsageChart series={series} />
      </Panel>

      <Panel
        className="mb-2"
        title="Per-account consumption"
        description="Sorted by credits spent this month. Top an account up from its own page."
        bodyClassName="p-0"
      >
        {shown.length === 0 ? (
          <EmptyState
            title={ranked.length > 0 ? "That page is past the end of the list" : "No accounts yet"}
            description={
              ranked.length > 0 ? "Use the page links below to get back." : undefined
            }
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Account</th>
              <th className="th">Plan</th>
              <th className="th text-right">Credits left</th>
              <th className="th text-right">Spent today</th>
              <th className="th text-right">Spent this month</th>
              <th className="th text-right">Searches</th>
              <th className="th text-right">Auto checks</th>
              <th className="th text-right">Trucks</th>
            </Thead>
            <Tbody>
              {shown.map((account) => {
                const balance = Number(account.credits ?? 0);
                return (
                  <Tr key={account.id}>
                    <td className="td">
                      <Link
                        href={`/admin/officers/${account.id}`}
                        className="group flex items-center gap-2.5"
                      >
                        <Avatar size="sm" text={initials(account.full_name, account.email)} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                            {account.full_name ?? account.email}
                          </span>
                          <span className="block truncate text-xs text-faint">
                            {account.office ?? "--"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="td">
                      {account.plan_name ? (
                        <Badge tone="brand">{account.plan_name}</Badge>
                      ) : (
                        // No plan is what a fresh signup looks like, not a fault.
                        <Badge>no plan yet</Badge>
                      )}
                    </td>
                    <td className="td text-right">
                      <Badge
                        tone={balance <= 0 ? "bad" : balance < LOW_CREDIT_BALANCE ? "warn" : "good"}
                      >
                        {formatCredits(balance)}
                      </Badge>
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {formatCredits(account.credits_spent_today)}
                    </td>
                    <td className="td text-right text-sm font-medium tabular-nums text-ink">
                      {formatCredits(account.credits_spent_month)}
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {fmtNumber(account.manual_searches_month)}
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {fmtNumber(account.tracking_queries_month)}
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {account.active_trucks} / {formatLimit(account.truck_limit)}
                    </td>
                  </Tr>
                );
              })}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      <Pager
        className="mt-3 mb-5"
        page={accountsPage}
        pageSize={ACCOUNTS_PAGE}
        total={ranked.length}
        noun="accounts"
        // Two lists on one page, so each keeps the other's page number.
        href={{ path: "/admin/usage", params: { calls: callsParam }, pageKey: "accounts" }}
      />

      <Panel
        title="Recent LDB calls"
        description="Newest first. Every manual search, plus the background checks that found a movement or failed — a quiet check that changed nothing is charged but not listed."
        bodyClassName="p-0"
      >
        {calls.length === 0 ? (
          <EmptyState
            title={callTotal > 0 ? "That page is past the end of the log" : "No calls logged yet"}
            description={callTotal > 0 ? "Use the page links below to get back." : undefined}
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">When</th>
              <th className="th">Account</th>
              <th className="th">Truck</th>
              <th className="th">Source</th>
              <th className="th">Result</th>
              <th className="th text-right">Latency</th>
            </Thead>
            <Tbody>
              {calls.map((call) => (
                <Tr key={call.id}>
                  <td className="td text-xs whitespace-nowrap text-muted">
                    {fmtDateTime(call.created_at)}
                  </td>
                  <td className="td text-sm">
                    <Link
                      href={`/admin/officers/${call.user_id}`}
                      className="transition hover:text-brand-400"
                    >
                      {call.profiles?.full_name ?? call.profiles?.email ?? "--"}
                    </Link>
                  </td>
                  <td className="td">
                    <Mono>{call.truck_number}</Mono>
                  </td>
                  <td className="td">
                    <Badge tone={call.source === "manual" ? "brand" : "neutral"}>{call.source}</Badge>
                  </td>
                  <td className="td">
                    {call.ok ? (
                      <span className="text-sm text-ink">
                        {call.new_events} new / {call.events_found} found
                      </span>
                    ) : (
                      <Badge tone="bad">
                        {call.http_status ? `HTTP ${call.http_status}` : "error"}
                        {call.error ? ` · ${call.error.slice(0, 40)}` : ""}
                      </Badge>
                    )}
                  </td>
                  <td className="td text-right text-sm tabular-nums text-muted">
                    {call.response_ms ? `${call.response_ms} ms` : "--"}
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      <Pager
        page={callsPage}
        pageSize={CALLS_PAGE}
        total={callTotal}
        noun="calls"
        href={{ path: "/admin/usage", params: { accounts: accountsParam }, pageKey: "calls" }}
      />
    </>
  );
}
