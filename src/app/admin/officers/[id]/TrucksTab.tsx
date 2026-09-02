import Link from "next/link";
import { Filter, Search } from "lucide-react";

import type { AccountParams } from "./TabStrip";
import { pageWindow } from "../../pager";
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
} from "../../tables";
import { Input, Select } from "@/components/form";
import { Pager } from "@/components/Pager";
import {
  EmptyState,
  Panel,
  QuotaBar,
  buttonClass,
} from "@/components/ui";
import { normalizeTruckNumber } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview, TruckDirectoryRow } from "@/lib/types";

const PER_PAGE = 25;

/**
 * What this tab reads out of the query string.
 *
 * AccountParams lives beside the tab strip and lists what the account page's
 * tabs were known to use; ttracking is new here. Next hands every query
 * parameter through whether or not that type mentions it, so naming the shape
 * this tab needs is honest about the extra one rather than casting at the point
 * of use.
 */
type TruckTabParams = AccountParams & { ttracking?: string };

/**
 * Every truck this account has under tracking. Read-only here - trucks are
 * added and removed from the customer's own dashboard, and an admin quietly
 * deleting one would be a surprise nobody can explain.
 *
 * The same list as /admin/trucks, narrowed to one account, so the filters, the
 * sorts and the rows come from ../../tables rather than being written a second
 * time here. The parameters keep their t- prefix because this tab shares a
 * query string with the other four.
 */
export async function TrucksTab({
  id,
  overview,
  params,
}: {
  id: string;
  overview: OfficerOverview;
  params: TruckTabParams;
}) {
  const admin = getSupabaseAdmin();

  const q = params.tq?.trim() || undefined;
  const plate = q ? normalizeTruckNumber(q) : "";
  const status = isTruckStatus(params.tstatus) ? params.tstatus : "";
  /*
   * tstatus used to carry "paused" and "unwatched" alongside the movement
   * states. Those are tracking states now - whether the platform checks this
   * lorry at all is a different question from how it last moved - so an old
   * link is read as the filter it meant rather than silently losing it.
   */
  const tracking = isTruckTracking(params.ttracking)
    ? params.ttracking
    : isTruckTracking(params.tstatus)
      ? params.tstatus
      : "";
  const sort = isTruckSort(params.tsort) ? params.tsort : "event";
  const { column, ascending } = TRUCK_SORTS[sort];

  const filters: TruckFilters = { officerId: id, plate, status, tracking };

  // The count first, so a stale ?tpage= is clamped to a page that exists:
  // PostgREST answers a range past the last row with an error and no total,
  // which would render as an empty tab with no link back.
  const { count } = await narrowTrucks(
    admin.from("truck_directory").select("tracked_truck_id", { count: "exact", head: true }),
    filters,
  );
  const total = count ?? 0;
  const { page, from, to } = pageWindow(params.tpage, total, PER_PAGE);

  // truck_directory already carries the alert and event counts, so the table is
  // one query rather than one per truck.
  const [{ data }, { data: spendRows }] = await Promise.all([
    narrowTrucks(admin.from("truck_directory").select("*"), filters)
      .order(column, { ascending, nullsFirst: false })
      .order("tracked_truck_id", { ascending: true })
      .range(from, to),
    admin
      .from("credit_ledger_daily")
      .select("truck_number, credits")
      .eq("user_id", id)
      .lt("credits", 0),
  ]);

  const trucks = (data ?? []) as TruckDirectoryRow[];
  const filtered = Boolean(q || status || tracking);

  /* Credits spent per truck, across the whole ledger - the admin's question is
     "what has this lorry cost", not "what did it cost this page". */
  const spentByTruck = new Map<string, number>();
  for (const row of (spendRows ?? []) as { truck_number: string | null; credits: number }[]) {
    if (!row.truck_number) continue;
    spentByTruck.set(
      row.truck_number,
      (spentByTruck.get(row.truck_number) ?? 0) + Math.abs(Number(row.credits) || 0),
    );
  }

  return (
    <Panel
      title="Trucks under tracking"
      description="Read-only. Trucks are added and removed from the customer's own dashboard."
      bodyClassName="p-0"
      actions={
        <span className="w-40">
          <QuotaBar
            used={overview.active_trucks}
            limit={overview.truck_limit}
            label={`of ${formatLimit(overview.truck_limit).toLowerCase()}`}
          />
        </span>
      }
    >
      <form
        method="get"
        className="flex flex-wrap items-end gap-2 border-b border-divider px-5 py-3"
      >
        <input type="hidden" name="tab" value="trucks" />

        <div className="relative min-w-44 flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <Input
            name="tq"
            defaultValue={q ?? ""}
            placeholder="Truck number"
            className="py-1.5 pl-8 text-xs"
          />
        </div>

        {/* Whether it is being checked at all comes before how it last moved,
            the same order the platform-wide list puts them in. */}
        <Select name="ttracking" defaultValue={tracking} className="w-48 py-1.5 text-xs">
          <option value="">Live and paused</option>
          {Object.entries(TRUCK_TRACKING_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select name="tstatus" defaultValue={status} className="w-40 py-1.5 text-xs">
          <option value="">Any status</option>
          {Object.entries(TRUCK_STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>

        <Select name="tsort" defaultValue={sort} className="w-48 py-1.5 text-xs">
          {Object.entries(TRUCK_SORTS).map(([key, option]) => (
            <option key={key} value={key}>
              Sort by {option.label.toLowerCase()}
            </option>
          ))}
        </Select>

        <button type="submit" className={buttonClass("secondary", "sm")}>
          <Filter size={13} />
          Apply
        </button>
        {filtered || sort !== "event" ? (
          <Link href={`/admin/officers/${id}?tab=trucks`} className={buttonClass("ghost", "sm")}>
            Clear
          </Link>
        ) : null}
      </form>

      {trucks.length === 0 ? (
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
                : "Nothing is being checked for this account yet."
          }
        />
      ) : (
        <TrucksTable rows={trucks} spentByTruck={spentByTruck} />
      )}

      {/* Outside the branch above: a page with no rows on it is exactly when
          the reader needs the link back to the pages that have some. */}
      <Pager
        className="border-t border-divider px-5 py-3"
        page={page}
        total={total}
        pageSize={PER_PAGE}
        noun="trucks"
        href={{
          path: `/admin/officers/${id}`,
          params: { tab: "trucks", tq: q, tstatus: status, ttracking: tracking, tsort: sort },
          pageKey: "tpage",
        }}
      />

      <p className="border-t border-divider px-5 py-3 text-xs leading-relaxed text-muted">
        A truck with no alert switched on is never checked, so it costs nothing and never moves.
        Filter by <span className="text-ink">no alert switched on</span> to find those.
      </p>
    </Panel>
  );
}
