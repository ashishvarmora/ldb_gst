import Link from "next/link";
import { Filter, MapPin, Search as SearchIcon } from "lucide-react";

import { Input, Select } from "@/components/form";
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
import type { TrackedTruck, TruckStatus } from "@/lib/types";

export const metadata = { title: "Trucks — Admin" };

const STATUS_TONE = {
  moving: "good",
  idle: "warn",
  no_activity: "bad",
  unknown: "neutral",
} as const;

const STATUS_LABEL = {
  moving: "Moving",
  idle: "Idle",
  no_activity: "No activity",
  unknown: "Unknown",
} as const;

type Row = TrackedTruck & { profiles: { full_name: string | null; email: string } | null };

export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; officer?: string; status?: string }>;
}) {
  await requireSuperAdmin();
  const { q, officer, status } = await searchParams;
  const admin = getSupabaseAdmin();

  let query = admin
    .from("tracked_trucks")
    .select("*, profiles(full_name, email)")
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .limit(300);

  if (officer) query = query.eq("user_id", officer);
  if (status && status in STATUS_LABEL) query = query.eq("status", status);
  if (q) query = query.ilike("truck_number", `%${q.toUpperCase().replace(/[^A-Z0-9]/g, "")}%`);

  const [{ data: trucks, error }, { data: officers }, { data: truckAlerts }] = await Promise.all([
    query,
    admin.from("profiles").select("id, full_name, email").eq("role", "officer").order("full_name"),
    admin.from("truck_alerts").select("tracked_truck_id").eq("is_enabled", true).limit(5000),
  ]);

  const rows = (trucks ?? []) as Row[];

  // A truck has no interval of its own any more: it is checked when one of its
  // alerts comes due, so a truck with no alert is never checked at all.
  const alertsPerTruck = new Map<string, number>();
  for (const row of (truckAlerts ?? []) as { tracked_truck_id: string }[]) {
    alertsPerTruck.set(row.tracked_truck_id, (alertsPerTruck.get(row.tracked_truck_id) ?? 0) + 1);
  }
  const counts = rows.reduce<Record<TruckStatus, number>>(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { moving: 0, idle: 0, no_activity: 0, unknown: 0 },
  );

  return (
    <>
      <PageHeader
        title="Trucks"
        subtitle="Every truck under background tracking, across all officers. A truck is checked only when one of its alerts falls due. Read-only — officers manage their own lists."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Under tracking" value={fmtNumber(rows.length)} tone="brand" />
        <StatCard label="Moving" value={fmtNumber(counts.moving)} tone="good" />
        <StatCard label="Idle" value={fmtNumber(counts.idle)} tone="warn" />
        <StatCard label="No activity" value={fmtNumber(counts.no_activity)} tone="bad" />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <div className="relative min-w-52 flex-1">
          <SearchIcon
            size={14}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <Input name="q" defaultValue={q ?? ""} placeholder="Truck number" className="pl-9" />
        </div>

        <Select name="officer" defaultValue={officer ?? ""} className="w-56">
          <option value="">All officers</option>
          {(officers ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.full_name ?? row.email}
            </option>
          ))}
        </Select>

        <Select name="status" defaultValue={status ?? ""} className="w-40">
          <option value="">Any status</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <button type="submit" className={buttonClass("secondary")}>
          <Filter size={14} />
          Apply
        </button>
        {q || officer || status ? (
          <Link href="/admin/trucks" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <Panel bodyClassName="p-0">
        {error ? (
          <EmptyState title="Could not load trucks" description={error.message} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No trucks under tracking"
            description="Trucks appear here once an officer adds one to their tracking list."
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Truck</th>
              <th className="th">Officer</th>
              <th className="th">Last toll plaza</th>
              <th className="th">Last event</th>
              <th className="th">Alerts on</th>
              <th className="th">Status</th>
              <th className="th">Last check</th>
            </Thead>
            <Tbody>
              {rows.map((truck) => (
                <Tr key={truck.id}>
                  <td className="td">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Mono className="font-semibold text-ink">{truck.truck_number}</Mono>
                      {truck.is_active ? null : <Badge>paused</Badge>}
                    </span>
                    {truck.label ? (
                      <span className="block text-xs text-faint">{truck.label}</span>
                    ) : null}
                  </td>

                  <td className="td">
                    <Link
                      href={`/admin/officers/${truck.user_id}`}
                      className="text-sm text-ink transition hover:text-brand-400"
                    >
                      {truck.profiles?.full_name ?? truck.profiles?.email ?? "--"}
                    </Link>
                  </td>

                  <td className="td">
                    {truck.last_location ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <MapPin size={13} className="shrink-0 text-faint" />
                        {truck.last_location}
                        {truck.last_direction ? (
                          <span className="text-faint">({truck.last_direction})</span>
                        ) : null}
                      </span>
                    ) : (
                      "--"
                    )}
                  </td>

                  <td className="td text-xs whitespace-nowrap text-muted">
                    {fmtDateTime(truck.last_event_at)}
                  </td>

                  <td className="td whitespace-nowrap">
                    {(alertsPerTruck.get(truck.id) ?? 0) === 0 ? (
                      <Badge tone="warn">never checked</Badge>
                    ) : (
                      <span className="text-sm tabular-nums text-ink">
                        {alertsPerTruck.get(truck.id)}
                      </span>
                    )}
                  </td>

                  <td className="td">
                    <Badge tone={STATUS_TONE[truck.status]}>{STATUS_LABEL[truck.status]}</Badge>
                    {truck.consecutive_errors > 0 ? (
                      <span className="mt-1 block text-xs text-bad-500">
                        {truck.consecutive_errors} failed checks
                      </span>
                    ) : null}
                  </td>

                  <td className="td text-xs whitespace-nowrap text-muted">
                    {fmtRelative(truck.last_polled_at)}
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      {rows.length === 300 ? (
        <p className="mt-3 text-xs text-faint">
          Showing the 300 most recently active trucks. Narrow the filters to see more.
        </p>
      ) : null}
    </>
  );
}
