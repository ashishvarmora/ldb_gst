import Link from "next/link";
import { ArrowRight, ExternalLink, MapPin } from "lucide-react";

import { Pager, pageFromParam, pageSlice } from "@/components/Pager";
import {
  RECORD_RANGES,
  RecordsControls,
  type RecordsQuery,
  type RecordsView,
} from "@/components/RecordsFilters";
import { RecordsTruckList, groupByTruck, type RecordRow } from "@/components/RecordsTruckList";
import { directionLabel } from "@/components/Timeline";
import {
  EmptyState,
  LinkButton,
  Mono,
  PageHeader,
  Panel,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  cx,
} from "@/components/ui";
import { reportError } from "@/lib/errors";
import { fmtDate, fmtNumber, fmtRelative, fmtTime, istDaysAgo, istToday } from "@/lib/format";
import { stateFromLocation } from "@/lib/geo";
import { requirePortalSession } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TruckEvent } from "@/lib/types";

/** Rows per page in the flat log, and trucks per page in the grouped view. */
const PAGE_SIZE = 50;
const TRUCK_PAGE_SIZE = 12;

/**
 * How many rows the summaries and the by-truck view read. Well past what any
 * account's retention window holds, and a hard stop so one enormous account
 * cannot stall the page.
 */
const SUMMARY_LIMIT = 5000;

/** The longest day strip worth drawing on a phone. */
const MAX_STRIP_DAYS = 30;

export async function generateMetadata() {
  const { brandName } = await loadSettings(getSupabaseAdmin());
  return { title: `Records — ${brandName}` };
}

/**
 * Every toll crossing on record, read two ways.
 *
 * "By truck" merges all of a truck's crossings into one row - the question most
 * people start with. "All crossings" is the flat, filterable, exportable log for
 * when they already know what they are looking for.
 *
 * The summaries below the list are the reason to keep records at all: when the
 * movement happens, where it concentrates, and which legs repeat.
 */
export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<RecordsQuery>;
}) {
  const { overview } = await requirePortalSession();
  // Retention is one platform setting now, not a per-account allowance.
  const { dataRetentionDays: retentionDays } = await loadSettings(getSupabaseAdmin());
  const params = await searchParams;
  const admin = getSupabaseAdmin();

  const view: RecordsView = params.view === "all" ? "all" : "trucks";
  const range = RECORD_RANGES.some((r) => r.key === params.range) ? params.range! : "7";
  const since = range === "all" ? null : `${istDaysAgo(Number(range))}T00:00:00+05:30`;
  const page = pageFromParam(params.page);
  const from = (page - 1) * PAGE_SIZE;

  // The summary query is deliberately unfiltered apart from the date range: the
  // truck dropdown has to keep listing every truck even once one is picked, so
  // the remaining filters are applied below in memory over the same rows.
  let summaryQuery = admin
    .from("truck_events")
    .select("id, truck_number, loc_name, event_time, direction")
    .eq("user_id", overview.id)
    .order("event_time", { ascending: false, nullsFirst: false })
    .limit(SUMMARY_LIMIT);
  if (since) summaryQuery = summaryQuery.gte("event_time", since);

  let pageQuery = admin
    .from("truck_events")
    .select("*")
    .eq("user_id", overview.id)
    .order("event_time", { ascending: false, nullsFirst: false })
    .range(from, from + PAGE_SIZE - 1);
  if (since) pageQuery = pageQuery.gte("event_time", since);
  if (params.truck) pageQuery = pageQuery.eq("truck_number", params.truck);
  if (params.direction) pageQuery = pageQuery.eq("direction", params.direction);
  if (params.q) pageQuery = pageQuery.ilike("loc_name", `%${params.q}%`);

  const [summary, flat] = await Promise.all([summaryQuery, view === "all" ? pageQuery : null]);

  const error = summary.error;
  const inRange = (summary.data ?? []) as RecordRow[];
  const trucks = [...new Set(inRange.map((row) => row.truck_number))].sort();

  const plazaFilter = params.q?.trim().toLowerCase();
  const scoped = inRange.filter(
    (row) =>
      (!params.truck || row.truck_number === params.truck) &&
      (!params.direction || row.direction === params.direction) &&
      (!plazaFilter || (row.loc_name ?? "").toLowerCase().includes(plazaFilter)),
  );

  const groups = groupByTruck(scoped);
  const distinctPlazas = new Set(scoped.map((row) => row.loc_name).filter(Boolean)).size;
  // Undated crossings sort to the end, so the period is read off the dated ones.
  const dated = scoped.filter((row) => row.event_time);
  const newest = dated[0]?.event_time ?? null;
  const oldest = dated[dated.length - 1]?.event_time ?? null;
  const spanDays =
    newest && oldest
      ? Math.max(1, Math.round((Date.parse(newest) - Date.parse(oldest)) / 86_400_000) + 1)
      : 0;

  const byPlaza = new Map<string, number>();
  for (const row of scoped) {
    const plaza = row.loc_name ?? "Unnamed plaza";
    byPlaza.set(plaza, (byPlaza.get(plaza) ?? 0) + 1);
  }
  const topPlazas = [...byPlaza.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);

  // "Everything kept" can span years, which no strip can draw - so it ends at
  // the newest crossing rather than at today, and never runs longer than a month.
  const stripDays = range === "all" ? MAX_STRIP_DAYS : Math.min(Number(range), MAX_STRIP_DAYS);
  const stripAnchor = range === "all" && newest ? istPartsOf(newest).date : istToday();
  const daily = dailyCounts(scoped, stripDays, stripAnchor);
  const hours = hourCounts(scoped);
  const routes = topRoutes(scoped);

  const events = (flat?.data ?? []) as TruckEvent[];
  const filtered = Boolean(params.truck || params.q || params.direction);
  const capped = inRange.length === SUMMARY_LIMIT;

  const truckPage = pageSlice(groups, page, TRUCK_PAGE_SIZE);

  const exportQuery = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, range })) {
    if (value && key !== "page" && key !== "view") exportQuery.set(key, value);
  }

  // Every filter is carried through a page change; only the page itself moves.
  const pagerHrefBase = { path: "/portal/records", params: { ...params, view, range } };

  return (
    <>
      <PageHeader
        title="Records"
        subtitle="Every toll crossing your trucks have made, by truck or as one flat log."
      />

      <div className="mb-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <StatCard
          label="Crossings"
          value={fmtNumber(scoped.length)}
          sub={range === "all" ? "everything kept" : `in the last ${range} days`}
          tone="brand"
        />
        <StatCard label="Trucks" value={fmtNumber(groups.length)} sub="with a crossing" />
        <StatCard label="Toll plazas" value={fmtNumber(distinctPlazas)} sub="distinct" />
        <StatCard
          label="Per day"
          value={spanDays > 0 ? (scoped.length / spanDays).toFixed(1) : "--"}
          sub={spanDays > 0 ? `across ${fmtNumber(spanDays)} days` : "no crossings"}
        />
      </div>

      <RecordsControls
        params={params}
        view={view}
        range={range}
        trucks={trucks}
        exportHref={`/portal/records/export?${exportQuery}`}
      />

      {capped ? (
        <p className="mb-3 rounded-lg border border-line bg-panel px-3 py-2 text-xs leading-relaxed text-muted">
          This range holds more than {fmtNumber(SUMMARY_LIMIT)} crossings. The figures cover the
          newest {fmtNumber(SUMMARY_LIMIT)} — narrow the date range for exact totals.
        </p>
      ) : null}

      <Panel bodyClassName="p-0">
        {error ? (
          <EmptyState
            title="Could not load records"
            description={reportError("records query", error)}
          />
        ) : view === "trucks" ? (
          <RecordsTruckList groups={truckPage} range={range} filtered={filtered} />
        ) : events.length === 0 ? (
          <EmptyState
            title={filtered ? "Nothing matches those filters" : "No movements on record"}
            description={
              filtered
                ? "Try a wider date range, or clear the filters."
                : "Records appear here once a truck you have searched or tracked crosses a toll plaza."
            }
            action={filtered ? null : <LinkButton href="/portal/trucks">Add a truck</LinkButton>}
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">When</th>
              <th className="th">Truck</th>
              <th className="th">Toll plaza</th>
              <th className="th">Direction</th>
              <th className="th">Map</th>
            </Thead>
            <Tbody>
              {events.map((event) => (
                <Tr key={event.id}>
                  <td className="td whitespace-nowrap">
                    <span className="block text-sm text-ink">{fmtDate(event.event_time)}</span>
                    <span className="block text-xs text-muted">
                      {fmtTime(event.event_time)} · {fmtRelative(event.event_time)}
                    </span>
                  </td>
                  <td className="td">
                    <Link
                      href={`/portal/search/${event.truck_number}`}
                      className="transition hover:text-brand-500"
                    >
                      <Mono className="font-semibold">{event.truck_number}</Mono>
                    </Link>
                  </td>
                  <td className="td">
                    <span className="flex items-center gap-1.5 text-sm">
                      <MapPin size={13} className="shrink-0 text-faint" />
                      {event.loc_name ?? "Unnamed plaza"}
                    </span>
                    {stateFromLocation(event.loc_name) ? (
                      <span className="mt-0.5 block text-xs text-muted">
                        {stateFromLocation(event.loc_name)}
                      </span>
                    ) : null}
                  </td>
                  <td className="td text-sm whitespace-nowrap text-muted">
                    {directionLabel(event.direction) ?? "--"}
                  </td>
                  <td className="td">
                    {event.lat !== null && event.lng !== null ? (
                      <a
                        href={`https://www.google.com/maps?q=${event.lat},${event.lng}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-1 text-xs text-brand-500 hover:underline"
                      >
                        open
                        <ExternalLink size={10} />
                      </a>
                    ) : (
                      <span className="text-xs text-faint">--</span>
                    )}
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      {view === "all" ? (
        <Pager
          page={page}
          total={scoped.length}
          pageSize={PAGE_SIZE}
          href={pagerHrefBase}
          noun="crossings"
        />
      ) : (
        <Pager
          page={page}
          total={groups.length}
          pageSize={TRUCK_PAGE_SIZE}
          href={pagerHrefBase}
          noun="trucks"
        />
      )}

      {scoped.length > 0 ? (
        <>
          <Panel
            title="Crossings per day"
            description={
              range === "all"
                ? `The ${stripDays} days up to the newest crossing.`
                : `The last ${stripDays} days.`
            }
            className="mt-5"
          >
            <DayStrip series={daily} />
          </Panel>

          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Panel title="Busiest plazas" description="Where the crossings land." bodyClassName="p-0">
              <ul className="divide-y divide-divider">
                {topPlazas.map(([plaza, count]) => (
                  <li key={plaza} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm text-ink">{plaza}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {fmtNumber(count)}
                      </span>
                    </div>
                    <Meter share={count / scoped.length} />
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel title="Busiest hours" description="When the trucks are moving.">
              <HourStrip hours={hours} />
            </Panel>

            <Panel
              title="Repeated legs"
              description="One plaza to the next, same truck."
              bodyClassName="p-0"
            >
              {routes.length === 0 ? (
                <EmptyState
                  title="No leg has repeated yet"
                  description="Once a truck runs the same pair of plazas twice it shows up here."
                />
              ) : (
                <ul className="divide-y divide-divider">
                  {routes.map((route) => (
                    <li key={`${route.from}->${route.to}`} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm text-ink">
                          <span className="truncate">{route.from}</span>
                          <ArrowRight size={12} className="shrink-0 text-faint" />
                          <span className="truncate">{route.to}</span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted">
                          {fmtNumber(route.count)}x
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </>
      ) : null}

      <p className="mt-4 text-xs leading-relaxed text-muted">
        {retentionDays === -1
          ? "This history is kept indefinitely."
          : `Crossings older than ${retentionDays} days are cleared automatically, so the app stays quick to search. Export anything you need to keep.`}
      </p>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* summaries                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * IST has no daylight saving, so shifting by a fixed offset and reading the
 * result as UTC gives the exact local date and hour without a formatter.
 */
const IST_OFFSET_MS = 5.5 * 3_600_000;

function istPartsOf(iso: string): { date: string; hour: number } {
  const shifted = new Date(Date.parse(iso) + IST_OFFSET_MS);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

type DayCount = { date: string; count: number };

/** Every day in the window, including the empty ones - a gap is information. */
function dailyCounts(rows: RecordRow[], days: number, anchorDate: string): DayCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.event_time) continue;
    const { date } = istPartsOf(row.event_time);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }

  const anchor = Date.parse(`${anchorDate}T00:00:00Z`);
  const series: DayCount[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(anchor - i * 86_400_000).toISOString().slice(0, 10);
    series.push({ date, count: counts.get(date) ?? 0 });
  }
  return series;
}

function hourCounts(rows: RecordRow[]): number[] {
  const buckets = new Array(24).fill(0) as number[];
  for (const row of rows) {
    if (!row.event_time) continue;
    buckets[istPartsOf(row.event_time).hour] += 1;
  }
  return buckets;
}

type Route = { from: string; to: string; count: number };

/**
 * Consecutive plazas for one truck, counted. Two crossings of the same plaza in
 * a row are the same stop reported twice, not a leg, so they are skipped. Only
 * legs seen more than once are worth showing - a single leg is just a crossing.
 */
function topRoutes(rows: RecordRow[], limit = 6): Route[] {
  const byTruck = new Map<string, RecordRow[]>();
  for (const row of rows) {
    if (!row.event_time || !row.loc_name) continue;
    const list = byTruck.get(row.truck_number);
    if (list) list.push(row);
    else byTruck.set(row.truck_number, [row]);
  }

  const legs = new Map<string, Route>();
  for (const list of byTruck.values()) {
    const ordered = [...list].sort(
      (a, b) => Date.parse(a.event_time!) - Date.parse(b.event_time!),
    );
    for (let i = 1; i < ordered.length; i += 1) {
      const from = ordered[i - 1].loc_name!;
      const to = ordered[i].loc_name!;
      if (from === to) continue;
      // Two names, one key: a joined string could collide with a plaza whose
      // own name contains the separator.
      const key = JSON.stringify([from, to]);
      const seen = legs.get(key);
      if (seen) seen.count += 1;
      else legs.set(key, { from, to, count: 1 });
    }
  }

  return [...legs.values()]
    .filter((leg) => leg.count > 1)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/* -------------------------------------------------------------------------- */
/* strips                                                                      */
/* -------------------------------------------------------------------------- */

function Meter({ share }: { share: number }) {
  return (
    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
      <div
        className="h-full rounded-full bg-brand-500"
        style={{ width: `${Math.max(Math.round(share * 100), 3)}%` }}
      />
    </div>
  );
}

function DayStrip({ series }: { series: DayCount[] }) {
  const peak = Math.max(1, ...series.map((day) => day.count));
  const busiest = series.reduce((best, day) => (day.count > best.count ? day : best), series[0]);

  return (
    <div>
      <div className="flex h-24 items-end gap-px sm:gap-1">
        {series.map((day) => (
          <div
            key={day.date}
            title={`${day.date}: ${day.count} crossing${day.count === 1 ? "" : "s"}`}
            className="flex flex-1 flex-col justify-end"
          >
            <div
              className={cx("w-full rounded-sm", day.count > 0 ? "bg-brand-500" : "bg-sunken")}
              style={{ height: day.count > 0 ? `${Math.max((day.count / peak) * 100, 6)}%` : "3px" }}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 text-[11px] text-faint">
        <span>{fmtDate(series[0]?.date)}</span>
        {busiest && busiest.count > 0 ? (
          <span className="text-muted">
            Busiest {fmtDate(busiest.date)} — {fmtNumber(busiest.count)}
          </span>
        ) : null}
        <span>{fmtDate(series[series.length - 1]?.date)}</span>
      </div>
    </div>
  );
}

/** "12am", "7am", "1pm" - a clock hour as it is spoken. */
function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

function HourStrip({ hours }: { hours: number[] }) {
  const peak = Math.max(1, ...hours);
  const busiest = hours.indexOf(Math.max(...hours));
  const anyMovement = hours.some((count) => count > 0);

  return (
    <div>
      <div className="flex h-20 items-end gap-px">
        {hours.map((count, hour) => (
          <div
            key={hour}
            title={`${hourLabel(hour)}: ${count} crossing${count === 1 ? "" : "s"}`}
            className="flex flex-1 flex-col justify-end"
          >
            <div
              className={cx(
                "w-full rounded-sm",
                count === 0 ? "bg-sunken" : hour === busiest ? "bg-brand-600" : "bg-brand-500/70",
              )}
              style={{ height: count > 0 ? `${Math.max((count / peak) * 100, 8)}%` : "3px" }}
            />
          </div>
        ))}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>12am</span>
        <span>6am</span>
        <span>12pm</span>
        <span>6pm</span>
        <span>11pm</span>
      </div>

      {anyMovement ? (
        <p className="mt-2 text-xs text-muted">
          Busiest between {hourLabel(busiest)} and {hourLabel((busiest + 1) % 24)}.
        </p>
      ) : null}
    </div>
  );
}
