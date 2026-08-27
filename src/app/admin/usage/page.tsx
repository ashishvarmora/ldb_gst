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
  QuotaBar,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtDateTime, fmtNumber, initials, istDaysAgo, istMonthStart, istToday } from "@/lib/format";
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

  const today = istToday();
  const monthStart = istMonthStart();

  const monthTotals = usageRows
    .filter((row) => row.usage_date >= monthStart)
    .reduce(
      (acc, row) => {
        acc.manual += row.manual_searches;
        acc.tracking += row.tracking_queries;
        return acc;
      },
      { manual: 0, tracking: 0 },
    );

  const todayTotals = usageRows
    .filter((row) => row.usage_date === today)
    .reduce(
      (acc, row) => {
        acc.manual += row.manual_searches;
        acc.tracking += row.tracking_queries;
        return acc;
      },
      { manual: 0, tracking: 0 },
    );

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
    (a, b) =>
      b.tracking_queries_month + b.manual_searches_month -
      (a.tracking_queries_month + a.manual_searches_month),
  );

  const failed = calls.filter((call) => !call.ok).length;

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle={`Consumption for ${monthStart.slice(0, 7)}. Manual searches reset every IST midnight; tracking queries reset on the 1st.`}
        actions={
          <a href="/admin/usage/export" className={buttonClass("secondary")}>
            <Download size={14} />
            Export CSV
          </a>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Manual searches this month"
          value={fmtNumber(monthTotals.manual)}
          sub={`${fmtNumber(todayTotals.manual)} today`}
          tone="brand"
        />
        <StatCard
          label="Tracking queries this month"
          value={fmtNumber(monthTotals.tracking)}
          sub={`${fmtNumber(todayTotals.tracking)} today`}
          tone="good"
        />
        <StatCard
          label="Total LDB calls this month"
          value={fmtNumber(monthTotals.manual + monthTotals.tracking)}
          sub="What the upstream portal saw"
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
        title="Platform usage, last 30 days"
        description="Aggregated across every officer."
      >
        <UsageChart series={series} />
      </Panel>

      <Panel
        className="mb-5"
        title="Per-officer consumption"
        description="Sorted by total calls this month."
        bodyClassName="p-0"
      >
        {ranked.length === 0 ? (
          <EmptyState title="No officers yet" />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Officer</th>
              <th className="th">Plan</th>
              <th className="th">Searches today</th>
              <th className="th">Searches this month</th>
              <th className="th">Queries this month</th>
              <th className="th">Trucks</th>
              <th className="th text-right">Monthly cap</th>
            </Thead>
            <Tbody>
              {ranked.map((officer) => (
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
                  <td className="td">
                    <QuotaBar
                      used={officer.manual_searches_today}
                      limit={officer.manual_search_limit_per_day}
                    />
                  </td>
                  <td className="td text-sm tabular-nums">
                    {fmtNumber(officer.manual_searches_month)}
                  </td>
                  <td className="td">
                    <QuotaBar
                      used={officer.tracking_queries_month}
                      limit={officer.tracking_queries_per_month}
                    />
                  </td>
                  <td className="td text-sm tabular-nums">
                    {officer.active_trucks} / {formatLimit(officer.truck_limit)}
                  </td>
                  <td className="td text-right text-sm tabular-nums text-muted">
                    {formatLimit(officer.tracking_queries_per_month)}
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel
        title="Recent LDB calls"
        description="Newest first. Every manual search, plus the background checks that found a movement or failed - a quiet check that changed nothing is counted but not listed."
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
