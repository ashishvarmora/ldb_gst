import Link from "next/link";
import { ChevronDown, MapPin } from "lucide-react";

import { ShowMore } from "@/components/Pager";
import { directionLabel } from "@/components/Timeline";
import { Badge, EmptyState, LinkButton, Mono, TableWrap, Tbody, Thead, Tr } from "@/components/ui";
import { fmtDate, fmtNumber, fmtRelative, fmtTime } from "@/lib/format";
import { stateFromLocation } from "@/lib/geo";
import type { TruckEvent } from "@/lib/types";

/** The columns the grouped view needs. Full rows are only read in the flat view. */
export type RecordRow = Pick<
  TruckEvent,
  "id" | "truck_number" | "loc_name" | "event_time" | "direction"
>;

export type TruckRecordSummary = {
  truckNumber: string;
  crossings: number;
  plazas: number;
  firstSeen: string | null;
  lastSeen: string | null;
  lastPlaza: string | null;
  recent: RecordRow[];
};

/**
 * How many crossings a truck lists inline before pointing at the full list.
 * Deliberately short: an opened truck should still fit on a phone screen, and
 * the rest is one tap away in the paged view.
 */
const INLINE_LIMIT = 10;

/**
 * One entry per truck number, with all of that truck's crossings merged behind
 * it. Rows must arrive newest first - which is how the page queries them - so
 * the first row seen for a truck is its latest crossing.
 */
export function groupByTruck(rows: RecordRow[]): TruckRecordSummary[] {
  const byTruck = new Map<string, { rows: RecordRow[]; plazas: Set<string> }>();

  for (const row of rows) {
    let entry = byTruck.get(row.truck_number);
    if (!entry) {
      entry = { rows: [], plazas: new Set() };
      byTruck.set(row.truck_number, entry);
    }
    entry.rows.push(row);
    if (row.loc_name) entry.plazas.add(row.loc_name);
  }

  return [...byTruck.entries()]
    .map(([truckNumber, entry]) => {
      const latest = entry.rows[0];
      const oldest = entry.rows[entry.rows.length - 1];
      return {
        truckNumber,
        crossings: entry.rows.length,
        plazas: entry.plazas.size,
        firstSeen: oldest.event_time,
        lastSeen: latest.event_time,
        lastPlaza: latest.loc_name,
        recent: entry.rows.slice(0, INLINE_LIMIT),
      };
    })
    .sort((a, b) => (b.lastSeen ?? "").localeCompare(a.lastSeen ?? ""));
}

export function RecordsTruckList({
  groups,
  range,
  filtered,
}: {
  groups: TruckRecordSummary[];
  /** Carried into the per-truck links so they open the same window. */
  range: string;
  filtered: boolean;
}) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title={filtered ? "No truck matches those filters" : "No movements on record"}
        description={
          filtered
            ? "Try a wider date range, or clear the filters."
            : "Records appear here once a truck you have searched or tracked crosses a toll plaza."
        }
        action={filtered ? null : <LinkButton href="/portal/trucks">Add a truck</LinkButton>}
      />
    );
  }

  return (
    <ul className="divide-y divide-divider">
      {groups.map((group) => (
        <li key={group.truckNumber}>
          <details className="group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 transition hover:bg-raised/60 [&::-webkit-details-marker]:hidden">
              <ChevronDown
                size={14}
                className="shrink-0 text-faint transition group-open:rotate-180"
              />
              <Mono className="font-semibold text-ink">{group.truckNumber}</Mono>
              <Badge tone="brand">
                {fmtNumber(group.crossings)} crossing{group.crossings === 1 ? "" : "s"}
              </Badge>

              <span className="flex w-full min-w-0 flex-wrap items-center gap-x-2 pl-7 text-xs text-muted sm:ml-auto sm:w-auto sm:justify-end sm:pl-0">
                <MapPin size={11} className="shrink-0 text-faint" />
                <span className="truncate">{group.lastPlaza ?? "Unnamed plaza"}</span>
                <span className="text-faint">·</span>
                <span className="whitespace-nowrap">{fmtRelative(group.lastSeen)}</span>
              </span>
            </summary>

            <div className="border-t border-divider bg-raised/40">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 px-4 py-3 sm:grid-cols-4">
                <Fact label="First seen" value={fmtDate(group.firstSeen)} />
                <Fact label="Last seen" value={fmtDate(group.lastSeen)} />
                <Fact label="Distinct plazas" value={fmtNumber(group.plazas)} />
                <Fact label="Crossings" value={fmtNumber(group.crossings)} />
              </dl>

              <TableWrap>
                <Thead>
                  <th className="th">When</th>
                  <th className="th">Toll plaza</th>
                  <th className="th">Direction</th>
                </Thead>
                <Tbody>
                  {group.recent.map((row) => (
                    <Tr key={row.id}>
                      <td className="td whitespace-nowrap">
                        <span className="block text-sm text-ink">{fmtDate(row.event_time)}</span>
                        <span className="block text-xs text-muted">{fmtTime(row.event_time)}</span>
                      </td>
                      <td className="td">
                        <span className="block text-sm">{row.loc_name ?? "Unnamed plaza"}</span>
                        {stateFromLocation(row.loc_name) ? (
                          <span className="block text-xs text-muted">
                            {stateFromLocation(row.loc_name)}
                          </span>
                        ) : null}
                      </td>
                      <td className="td text-sm whitespace-nowrap text-muted">
                        {directionLabel(row.direction) ?? "--"}
                      </td>
                    </Tr>
                  ))}
                </Tbody>
              </TableWrap>

              <div className="border-t border-divider px-3 py-2">
                {group.crossings > group.recent.length ? (
                  <ShowMore
                    href={`/portal/records?view=all&truck=${group.truckNumber}&range=${range}`}
                    remaining={group.crossings - group.recent.length}
                    noun="more crossings"
                  />
                ) : null}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1 text-xs">
                  <Link
                    href={`/portal/records?view=all&truck=${group.truckNumber}&range=${range}`}
                    className="font-medium text-brand-500 hover:underline"
                  >
                    All crossings for this truck
                  </Link>
                  <Link
                    href={`/portal/search/${group.truckNumber}`}
                    className="font-medium text-brand-500 hover:underline"
                  >
                    Open its route
                  </Link>
                </div>
              </div>
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm tabular-nums text-ink">{value}</dd>
    </div>
  );
}
