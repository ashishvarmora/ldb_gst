import Link from "next/link";
import { ArrowLeft, Filter } from "lucide-react";

import { pageRange } from "../../pager";
import { Select } from "@/components/form";
import { Pager, pageFromParam } from "@/components/Pager";
import {
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
import { ALERT_KIND_LABEL } from "@/lib/alerts";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertLog, AlertRuleKind } from "@/lib/types";

export const metadata = { title: "Alert delivery log — Admin" };

const PAGE_SIZE = 50;

/**
 * alert_logs is a permanent record, so it still holds rows written before the
 * rule catalogue existed, with kinds like "approaching_city" that no longer
 * exist. Show the raw kind for those rather than an empty cell.
 */
function kindLabel(kind: string): string {
  return ALERT_KIND_LABEL[kind as AlertRuleKind] ?? kind;
}

type Row = AlertLog & { profiles: { full_name: string | null; email: string } | null };

export default async function AlertLogPage({
  searchParams,
}: {
  searchParams: Promise<{ officer?: string; delivered?: string; kind?: string; page?: string }>;
}) {
  await requireSuperAdmin();
  // `officer` stays the parameter name: the account page links straight here
  // with it, so renaming it would break those links for no gain.
  const { officer, delivered, kind, page: pageParam } = await searchParams;
  const admin = getSupabaseAdmin();

  const requested = pageFromParam(pageParam);
  const { from, to } = pageRange(requested, PAGE_SIZE);

  let query = admin
    .from("alert_logs")
    .select("*, profiles(full_name, email)", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);

  if (officer) query = query.eq("user_id", officer);
  if (kind) query = query.eq("kind", kind);
  if (delivered === "yes") query = query.eq("delivered", true);
  if (delivered === "no") query = query.eq("delivered", false);

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  const [{ data: alerts, error, count }, { data: accounts }, { count: last24h }, { count: undelivered }] =
    await Promise.all([
      query,
      admin.from("profiles").select("id, full_name, email").eq("role", "officer").order("full_name"),
      admin.from("alert_logs").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
      admin.from("alert_logs").select("id", { count: "exact", head: true }).eq("delivered", false),
    ]);

  const rows = (alerts ?? []) as Row[];
  const total = count ?? rows.length;
  const filtered = Boolean(officer || delivered || kind);

  return (
    <>
      <Link
        href="/admin/alerts"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-brand-400"
      >
        <ArrowLeft size={13} />
        Alert rules
      </Link>

      <PageHeader
        title="Alert delivery log"
        subtitle="Every alert the platform generated, and whether it actually reached the account on Telegram."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Alerts in last 24h" value={fmtNumber(last24h ?? 0)} tone="brand" />
        <StatCard
          label="Never delivered"
          value={fmtNumber(undelivered ?? 0)}
          tone={(undelivered ?? 0) > 0 ? "warn" : "neutral"}
          sub={(undelivered ?? 0) > 0 ? "Usually a missing Telegram chat id" : "All alerts delivered"}
        />
        <StatCard
          label={filtered ? "Matching these filters" : "Alerts on record"}
          value={fmtNumber(total)}
          sub={`Shown ${PAGE_SIZE} at a time`}
        />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <Select name="officer" defaultValue={officer ?? ""} className="w-56">
          <option value="">All accounts</option>
          {(accounts ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.full_name ?? row.email}
            </option>
          ))}
        </Select>

        <Select name="kind" defaultValue={kind ?? ""} className="w-52">
          <option value="">Any alert type</option>
          {Object.entries(ALERT_KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select name="delivered" defaultValue={delivered ?? ""} className="w-44">
          <option value="">Delivered or not</option>
          <option value="yes">Delivered</option>
          <option value="no">Not delivered</option>
        </Select>

        <button type="submit" className={buttonClass("secondary")}>
          <Filter size={14} />
          Apply
        </button>
        {filtered ? (
          <Link href="/admin/alerts/log" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <Panel bodyClassName="p-0">
        {error ? (
          <EmptyState title="Could not load alerts" description={error.message} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={total > 0 ? "That page is past the end of the log" : "No alerts yet"}
            description={
              total > 0
                ? "Use the page links below to get back."
                : "Alerts appear once someone attaches a rule to a truck and it reports in."
            }
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">When</th>
              <th className="th">Account</th>
              <th className="th">Truck</th>
              <th className="th">Type</th>
              <th className="th">Alert</th>
              <th className="th">Delivery</th>
            </Thead>
            <Tbody>
              {rows.map((alert) => (
                <Tr key={alert.id}>
                  <td className="td whitespace-nowrap">
                    <span className="block text-sm text-ink">{fmtRelative(alert.created_at)}</span>
                    <span className="block text-xs text-faint">{fmtDateTime(alert.created_at)}</span>
                  </td>
                  <td className="td text-sm">
                    <Link
                      href={`/admin/officers/${alert.user_id}`}
                      className="transition hover:text-brand-400"
                    >
                      {alert.profiles?.full_name ?? alert.profiles?.email ?? "--"}
                    </Link>
                  </td>
                  <td className="td">{alert.truck_number ? <Mono>{alert.truck_number}</Mono> : "--"}</td>
                  <td className="td text-sm text-muted">
                    {alert.kind ? kindLabel(alert.kind) : "--"}
                  </td>
                  <td className="td">
                    <span className="block text-sm text-ink">{alert.title}</span>
                    {alert.message ? (
                      <span className="block max-w-md truncate text-xs text-faint">
                        {alert.message}
                      </span>
                    ) : null}
                  </td>
                  <td className="td">
                    {alert.delivered ? (
                      <Badge tone="good">delivered</Badge>
                    ) : (
                      <span>
                        <Badge tone="warn">not delivered</Badge>
                        {alert.delivery_error ? (
                          <span className="mt-1 block max-w-52 text-xs text-bad-500">
                            {alert.delivery_error}
                          </span>
                        ) : null}
                      </span>
                    )}
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      <Pager
        page={requested}
        pageSize={PAGE_SIZE}
        total={total}
        noun="alerts"
        href={{ path: "/admin/alerts/log", params: { officer, delivered, kind } }}
      />
    </>
  );
}
