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
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, normalizeTruckNumber } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TruckDirectoryRow, TruckStatus } from "@/lib/types";

export const metadata = { title: "Trucks — Admin" };

/** One page of the fleet. Narrowing the filters is how you see past it. */
const LIMIT = 300;

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

export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; officer?: string; status?: string }>;
}) {
  await requireSuperAdmin();
  const { q, officer, status } = await searchParams;
  const admin = getSupabaseAdmin();

  // truck_directory is the truck joined to the officer watching it, so a row
  // here already carries the name, the posting and the alert count.
  let query = admin
    .from("truck_directory")
    .select("*")
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .limit(LIMIT);

  if (officer) query = query.eq("officer_id", officer);
  if (status && status in STATUS_LABEL) query = query.eq("status", status);
  if (q) query = query.ilike("truck_number", `%${normalizeTruckNumber(q)}%`);

  const [{ data: trucks, error }, { data: officers }] = await Promise.all([
    query,
    admin.from("profiles").select("id, full_name, email").eq("role", "officer").order("full_name"),
  ]);

  const rows = (trucks ?? []) as TruckDirectoryRow[];

  const counts = rows.reduce<Record<TruckStatus, number>>(
    (acc, row) => {
      acc[row.status] += 1;
      return acc;
    },
    { moving: 0, idle: 0, no_activity: 0, unknown: 0 },
  );

  // The same number watched by two officers is the one thing on this page that
  // is worth a second look, so it is marked rather than left to be spotted.
  const officersPerNumber = new Map<string, number>();
  for (const row of rows) {
    officersPerNumber.set(row.truck_number, (officersPerNumber.get(row.truck_number) ?? 0) + 1);
  }
  const shared = [...officersPerNumber.values()].filter((n) => n > 1).length;

  return (
    <>
      <PageHeader
        title="Trucks"
        subtitle="Every truck under background tracking, with the officer watching it. A truck is checked only when one of its alerts falls due. Read-only — officers manage their own lists."
        actions={
          <Link href="/admin/explore" className={buttonClass("secondary")}>
            <SearchIcon size={14} />
            Cross-reference a number
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Under tracking" value={fmtNumber(rows.length)} tone="brand" />
        <StatCard label="Moving" value={fmtNumber(counts.moving)} tone="good" />
        <StatCard label="Idle" value={fmtNumber(counts.idle)} tone="warn" />
        <StatCard
          label="Watched by two or more"
          value={fmtNumber(shared)}
          sub={shared > 0 ? "Numbers on more than one officer's list" : "No overlap in these rows"}
          tone={shared > 0 ? "warn" : "neutral"}
        />
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
            title={q || officer || status ? "No trucks match those filters" : "No trucks under tracking"}
            description={
              q || officer || status
                ? "Try clearing the filters."
                : "Trucks appear here once an officer adds one to their tracking list."
            }
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Truck</th>
              <th className="th">Officer</th>
              <th className="th">Posting</th>
              <th className="th">Last toll plaza</th>
              <th className="th">Last event</th>
              <th className="th">Status</th>
              <th className="th text-right">Alerts</th>
              <th className="th">Last check</th>
              <th className="th">Added</th>
            </Thead>
            <Tbody>
              {rows.map((truck) => (
                <Tr key={truck.tracked_truck_id}>
                  <td className="td">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/admin/explore?q=${truck.truck_number}`}
                        className="transition hover:text-brand-500"
                      >
                        <Mono className="font-semibold text-ink">{truck.truck_number}</Mono>
                      </Link>
                      {truck.is_active ? null : <Badge>paused</Badge>}
                      {(officersPerNumber.get(truck.truck_number) ?? 0) > 1 ? (
                        <Badge tone="warn">also watched elsewhere</Badge>
                      ) : null}
                    </span>
                    {truck.label ? (
                      <span className="block text-xs text-faint">{truck.label}</span>
                    ) : null}
                  </td>

                  <td className="td">
                    <Link
                      href={`/admin/officers/${truck.officer_id}`}
                      className="block text-sm text-ink transition hover:text-brand-400"
                    >
                      {truck.officer_name ?? truck.officer_email}
                    </Link>
                    <span className="block truncate text-xs text-faint">
                      {truck.officer_phone ?? truck.officer_email}
                    </span>
                  </td>

                  <td className="td">
                    <span className="block text-sm text-ink">{truck.office ?? "--"}</span>
                    <span className="block text-xs text-faint">
                      {[truck.district, truck.state].filter(Boolean).join(", ") || "--"}
                    </span>
                  </td>

                  <td className="td">
                    {truck.last_location ? (
                      <span className="flex items-center gap-1.5 text-sm">
                        <MapPin size={13} className="shrink-0 text-faint" />
                        {truck.last_location}
                      </span>
                    ) : (
                      "--"
                    )}
                  </td>

                  <td className="td text-xs whitespace-nowrap text-muted">
                    {fmtDateTime(truck.last_event_at)}
                  </td>

                  <td className="td">
                    <Badge tone={STATUS_TONE[truck.status]}>{STATUS_LABEL[truck.status]}</Badge>
                  </td>

                  <td className="td text-right whitespace-nowrap">
                    {truck.alert_count === 0 ? (
                      <Badge tone="warn">never checked</Badge>
                    ) : (
                      <span className="text-sm tabular-nums text-ink">{truck.alert_count}</span>
                    )}
                  </td>

                  <td className="td text-xs whitespace-nowrap text-muted">
                    {fmtRelative(truck.last_polled_at)}
                  </td>

                  <td className="td text-xs whitespace-nowrap text-muted">
                    {fmtDate(truck.created_at)}
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      {rows.length === LIMIT ? (
        <p className="mt-3 text-xs text-faint">
          Showing the {LIMIT} most recently active trucks. Narrow the filters to see more.
        </p>
      ) : null}
    </>
  );
}
