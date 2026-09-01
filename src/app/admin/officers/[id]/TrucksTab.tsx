import Link from "next/link";
import { Filter, Search } from "lucide-react";

import type { AccountParams } from "./TabStrip";
import { Input, Select } from "@/components/form";
import { Pager, pageFromParam } from "@/components/Pager";
import {
  Badge,
  EmptyState,
  Mono,
  Panel,
  QuotaBar,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { BadgeTone } from "@/components/ui";
import type { OfficerOverview, TruckDirectoryRow, TruckStatus } from "@/lib/types";

const PER_PAGE = 25;

const STATUS_TONE: Record<TruckStatus, BadgeTone> = {
  moving: "good",
  idle: "warn",
  no_activity: "bad",
  unknown: "neutral",
};

const STATUS_LABEL: Record<TruckStatus, string> = {
  moving: "Moving",
  idle: "Idle",
  no_activity: "No activity",
  unknown: "Unknown",
};

/**
 * The orders that answer a real question about a fleet: what moved last, what
 * has gone quiet, what nobody is watching, and what was added when.
 */
const SORTS = {
  event: { label: "Last crossing", column: "last_event_at", ascending: false },
  added: { label: "Recently added", column: "created_at", ascending: false },
  number: { label: "Truck number", column: "truck_number", ascending: true },
  alerts: { label: "Fewest alerts", column: "alert_count", ascending: true },
  events: { label: "Most crossings", column: "event_count", ascending: false },
} as const;

type SortKey = keyof typeof SORTS;

function isSort(value: string | undefined): value is SortKey {
  return value !== undefined && value in SORTS;
}

function isStatus(value: string | undefined): value is TruckStatus {
  return value === "moving" || value === "idle" || value === "no_activity" || value === "unknown";
}

/**
 * Every truck this account has under tracking. Read-only here - trucks are
 * added and removed from the customer's own dashboard, and an admin quietly
 * deleting one would be a surprise nobody can explain.
 */
export async function TrucksTab({
  id,
  overview,
  params,
}: {
  id: string;
  overview: OfficerOverview;
  params: AccountParams;
}) {
  const admin = getSupabaseAdmin();

  const q = params.tq?.trim() || undefined;
  const status = params.tstatus;
  const sort: SortKey = isSort(params.tsort) ? params.tsort : "event";
  const page = pageFromParam(params.tpage);
  const { column, ascending } = SORTS[sort];

  // truck_directory already carries the alert and event counts, so the table is
  // one query rather than one per truck.
  let query = admin
    .from("truck_directory")
    .select("*", { count: "exact" })
    .eq("officer_id", id)
    .order(column, { ascending, nullsFirst: false })
    .range((page - 1) * PER_PAGE, page * PER_PAGE - 1);

  if (isStatus(status)) query = query.eq("status", status);
  else if (status === "paused") query = query.eq("is_active", false);
  else if (status === "unwatched") query = query.eq("alert_count", 0);
  if (q) query = query.ilike("truck_number", `%${q.toUpperCase().replace(/[^A-Z0-9]/g, "")}%`);

  const [{ data, count }, { data: spendRows }] = await Promise.all([
    query,
    admin
      .from("credit_ledger_daily")
      .select("truck_number, credits")
      .eq("user_id", id)
      .lt("credits", 0),
  ]);
  const trucks = (data ?? []) as TruckDirectoryRow[];
  const filtered = Boolean(q || status);

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

        <Select name="tstatus" defaultValue={status ?? ""} className="w-44 py-1.5 text-xs">
          <option value="">Any state</option>
          <option value="moving">Moving</option>
          <option value="idle">Idle</option>
          <option value="no_activity">No activity</option>
          <option value="unknown">Never seen</option>
          <option value="paused">Paused</option>
          <option value="unwatched">No alert switched on</option>
        </Select>

        <Select name="tsort" defaultValue={sort} className="w-48 py-1.5 text-xs">
          {Object.entries(SORTS).map(([key, option]) => (
            <option key={key} value={key}>
              Sort by {option.label.toLowerCase()}
            </option>
          ))}
        </Select>

        <button type="submit" className={buttonClass("secondary", "sm")}>
          <Filter size={13} />
          Apply
        </button>
        {filtered ? (
          <Link
            href={`/admin/officers/${id}?tab=trucks`}
            className={buttonClass("ghost", "sm")}
          >
            Clear
          </Link>
        ) : null}
      </form>

      {trucks.length === 0 ? (
        <EmptyState
          title={filtered ? "No trucks match those filters" : "No trucks under tracking"}
          description={
            filtered
              ? "Try clearing the filters."
              : "Nothing is being checked for this account yet."
          }
        />
      ) : (
        <>
          <TableWrap>
            <Thead>
              <th className="th">Truck</th>
              <th className="th">Tracking</th>
              <th className="th text-right">Credits used</th>
              <th className="th text-right">Alerts on</th>
              <th className="th">Last checked</th>
              <th className="th text-right">Crossings</th>
              <th className="th">Added</th>
            </Thead>
            <Tbody>
              {trucks.map((truck) => (
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
                    </span>
                    {truck.label ? (
                      <span className="block text-xs text-faint">{truck.label}</span>
                    ) : null}
                  </td>
                  <td className="td">
                    {truck.is_active ? (
                      <Badge tone={STATUS_TONE[truck.status]}>{STATUS_LABEL[truck.status]}</Badge>
                    ) : (
                      <Badge>paused</Badge>
                    )}
                  </td>
                  <td className="td text-right text-sm tabular-nums text-ink">
                    {spentByTruck.get(truck.truck_number)
                      ? formatCredits(spentByTruck.get(truck.truck_number)!)
                      : <span className="text-faint">0</span>}
                  </td>
                  <td className="td text-right">
                    {truck.alert_count === 0 ? (
                      <Badge tone="warn">none</Badge>
                    ) : (
                      <span className="text-sm tabular-nums text-ink">{truck.alert_count}</span>
                    )}
                  </td>
                  <td className="td text-xs whitespace-nowrap text-muted">
                    {fmtRelative(truck.last_polled_at)}
                  </td>
                  <td className="td text-right text-sm tabular-nums text-muted">
                    {fmtNumber(truck.event_count)}
                  </td>
                  <td className="td text-xs whitespace-nowrap text-muted">
                    {fmtDate(truck.created_at)}
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>

          <Pager
            className="border-t border-divider px-5 py-3"
            page={page}
            total={count ?? trucks.length}
            pageSize={PER_PAGE}
            noun="trucks"
            href={{
              path: `/admin/officers/${id}`,
              params: { tab: "trucks", tq: q, tstatus: status, tsort: sort },
              pageKey: "tpage",
            }}
          />
        </>
      )}

      <p className="border-t border-divider px-5 py-3 text-xs leading-relaxed text-muted">
        A truck with no alert switched on is never checked, so it costs nothing and never moves.
        Filter by <span className="text-ink">no alert switched on</span> to find those.
      </p>
    </Panel>
  );
}
