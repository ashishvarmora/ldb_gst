import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { driverDays, groupByPhase, placeDays, tripSections } from "@/lib/live/activity";
import { LOGBOOK_TABS, driverUsage, truckUsage, tripsSince, warehouseUsage, type LogbookTab, type Usage } from "@/lib/live/logbook";
import { UUID_RE, loadPlaces, loadTrip, loadTripEvents, placeMap, rangeStart, requireLiveSession, searchTrips } from "@/lib/live/server";
import { fmtIst, prettyVehicle, tripTitle, variance } from "@/lib/live/shared";

import { BackLink } from "../../../BackLink";
import { FilterBar, filterHref, readFilters } from "../../../blocks";
import { DaySections, PhaseSections, TripCard } from "../../../parts";
import { TAB_META, TripAccordion, routeText, usageText, whenWho } from "../../parts";

export const metadata = { title: "Live tracking - Logbook" };
export const dynamic = "force-dynamic";

const PAGE = 10;

/** Logbook detail (v6): one trip with its activity, or one truck / driver / warehouse with its trips in the period. */
export default async function LogbookDetail({ params, searchParams }: { params: Promise<{ tab: string; id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ tab: raw, id }, sp] = await Promise.all([params, searchParams]);
  if (!(LOGBOOK_TABS as readonly string[]).includes(raw) || !UUID_RE.test(id)) notFound();
  const tab = raw as LogbookTab;
  const live = await requireLiveSession();
  const f = readFilters(sp);
  const back = `/live/logbook/${tab}${f.range !== "30d" ? `?range=${f.range}` : ""}`;
  const now = Date.now();
  const places = placeMap(await loadPlaces(live.ownerId, { includeArchived: true }));

  /* ---- one trip ---- */
  if (tab === "trips") {
    const trip = await loadTrip(live.ownerId, id);
    if (!trip) notFound();
    const events = await loadTripEvents(trip.id);
    const startVar = variance(trip.started_at, trip.planned_dispatch_at);
    const end = trip.arrived_at ?? trip.delivered_at;
    const endVar = variance(end, trip.promised_delivery_at);
    return (
      <div className="live-page mx-auto max-w-2xl space-y-3">
        <BackLink href={back} label="Logbook" />
        <TripCard trip={trip} places={places} now={now} />
        <dl className="lb-facts">
          <div>
            <dt>Start</dt>
            <dd>
              {trip.started_at ? fmtIst(trip.started_at) : `Planned ${fmtIst(trip.planned_dispatch_at)}`}
              {startVar ? <em className={`live-var live-var-${startVar.tone}`}>{startVar.text}</em> : null}
            </dd>
          </div>
          <div>
            <dt>Arrival</dt>
            <dd>
              {end ? fmtIst(end) : `Planned ${fmtIst(trip.promised_delivery_at)}`}
              {endVar ? <em className={`live-var live-var-${endVar.tone}`}>{endVar.text}</em> : null}
            </dd>
          </div>
          <div>
            <dt>Route</dt>
            <dd>{routeText(trip, places)}</dd>
          </div>
          <div>
            <dt>Driver · truck</dt>
            <dd>
              {trip.driver_name ?? "-"} · {trip.vehicle_no ? prettyVehicle(trip.vehicle_no) : "-"}
            </dd>
          </div>
        </dl>
        <h2 className="lb-h2">
          Activity <small>{events.length}</small>
        </h2>
        <PhaseSections groups={groupByPhase(events, trip)} group="lb-trip" />
        <Link href={`/live/trips/${trip.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
          Open {tripTitle(trip)} <ChevronRight size={12} />
        </Link>
      </div>
    );
  }

  /* ---- one truck / driver / warehouse ---- */
  const from = rangeStart(f.range, now);
  const trips = await tripsSince(live.ownerId, from);
  const all: Usage[] =
    tab === "trucks" ? await truckUsage(live.ownerId, trips, "", now) : tab === "drivers" ? await driverUsage(live.ownerId, trips, "", now) : await warehouseUsage(live.ownerId, trips, "", now);
  let u = all.find((x) => x.id === id) ?? null;
  if (!u) {
    // Archived / not in the list: still show its trips under its stored name.
    const table = tab === "trucks" ? "live_vehicles" : tab === "drivers" ? "live_drivers" : "live_places";
    const col = tab === "trucks" ? "number" : "name";
    const { data } = await getSupabaseAdmin().from(table).select(`id,${col}`).eq("owner_id", live.ownerId).eq("id", id).maybeSingle<Record<string, string>>();
    if (!data) notFound();
    u = { id, name: tab === "trucks" ? prettyVehicle(data.number) : data.name, sub: "archived", trips: 0, active: 0, days: 0, hours: 0, last: null };
  }

  const dayView = sp.view === "day" && tab !== "trucks";
  const base = `/live/logbook/${tab}/${id}`;
  const here = filterHref(base, f, {}, dayView ? "day" : undefined);
  const join = (extra: string) => `${here}${here.includes("?") ? "&" : "?"}${extra}`;
  let body: React.ReactNode;
  let more: string | null = null;
  if (dayView) {
    const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before).toISOString() : null;
    const r = tab === "drivers" ? await driverDays(live.ownerId, id, before) : await placeDays(live.ownerId, id, before);
    body = <DaySections days={r.days} group="lb-day" trips={r.trips} />;
    if (r.next) more = join(`before=${encodeURIComponent(r.next)}`);
  } else {
    const page = Math.max(0, Number(sp.page) || 0);
    const res = await searchTrips(live.ownerId, {
      status: "all",
      q: f.q,
      from,
      vehicle: tab === "trucks" ? id : null,
      driver: tab === "drivers" ? id : null,
      place: tab === "warehouses" ? id : null,
      page,
      pageSize: PAGE,
    });
    const sections = await tripSections(res.rows);
    body = <TripAccordion sections={sections} places={places} show={tab === "trucks" ? "driver" : tab === "drivers" ? "truck" : "both"} group="lb-trips" />;
    if (res.more) more = join(`page=${page + 1}`);
  }
  const Icon = TAB_META[tab].icon;

  return (
    <div className="live-page mx-auto max-w-2xl space-y-3">
      <BackLink href={back} label={`Logbook · ${TAB_META[tab].label}`} />
      <header className="lb-head">
        <span className="lb-head-ic">
          <Icon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className={tab === "trucks" ? "live-plate live-plate-lg" : undefined}>{u.name}</h1>
          <p>{u.trips ? usageText(u) : "Not used in this period"}</p>
        </div>
        {tab !== "trucks" ? (
          <nav className="live-seg-xs" aria-label="View">
            <Link href={filterHref(base, f)} aria-current={!dayView ? "page" : undefined}>
              By trip
            </Link>
            <Link href={filterHref(base, f, {}, "day")} aria-current={dayView ? "page" : undefined}>
              By day
            </Link>
          </nav>
        ) : null}
      </header>
      {u.last ? <p className="lb-last">Last: {whenWho(u.last, "both")}</p> : null}
      <FilterBar base={base} f={f} drivers={[]} trucks={[]} places={[]} icons={false} view={dayView ? "day" : undefined} placeholder="Trip, place, invoice" />
      {dayView ? <p className="text-xs text-faint">Day view lists the activity day by day; search and time range apply to the trip view.</p> : null}
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
