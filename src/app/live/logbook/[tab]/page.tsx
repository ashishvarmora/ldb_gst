import Link from "next/link";
import { notFound } from "next/navigation";

import { LOGBOOK_TABS, driverUsage, truckUsage, tripsSince, warehouseUsage, type LogbookTab, type Usage } from "@/lib/live/logbook";
import { loadPlaces, placeMap, rangeStart, requireLiveSession, searchTrips } from "@/lib/live/server";

import { BackLink } from "../../BackLink";
import { FilterBar, filterHref, readFilters } from "../../blocks";
import { loadFilterOptions } from "../../filter-data";
import { InfoTip, TripCard } from "../../parts";
import { LogbookTabs, TAB_META, UsageRow } from "../parts";

export const metadata = { title: "Live tracking - Logbook" };
export const dynamic = "force-dynamic";

const PAGE = 20;

/**
 * Logbook (v6, docs/LIVE-PLAN-v6.md §3): one place for what happened.
 *   Trips       every trip; tap = the trip with its full activity log
 *   Trucks      where / why / which trip / when each truck was used
 *   Drivers     trips, days and hours per driver
 *   Warehouses  dispatches (out) and arrivals (in) per warehouse
 * Search + time chips on every tab; driver / truck / warehouse icon filters on Trips.
 * Replaces /live/history and /live/activity (both redirect here).
 */
export default async function LogbookList({ params, searchParams }: { params: Promise<{ tab: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ tab: raw }, sp] = await Promise.all([params, searchParams]);
  if (!(LOGBOOK_TABS as readonly string[]).includes(raw)) notFound();
  const tab = raw as LogbookTab;
  const live = await requireLiveSession();
  const f = readFilters(sp);
  const base = `/live/logbook/${tab}`;
  const range = f.range !== "30d" ? `?range=${f.range}` : "";
  const now = Date.now();
  const from = rangeStart(f.range, now);

  let body: React.ReactNode;
  let more: string | null = null;
  let opts = { drivers: [] as { v: string; label: string }[], trucks: [] as { v: string; label: string }[], places: [] as { v: string; label: string }[] };
  if (tab === "trips") {
    const page = Math.max(0, Number(sp.page) || 0);
    const [o, res, places] = await Promise.all([
      loadFilterOptions(live.ownerId),
      searchTrips(live.ownerId, { status: "all", q: f.q, from, driver: f.driver, vehicle: f.truck, place: f.place, page, pageSize: PAGE }),
      loadPlaces(live.ownerId, { includeArchived: true }),
    ]);
    opts = o;
    const byId = placeMap(places);
    body = res.rows.length ? (
      <div className="live-side-list">
        {res.rows.map((t) => (
          <TripCard key={t.id} trip={t} places={byId} now={now} href={`/live/logbook/trips/${t.id}${range}`} />
        ))}
      </div>
    ) : (
      <p className="live-empty">No trips match.</p>
    );
    if (res.more) {
      const h = filterHref(base, f);
      more = `${h}${h.includes("?") ? "&" : "?"}page=${page + 1}`;
    }
  } else {
    const trips = await tripsSince(live.ownerId, from);
    const rows: Usage[] =
      tab === "trucks" ? await truckUsage(live.ownerId, trips, f.q, now) : tab === "drivers" ? await driverUsage(live.ownerId, trips, f.q, now) : await warehouseUsage(live.ownerId, trips, f.q, now);
    body = rows.length ? (
      <ul className="lb-list">
        {rows.map((u) => (
          <UsageRow key={u.id} u={u} href={`/live/logbook/${tab}/${u.id}${range}`} plate={tab === "trucks"} />
        ))}
      </ul>
    ) : (
      <p className="live-empty">{f.q ? "Nothing matches." : `No ${TAB_META[tab].label.toLowerCase()} yet.`}</p>
    );
  }

  return (
    <div className="live-page mx-auto max-w-2xl space-y-3">
      <BackLink href="/live/profile" label="Profile" />
      <header className="live-mhead">
        <h1>Logbook</h1>
        <InfoTip label="About the logbook">
          Everything that happened, four ways. Trips: each trip with its full activity. Trucks: where, why and when each truck went. Drivers: trips, days and hours on the
          road. Warehouses: dispatches (out) and arrivals (in). Hours run from the actual start to arrival or done; days are calendar days touched.
        </InfoTip>
      </header>
      <LogbookTabs tab={tab} keep={range} />
      <FilterBar base={base} f={f} drivers={opts.drivers} trucks={opts.trucks} places={opts.places} icons={tab === "trips"} placeholder={TAB_META[tab].search} />
      {body}
      {more ? (
        <div className="flex justify-center">
          <Link href={more} className="live-chip-xs">
            Older
          </Link>
        </div>
      ) : null}
    </div>
  );
}
