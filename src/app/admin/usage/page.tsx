import Link from "next/link";
import { Download } from "lucide-react";

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
import { fmtDateTime, fmtNumber, initials, istDaysAgo, istMonthStart } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview, SearchLog, UsageCounter } from "@/lib/types";

export const metadata = { title: "Usage — Admin" };

type Row = SearchLog & { profiles: { full_name: string | null; email: string } | null };

export default async function UsagePage() {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  const [{ data: officers }, { data: usage }, { data: recent }] = await Promise.all([
    admin.from("officer_overview").select("*").eq("role", "officer"),
    admin.from("usage_counters").select("*").gte("usage_date", istDaysAgo(29)),
    admin
      .from("search_logs")
      .select("*, profiles(full_name, email)")
      .order("created_at", { ascending: false })
      .limit(40),
  ]);

  const rows = (officers ?? []) as OfficerOverview[];
  const usageRows = (usage ?? []) as UsageCounter[];
  const calls = (recent ?? []) as Row[];

  const monthStart = istMonthStart();

  const creditsToday = rows.reduce((sum, row) => sum + Number(row.credits_spent_today ?? 0), 0);
  const creditsMonth = rows.reduce((sum, row) => sum + Number(row.credits_spent_month ?? 0), 0);
  const outstanding = rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);

  const monthCalls = usageRows
    .filter((row) => row.usage_date >= monthStart)
    .reduce(
      (acc, row) => {
        acc.manual += row.manual_searches;
        acc.auto += row.tracking_queries;
        return acc;
      },
      { manual: 0, auto: 0 },
    );

  // Every officer's daily counters, merged into one platform-wide series.
  const merged = new Map<string, UsageCounter>();
  for (const row of usageRows) {
    const existing = merged.get(row.usage_date);
    if (existing) {
      existing.manual_searches += row.manual_searches;
      existing.tracking_queries += row.tracking_queries;
    } else {
      merged.set(row.usage_date, { ...row });
    }
  }
  const series = buildUsageSeries([...merged.values()], 30);

  const ranked = [...rows].sort(
    (a, b) => Number(b.credits_spent_month ?? 0) - Number(a.credits_spent_month ?? 0),
  );

  const failed = calls.filter((call) => !call.ok).length;

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle={`Credits consumed in ${monthStart.slice(0, 7)}. There are no per-day or per-month allowances any more — an officer works until their balance runs out.`}
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
          sub="Still held by officers"
          tone="good"
        />
        <StatCard
          label="LDB calls this month"
          value={fmtNumber(monthCalls.manual + monthCalls.auto)}
          sub={`${fmtNumber(monthCalls.manual)} manual · ${fmtNumber(monthCalls.auto)} automatic`}
        />
        <StatCard
          label="Failures in these calls"
          value={fmtNumber(failed)}
          tone={failed > 0 ? "warn" : "neutral"}
          sub={failed > 0 ? "Check the call log below" : "All recent calls succeeded"}
        />
      </div>

      <Panel
        className="mb-5"
        title="LDB calls, last 30 days"
        description="What the upstream portal saw, aggregated across every officer."
      >
        <UsageChart series={series} />
      </Panel>

      <Panel
        className="mb-5"
        title="Per-officer consumption"
        description="Sorted by credits spent this month. Top an officer up from their own page."
        bodyClassName="p-0"
      >
        {ranked.length === 0 ? (
          <EmptyState title="No officers yet" />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Officer</th>
              <th className="th">Plan</th>
              <th className="th text-right">Credits left</th>
              <th className="th text-right">Spent today</th>
              <th className="th text-right">Spent this month</th>
              <th className="th text-right">Searches</th>
              <th className="th text-right">Auto checks</th>
              <th className="th text-right">Trucks</th>
            </Thead>
            <Tbody>
              {ranked.map((officer) => {
                const balance = Number(officer.credits ?? 0);
                return (
                  <Tr key={officer.id}>
                    <td className="td">
                      <Link
                        href={`/admin/officers/${officer.id}`}
                        className="group flex items-center gap-2.5"
                      >
                        <Avatar size="sm" text={initials(officer.full_name, officer.email)} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                            {officer.full_name ?? officer.email}
                          </span>
                          <span className="block truncate text-xs text-faint">
                            {officer.office ?? "--"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="td">
                      {officer.plan_name ? (
                        <Badge tone="brand">{officer.plan_name}</Badge>
                      ) : (
                        <Badge tone="bad">no plan</Badge>
                      )}
                    </td>
                    <td className="td text-right">
                      <Badge tone={balance <= 0 ? "bad" : balance < 20 ? "warn" : "good"}>
                        {formatCredits(balance)}
                      </Badge>
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {formatCredits(officer.credits_spent_today)}
                    </td>
                    <td className="td text-right text-sm font-medium tabular-nums text-ink">
                      {formatCredits(officer.credits_spent_month)}
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {fmtNumber(officer.manual_searches_month)}
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {fmtNumber(officer.tracking_queries_month)}
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {officer.active_trucks} / {formatLimit(officer.truck_limit)}
                    </td>
                  </Tr>
                );
              })}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel
        title="Recent LDB calls"
        description="Newest first. Every manual search, plus the background checks that found a movement or failed - a quiet check that changed nothing is charged but not listed."
        bodyClassName="p-0"
      >
        {calls.length === 0 ? (
          <EmptyState title="No calls logged yet" />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">When</th>
              <th className="th">Officer</th>
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
    </>
  );
}
