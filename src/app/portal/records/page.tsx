import Link from "next/link";
import { Download, ExternalLink, MapPin } from "lucide-react";

import {
  RECORD_RANGES,
  RecordsFilters,
  RecordsViewSwitch,
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
  buttonClass,
  cx,
} from "@/components/ui";
import { reportError } from "@/lib/errors";
import { fmtDate, fmtNumber, fmtRelative, fmtTime, istDaysAgo } from "@/lib/format";
import { stateFromLocation } from "@/lib/geo";
import { requirePortalSession } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TruckEvent } from "@/lib/types";

export const metadata = { title: "Records — Truck Watch" };

const PAGE_SIZE = 100;

/**
 * How many rows the summaries and the by-truck view read. Well past what any
 * officer's retention window holds, and a hard stop so one enormous account
 * cannot stall the page.
 */
const SUMMARY_LIMIT = 5000;

/**
 * Every toll crossing on record, read two ways.
 *
 * "By truck" merges all of a truck's crossings into one row - the question an
 * officer actually starts with. "All crossings" is the flat, filterable,
 * exportable log for when they already know what they are looking for.
 */
export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<RecordsQuery>;
}) {
  const { overview } = await requirePortalSession();
  // Retention is one platform setting now, not a per-officer allowance, so it
  // is read from settings rather than from the officer's own row.
  const { dataRetentionDays: retentionDays } = await loadSettings(getSupabaseAdmin());
  const params = await searchParams;
  const admin = getSupabaseAdmin();

  const view: RecordsView = params.view === "all" ? "all" : "trucks";
  const range = RECORD_RANGES.some((r) => r.key === params.range) ? params.range! : "7";
  const since = range === "all" ? null : `${istDaysAgo(Number(range))}T00:00:00+05:30`;
  const page = Math.max(1, Number(params.page) || 1);
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

  const [summary, flat] = await Promise.all([
    summaryQuery,
    view === "all" ? pageQuery : null,
  ]);

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

  const events = (flat?.data ?? []) as TruckEvent[];
  const pages = Math.max(1, Math.ceil(scoped.length / PAGE_SIZE));
  const filtered = Boolean(params.truck || params.q || params.direction);
  const capped = inRange.length === SUMMARY_LIMIT;

  const exportQuery = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, range })) {
    if (value && key !== "page" && key !== "view") exportQuery.set(key, value);
  }

  return (
    <>
      <PageHeader
        title="Records"
        subtitle="Every toll crossing your trucks have made. Read it by truck, or as one flat log you can filter and export."
        actions={
          <a href={`/portal/records/export?${exportQuery}`} className={buttonClass("secondary")}>
            <Download size={14} />
            Export CSV
          </a>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Crossings"
          value={fmtNumber(scoped.length)}
          sub={range === "all" ? "everything kept" : `in the last ${range} days`}
          tone="brand"
        />
        <StatCard label="Trucks" value={fmtNumber(groups.length)} sub="with a crossing" />
        <StatCard label="Toll plazas" value={fmtNumber(distinctPlazas)} sub="distinct" />
        <StatCard
          label="Period covered"
          value={spanDays > 0 ? `${fmtNumber(spanDays)}d` : "--"}
          sub={oldest ? `${fmtDate(oldest)} to ${fmtDate(newest)}` : "no crossings"}
        />
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <RecordsViewSwitch view={view} params={{ ...params, range }} />
        <RecordsFilters params={params} view={view} range={range} trucks={trucks} />
      </div>

      {capped ? (
        <p className="mb-3 rounded-lg border border-line bg-panel px-3 py-2 text-xs leading-relaxed text-muted">
          This range holds more than {fmtNumber(SUMMARY_LIMIT)} crossings. The figures above cover
          the newest {fmtNumber(SUMMARY_LIMIT)} — narrow the date range for exact totals.
        </p>
      ) : null}

      <Panel bodyClassName="p-0">
        {error ? (
          <EmptyState
            title="Could not load records"
            description={reportError("records query", error)}
          />
        ) : view === "trucks" ? (
          <RecordsTruckList groups={groups} range={range} filtered={filtered} />
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

      {view === "all" && pages > 1 ? (
        <nav className="mt-3 flex flex-wrap items-center justify-between gap-3" aria-label="Pagination">
          <p className="text-xs text-muted">
            Showing {fmtNumber(from + 1)}–{fmtNumber(Math.min(from + PAGE_SIZE, scoped.length))} of{" "}
            {fmtNumber(scoped.length)}
          </p>
          <div className="flex gap-2">
            <PageLink params={params} page={page - 1} disabled={page <= 1}>
              Previous
            </PageLink>
            <PageLink params={params} page={page + 1} disabled={page >= pages}>
              Next
            </PageLink>
          </div>
        </nav>
      ) : null}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Panel title="Busiest plazas" description="Across the crossings shown." bodyClassName="p-0">
          {topPlazas.length === 0 ? (
            <EmptyState title="Nothing to summarise" />
          ) : (
            <ul className="divide-y divide-divider">
              {topPlazas.map(([plaza, count]) => {
                const share = Math.round((count / scoped.length) * 100);
                return (
                  <li key={plaza} className="px-4 py-2.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm text-ink">{plaza}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted">
                        {fmtNumber(count)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sunken">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${Math.max(share, 3)}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>

        <Panel title="How long records are kept">
          <p className="text-sm leading-relaxed text-muted">
            {retentionDays === -1 ? (
              <>Your administrator keeps this history indefinitely.</>
            ) : (
              <>
                Crossings older than{" "}
                <strong className="text-ink">{retentionDays} days</strong> are cleared
                automatically, so the app stays quick to search.
              </>
            )}
          </p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            {/* Retention and the backup are both the administrator's settings
                now, so the officer is told what happens rather than asked to
                arrange it - there is nothing for them to configure here. */}
            Your administrator keeps the long-term copy. Export anything you need for a case file
            before it ages out.
          </p>
        </Panel>
      </div>
    </>
  );
}

function PageLink({
  params,
  page,
  disabled,
  children,
}: {
  params: RecordsQuery;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className={cx(buttonClass("secondary", "sm"), "pointer-events-none opacity-50")}>
        {children}
      </span>
    );
  }
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "page") next.set(key, value);
  }
  next.set("view", "all");
  next.set("page", String(page));

  return (
    <Link href={`/portal/records?${next}`} className={buttonClass("secondary", "sm")}>
      {children}
    </Link>
  );
}
