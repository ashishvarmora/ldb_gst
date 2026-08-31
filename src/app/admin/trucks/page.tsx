import Link from "next/link";
import { Filter, MapPin, Search as SearchIcon } from "lucide-react";

import { CapNote, pageRange } from "../pager";
import { Input, Select } from "@/components/form";
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
import { requireSuperAdmin } from "@/lib/auth";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, normalizeTruckNumber } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TruckDirectoryRow, TruckStatus } from "@/lib/types";

export const metadata = { title: "Trucks — Admin" };

/** One screenful. Everything past it is a page away, not gone. */
const PAGE_SIZE = 50;

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
  searchParams: Promise<{ q?: string; officer?: string; status?: string; page?: string }>;
}) {
  await requireSuperAdmin();
  // `officer` stays the parameter name: the account page already links here
  // with it, and renaming it would break every one of those links.
  const { q, officer, status, page: pageParam } = await searchParams;
  const admin = getSupabaseAdmin();

  const plate = q ? normalizeTruckNumber(q) : "";
  const statusFilter = status && status in STATUS_LABEL ? (status as TruckStatus) : "";
  const requested = pageFromParam(pageParam);
  const { from, to } = pageRange(requested, PAGE_SIZE);

  // truck_directory is the truck joined to the account watching it, so a row
  // here already carries the name, the posting and the alert count.
  let query = admin
    .from("truck_directory")
    .select("*", { count: "exact" })
    .order("last_event_at", { ascending: false, nullsFirst: false })
    .order("tracked_truck_id", { ascending: true })
    .range(from, to);

  if (officer) query = query.eq("officer_id", officer);
  if (statusFilter) query = query.eq("status", statusFilter);
  if (plate) query = query.ilike("truck_number", `%${plate}%`);

  /**
   * The breakdown deliberately ignores the status filter, so it stays a map of
   * everything the search matched rather than collapsing to one number the
   * moment a status is picked. Head counts, so nothing is read to count it.
   */
  const countByStatus = (value: TruckStatus) => {
    let counter = admin
      .from("truck_directory")
      .select("tracked_truck_id", { count: "exact", head: true })
      .eq("status", value);
    if (officer) counter = counter.eq("officer_id", officer);
    if (plate) counter = counter.ilike("truck_number", `%${plate}%`);
    return counter;
  };

  const [
    { data: trucks, error, count },
    { data: accounts },
    moving,
    idle,
    noActivity,
    unknown,
  ] = await Promise.all([
    query,
    admin.from("profiles").select("id, full_name, email").eq("role", "officer").order("full_name"),
    countByStatus("moving"),
    countByStatus("idle"),
    countByStatus("no_activity"),
    countByStatus("unknown"),
  ]);

  const rows = (trucks ?? []) as TruckDirectoryRow[];
  const total = count ?? rows.length;
  const matching =
    (moving.count ?? 0) + (idle.count ?? 0) + (noActivity.count ?? 0) + (unknown.count ?? 0);

  /**
   * The same number watched by two accounts is the one thing on this page worth
   * a second look. Counting it from the rows on screen would have made it a
   * lie the moment the list was paged, so the watchers of exactly these numbers
   * are looked up - a narrow query over a handful of plates.
   */
  const numbers = [...new Set(rows.map((row) => row.truck_number))];
  const watchers = new Map<string, number>();
  if (numbers.length > 0) {
    const { data: sharing } = await admin
      .from("truck_directory")
      .select("truck_number, officer_id")
      .in("truck_number", numbers);

    const seen = new Map<string, Set<string>>();
    for (const row of (sharing ?? []) as { truck_number: string; officer_id: string }[]) {
      const set = seen.get(row.truck_number) ?? new Set<string>();
      set.add(row.officer_id);
      seen.set(row.truck_number, set);
    }
    for (const [number, set] of seen) watchers.set(number, set.size);
  }

  const filtered = Boolean(q || officer || statusFilter);

  return (
    <>
      <PageHeader
        title="Trucks"
        subtitle="Every truck under background tracking, with the account watching it. A truck is checked only when one of its alerts falls due. Read-only — each account manages its own list."
        actions={
          <Link href="/admin/explore" className={buttonClass("secondary")}>
            <SearchIcon size={14} />
            Cross-reference a number
          </Link>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Under tracking"
          value={fmtNumber(matching)}
          sub={filtered ? "Matching this search" : "Across every account"}
          tone="brand"
        />
        <StatCard label="Moving" value={fmtNumber(moving.count ?? 0)} tone="good" />
        <StatCard label="Idle" value={fmtNumber(idle.count ?? 0)} tone="warn" />
        <StatCard
          label="No activity"
          value={fmtNumber(noActivity.count ?? 0)}
          tone={(noActivity.count ?? 0) > 0 ? "bad" : "neutral"}
          sub={`${fmtNumber(unknown.count ?? 0)} never reported`}
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
          <option value="">All accounts</option>
          {(accounts ?? []).map((row) => (
            <option key={row.id} value={row.id}>
              {row.full_name ?? row.email}
            </option>
          ))}
        </Select>

        <Select name="status" defaultValue={statusFilter} className="w-40">
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
        {filtered ? (
          <Link href="/admin/trucks" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <Panel bodyClassName="p-0">
        {error ? (
          <EmptyState title="Could not load trucks" description={error.message} />
        ) : rows.length === 0 ? (
          // A hand-typed ?page= past the end is not the same as no matches, and
          // saying "nothing found" there would send the reader off to change
          // filters that were working.
          <EmptyState
            title={
              total > 0
                ? "That page is past the end of the list"
                : filtered
                  ? "No trucks match those filters"
                  : "No trucks under tracking"
            }
            description={
              total > 0
                ? "Use the page links below to get back."
                : filtered
                  ? "Try clearing the filters."
                  : "Trucks appear here once an account adds one to its tracking list."
            }
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Truck</th>
              <th className="th">Account</th>
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
                      {(watchers.get(truck.truck_number) ?? 0) > 1 ? (
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

      <Pager
        page={requested}
        pageSize={PAGE_SIZE}
        total={total}
        noun="trucks"
        href={{ path: "/admin/trucks", params: { q, officer, status: statusFilter } }}
      />

      {total > PAGE_SIZE ? (
        <CapNote>
          Sorted by most recent toll event. “Also watched elsewhere” is checked against every
          account, not only the rows on this page.
        </CapNote>
      ) : null}
    </>
  );
}
