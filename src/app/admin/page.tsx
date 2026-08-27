import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  Gauge,
  Package,
  Search,
  Truck,
  Users,
} from "lucide-react";

import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import {
  Avatar,
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  QuotaBar,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  LinkButton,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtDateTime, fmtNumber, fmtRelative, initials, istDaysAgo, istToday } from "@/lib/format";
import { usageRatio } from "@/lib/limits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AuditLog, OfficerOverview, UsageCounter } from "@/lib/types";

export const metadata = { title: "Overview — Admin" };

type Attention = { officer: OfficerOverview; reason: string; tone: "bad" | "warn" };

export default async function AdminOverviewPage() {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  const [
    { data: officers, error: officersError },
    { data: usage },
    { count: planCount },
    { count: failedCalls },
    { data: audit },
    { count: alertsToday },
  ] = await Promise.all([
    admin.from("officer_overview").select("*").eq("role", "officer"),
    admin.from("usage_counters").select("*").gte("usage_date", istDaysAgo(29)),
    admin.from("plans").select("id", { count: "exact", head: true }).eq("is_active", true),
    admin
      .from("search_logs")
      .select("id", { count: "exact", head: true })
      .eq("ok", false)
      .gte("created_at", dayAgo),
    admin.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(8),
    admin
      .from("alert_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayAgo),
  ]);

  const rows = (officers ?? []) as OfficerOverview[];
  const usageRows = (usage ?? []) as UsageCounter[];

  const active = rows.filter((o) => o.status === "active").length;
  const suspended = rows.length - active;
  const trucks = rows.reduce((sum, o) => sum + o.active_trucks, 0);

  const today = istToday();
  const searchesToday = usageRows
    .filter((row) => row.usage_date === today)
    .reduce((sum, row) => sum + row.manual_searches, 0);
  const monthStart = `${today.slice(0, 7)}-01`;
  const queriesThisMonth = usageRows
    .filter((row) => row.usage_date >= monthStart)
    .reduce((sum, row) => sum + row.tracking_queries, 0);

  // Aggregate every officer's daily counters into one platform-wide series.
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

  const attention: Attention[] = [];
  for (const officer of rows) {
    if (officer.status === "suspended") {
      attention.push({ officer, reason: "Account suspended", tone: "warn" });
      continue;
    }
    if (!officer.plan_id) {
      attention.push({ officer, reason: "No plan assigned — every search is refused", tone: "bad" });
      continue;
    }
    if (officer.plan_expires_on && officer.plan_expires_on < today) {
      attention.push({
        officer,
        reason: `Plan expired on ${officer.plan_expires_on}`,
        tone: "bad",
      });
      continue;
    }
    const searchRatio = usageRatio(
      officer.manual_searches_today,
      officer.manual_search_limit_per_day,
    );
    const queryRatio = usageRatio(
      officer.tracking_queries_month,
      officer.tracking_queries_per_month,
    );
    const truckRatio = usageRatio(officer.active_trucks, officer.truck_limit);

    if (queryRatio >= 1) {
      attention.push({ officer, reason: "Monthly tracking quota exhausted", tone: "bad" });
    } else if (searchRatio >= 1) {
      attention.push({ officer, reason: "Daily search quota exhausted", tone: "bad" });
    } else if (queryRatio >= 0.8) {
      attention.push({
        officer,
        reason: `${Math.round(queryRatio * 100)}% of monthly tracking quota used`,
        tone: "warn",
      });
    } else if (truckRatio >= 1) {
      attention.push({ officer, reason: "Truck limit reached", tone: "warn" });
    } else if (searchRatio >= 0.8) {
      attention.push({
        officer,
        reason: `${Math.round(searchRatio * 100)}% of today's searches used`,
        tone: "warn",
      });
    }
  }

  const busiest = [...rows]
    .sort((a, b) => b.tracking_queries_month - a.tracking_queries_month)
    .slice(0, 6);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Everything running on the platform right now, across every officer."
        actions={<LinkButton href="/admin/officers">Manage officers</LinkButton>}
      />

      {officersError ? (
        <Panel className="mb-6 border-bad-500/40">
          <p className="text-sm text-bad-500">
            Could not read <code className="font-mono">officer_overview</code>:{" "}
            {officersError.message}
          </p>
          <p className="mt-2 text-xs text-muted">
            Run both files in <code className="font-mono">supabase/migrations</code> against your
            Supabase project, then reload.
          </p>
        </Panel>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Officers"
          value={rows.length}
          sub={`${active} active · ${suspended} suspended`}
          icon={<Users size={15} />}
        />
        <StatCard
          label="Active plans"
          value={planCount ?? 0}
          sub="Assignable right now"
          icon={<Package size={15} />}
        />
        <StatCard
          label="Trucks tracked"
          value={fmtNumber(trucks)}
          sub="Across all officers"
          tone="brand"
          icon={<Truck size={15} />}
        />
        <StatCard
          label="Searches today"
          value={fmtNumber(searchesToday)}
          sub="Manual lookups"
          icon={<Search size={15} />}
        />
        <StatCard
          label="Queries this month"
          value={fmtNumber(queriesThisMonth)}
          sub="Background tracking calls"
          icon={<Gauge size={15} />}
        />
        <StatCard
          label="Alerts (24h)"
          value={fmtNumber(alertsToday ?? 0)}
          sub={
            (failedCalls ?? 0) > 0
              ? `${fmtNumber(failedCalls ?? 0)} failed LDB call${failedCalls === 1 ? "" : "s"}`
              : "No failed LDB calls"
          }
          tone={(failedCalls ?? 0) > 0 ? "warn" : "neutral"}
          icon={<Bell size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title="Platform usage, last 30 days"
            description="Every LDB call the platform made, split by manual and automatic."
          >
            <UsageChart series={series} />
          </Panel>

          <Panel
            title="Busiest officers this month"
            description="Ranked by background tracking calls."
            bodyClassName="p-0"
            actions={
              <Link href="/admin/usage" className="text-xs text-brand-400 hover:underline">
                Full usage report
              </Link>
            }
          >
            {busiest.length === 0 ? (
              <EmptyState
                title="No officers yet"
                description="Create an officer account to get started."
                action={<LinkButton href="/admin/officers">Go to officers</LinkButton>}
              />
            ) : (
              <TableWrap>
                <Thead>
                  <th className="th">Officer</th>
                  <th className="th">Plan</th>
                  <th className="th">Trucks</th>
                  <th className="th">Searches today</th>
                  <th className="th">Queries this month</th>
                </Thead>
                <Tbody>
                  {busiest.map((officer) => (
                    <Tr key={officer.id}>
                      <td className="td">
                        <Link
                          href={`/admin/officers/${officer.id}`}
                          className="group flex items-center gap-2.5"
                        >
                          <Avatar
                            size="sm"
                            text={initials(officer.full_name, officer.email)}
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                              {officer.full_name ?? officer.email}
                            </span>
                            <span className="block truncate text-xs text-faint">
                              {officer.office ?? officer.district ?? "--"}
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
                        <QuotaBar used={officer.active_trucks} limit={officer.truck_limit} />
                      </td>
                      <td className="td">
                        <QuotaBar
                          used={officer.manual_searches_today}
                          limit={officer.manual_search_limit_per_day}
                        />
                      </td>
                      <td className="td">
                        <QuotaBar
                          used={officer.tracking_queries_month}
                          limit={officer.tracking_queries_per_month}
                        />
                      </td>
                    </Tr>
                  ))}
                </Tbody>
              </TableWrap>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel
            title="Needs attention"
            description={
              attention.length === 0
                ? "Nothing is blocked or close to a limit."
                : `${attention.length} item${attention.length === 1 ? "" : "s"} to look at.`
            }
            bodyClassName="p-0"
          >
            {attention.length === 0 ? (
              <EmptyState title="All clear" description="Every officer is inside their limits." />
            ) : (
              <ul className="divide-y divide-divider">
                {attention.slice(0, 12).map(({ officer, reason, tone }) => (
                  <li key={`${officer.id}-${reason}`}>
                    <Link
                      href={`/admin/officers/${officer.id}`}
                      className="flex items-start gap-3 px-5 py-3 transition hover:bg-raised/60"
                    >
                      <AlertTriangle
                        size={15}
                        className={tone === "bad" ? "mt-0.5 text-bad-500" : "mt-0.5 text-warn-500"}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink">
                          {officer.full_name ?? officer.email}
                        </span>
                        <span className="block text-xs text-muted">{reason}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Recent admin activity"
            bodyClassName="p-0"
            actions={
              <Link href="/admin/audit" className="text-xs text-brand-400 hover:underline">
                Full log
              </Link>
            }
          >
            {(audit ?? []).length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              <ul className="divide-y divide-divider">
                {((audit ?? []) as AuditLog[]).map((entry) => (
                  <li key={entry.id} className="px-5 py-2.5">
                    <p className="text-sm text-ink">
                      <span className="font-mono text-xs text-brand-400">{entry.action}</span>
                      {entry.entity_label ? (
                        <span className="text-muted"> · {entry.entity_label}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-faint">
                      {fmtRelative(entry.created_at)} · {fmtDateTime(entry.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
