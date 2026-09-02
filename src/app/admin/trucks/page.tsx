import Link from "next/link";
import { Filter, Search as SearchIcon } from "lucide-react";

import { CapNote, pageWindow } from "../pager";
import {
  TRUCK_SORTS,
  TRUCK_STATUS_LABEL,
  TRUCK_TRACKING_LABEL,
  TrucksTable,
  isTruckSort,
  isTruckStatus,
  isTruckTracking,
  narrowTrucks,
  type TruckFilters,
} from "../tables";
import { Input, Select } from "@/components/form";
import { Pager } from "@/components/Pager";
import {
  EmptyState,
  PageHeader,
  Panel,
  StatCard,
  buttonClass,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtNumber, normalizeTruckNumber } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TruckDirectoryRow, TruckStatus } from "@/lib/types";

export const metadata = { title: "Trucks — Admin" };

/** One screenful. Everything past it is a page away, not gone. */
const PAGE_SIZE = 50;

/**
 * Every truck under tracking, across every account.
 *
 * This list and the Trucks tab on a customer's page are the same list at two
 * scales, so the filters, the sorts and the rows themselves come from
 * ../tables. They had already drifted - this one had no sort at all and its own
 * idea of what "paused" was - and one list quietly answering a different
 * question from the other is worse than either being wrong.
 */
export default async function TrucksPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    officer?: string;
    /** How the lorry is moving. Whether it is checked at all is `tracking`. */
    status?: string;
    tracking?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  await requireSuperAdmin();
  // `officer` stays the parameter name: the account page already links here
  // with it, and renaming it would break every one of those links.
  const { q, officer, status, tracking, sort: sortParam, page: pageParam } = await searchParams;
  const admin = getSupabaseAdmin();

  const plate = q ? normalizeTruckNumber(q) : "";
  const statusFilter = isTruckStatus(status) ? status : "";
  const trackingFilter = isTruckTracking(tracking) ? tracking : "";
  const sort = isTruckSort(sortParam) ? sortParam : "event";
  const { column, ascending } = TRUCK_SORTS[sort];

  const filters: TruckFilters = {
    officerId: officer,
    plate,
    status: statusFilter,
    tracking: trackingFilter,
  };

  /**
   * The breakdown deliberately ignores the movement filter, so it stays a map
   * of everything the search matched rather than collapsing to one number the
   * moment a status is picked. Head counts, so nothing is read to count it.
   */
  const countByStatus = (value: TruckStatus) =>
    narrowTrucks(admin.from("truck_directory").select("tracked_truck_id", { count: "exact", head: true }), {
      ...filters,
      status: "",
    }).eq("status", value);

  // truck_directory is the truck joined to the account watching it, so a row
  // here already carries the name, the posting and the alert count.
  const [{ count, error: countError }, { data: accounts }, moving, idle, noActivity, unknown] =
    await Promise.all([
      narrowTrucks(
        admin.from("truck_directory").select("tracked_truck_id", { count: "exact", head: true }),
        filters,
      ),
      admin.from("profiles").select("id, full_name, email").eq("role", "officer").order("full_name"),
      countByStatus("moving"),
      countByStatus("idle"),
      countByStatus("no_activity"),
      countByStatus("unknown"),
    ]);

  // Counted before the page is asked for: a range that starts past the last row
  // comes back as an error with no rows and no total, which would leave a stale
  // ?page= showing an empty list and no way back to the trucks that are there.
  const total = count ?? 0;
  const { page, from, to } = pageWindow(pageParam, total, PAGE_SIZE);

  const { data: trucks, error: rowsError } = await narrowTrucks(
    admin.from("truck_directory").select("*"),
    filters,
  )
    .order(column, { ascending, nullsFirst: false })
    // A tie-break that is unique, so two trucks with the same last crossing
    // cannot swap places between pages and hide one of themselves.
    .order("tracked_truck_id", { ascending: true })
    .range(from, to);

  const error = countError ?? rowsError;
  const rows = (trucks ?? []) as TruckDirectoryRow[];
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

  const filtered = Boolean(q || officer || statusFilter || trackingFilter);

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

        {/* Before the movement status, because "is it even being checked" comes
            first: a paused truck's movement status is meaningless. */}
        <Select name="tracking" defaultValue={trackingFilter} className="w-48">
          <option value="">Live and paused</option>
          {Object.entries(TRUCK_TRACKING_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select name="status" defaultValue={statusFilter} className="w-40">
          <option value="">Any status</option>
          {Object.entries(TRUCK_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select name="sort" defaultValue={sort} className="w-52">
          {Object.entries(TRUCK_SORTS).map(([key, option]) => (
            <option key={key} value={key}>
              Sort by {option.label.toLowerCase()}
            </option>
          ))}
        </Select>

        <button type="submit" className={buttonClass("secondary")}>
          <Filter size={14} />
          Apply
        </button>
        {filtered || sort !== "event" ? (
          <Link href="/admin/trucks" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      <Panel bodyClassName="p-0">
        {error ? (
          <EmptyState title="Could not load trucks" description={error.message} />
        ) : rows.length === 0 ? (
          // A page past the end is not the same as no matches, and saying
          // "nothing found" there would send the reader off to change filters
          // that were working.
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
          <TrucksTable rows={rows} showAccount watchers={watchers} />
        )}
      </Panel>

      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        noun="trucks"
        href={{
          path: "/admin/trucks",
          params: { q, officer, status: statusFilter, tracking: trackingFilter, sort },
        }}
      />

      {total > PAGE_SIZE ? (
        <CapNote>
          “Also watched elsewhere” is checked against every account, not only the rows on this page.
        </CapNote>
      ) : null}
    </>
  );
}
