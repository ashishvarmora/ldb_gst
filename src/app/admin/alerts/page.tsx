import Link from "next/link";
import { Filter } from "lucide-react";

import { Select } from "@/components/form";
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
import { requireSuperAdmin } from "@/lib/auth";
import { fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertLog } from "@/lib/types";

export const metadata = { title: "Alerts — Admin" };

const KIND_LABEL: Record<string, string> = {
  approaching_city: "Approaching city",
  state_entry: "Entered state",
  state_exit: "Left state",
  no_movement: "No movement",
  excessive_movement: "Excessive movement",
  watchlist_move: "Watchlist truck moved",
  night_travel: "Night travel",
  route_prediction: "Route prediction",
};

type Row = AlertLog & { profiles: { full_name: string | null; email: string } | null };

export default async function AlertsPage({
  searchParams,
}: {
  searchParams: Promise<{ officer?: string; delivered?: string; kind?: string }>;
}) {
  await requireSuperAdmin();
  const { officer, delivered, kind } = await searchParams;
  const admin = getSupabaseAdmin();

  let query = admin
    .from("alert_logs")
    .select("*, profiles(full_name, email)")
    .order("created_at", { ascending: false })
    .limit(200);

  if (officer) query = query.eq("user_id", officer);
  if (kind) query = query.eq("kind", kind);
  if (delivered === "yes") query = query.eq("delivered", true);
  if (delivered === "no") query = query.eq("delivered", false);

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  const [{ data: alerts, error }, { data: officers }, { count: last24h }, { count: undelivered }] =
    await Promise.all([
      query,
      admin.from("profiles").select("id, full_name, email").eq("role", "officer").order("full_name"),
      admin.from("alert_logs").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
      admin.from("alert_logs").select("id", { count: "exact", head: true }).eq("delivered", false),
    ]);

  const rows = (alerts ?? []) as Row[];

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Every alert the platform generated, and whether it actually reached the officer on Telegram."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Alerts in last 24h" value={fmtNumber(last24h ?? 0)} tone="brand" />
        <StatCard
          label="Never delivered"
          value={fmtNumber(undelivered ?? 0)}
          tone={(undelivered ?? 0) > 0 ? "warn" : "neutral"}
          sub={(undelivered ?? 0) > 0 ? "Usually a missing Telegram chat id" : "All alerts delivered"}
        />
        <StatCard label="Shown below" value={fmtNumber(rows.length)} sub="Newest 200 matching" />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <Select name="officer" defaultValue={officer ?? ""} className="w-56">
          <option value="">All officers</option>
          {(officers ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.full_name ?? row.email}
            </option>
          ))}
        </Select>

        <Select name="kind" defaultValue={kind ?? ""} className="w-52">
          <option value="">Any rule type</option>
          {Object.entries(KIND_LABEL).map(([value, label]) => (
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
        {officer || delivered || kind ? (
          <Link href="/admin/alerts" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <Panel bodyClassName="p-0">
        {error ? (
          <EmptyState title="Could not load alerts" description={error.message} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No alerts yet"
            description="Alerts appear once officers create rules and their trucks start crossing toll plazas."
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">When</th>
              <th className="th">Officer</th>
              <th className="th">Truck</th>
              <th className="th">Rule</th>
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
                    {alert.kind ? (KIND_LABEL[alert.kind] ?? alert.kind) : "--"}
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
    </>
  );
}
