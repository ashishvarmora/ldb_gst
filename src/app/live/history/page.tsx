import Link from "next/link";

import { cx } from "@/components/ui";
import { loadPlaces, placeMap, rangeStart, requireLiveSession, searchTrips } from "@/lib/live/server";

import { BackLink } from "../BackLink";
import { FilterBar, filterHref, readFilters } from "../blocks";
import { loadFilterOptions } from "../filter-data";
import { InfoTip, TripCard } from "../parts";

export const metadata = { title: "Live tracking - History" };
export const dynamic = "force-dynamic";

const BASE = "/live/history";
const PAGE = 20;

/**
 * History (v5 §7): the trips themselves - what happened. Search, time range and
 * icon filters for driver / truck / warehouse; driver, truck and warehouse
 * rows link here pre-filtered. Default = finished trips (Done + Cancelled).
 */
export default async function HistoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const live = await requireLiveSession();
  const f = readFilters(sp);
  const all = sp.status === "all";
  const page = Math.max(0, Number(sp.page) || 0);
  const [opts, res, places] = await Promise.all([
    loadFilterOptions(live.ownerId),
    searchTrips(live.ownerId, { status: all ? "all" : "past", q: f.q, from: rangeStart(f.range), driver: f.driver, vehicle: f.truck, place: f.place, page, pageSize: PAGE }),
    loadPlaces(live.ownerId, { includeArchived: true }),
  ]);
  const byId = placeMap(places);
  const now = Date.now();
  const here = filterHref(BASE, f);
  const join = (extra: string) => `${here}${here.includes("?") ? "&" : "?"}${extra}`;

  return (
    <div className="live-page mx-auto max-w-2xl space-y-3">
      <BackLink href="/live/profile" label="Profile" />
      <header className="live-mhead">
        <h1>History</h1>
        <InfoTip label="History and activity">History lists trips. Activity lists what happened inside each trip (status changes, alerts, notes).</InfoTip>
        <span className="flex-1" />
        <nav className="live-seg-xs" aria-label="Which trips">
          <Link href={here} aria-current={!all ? "page" : undefined}>
            Finished
          </Link>
          <Link href={join("status=all")} aria-current={all ? "page" : undefined}>
            All
          </Link>
        </nav>
      </header>
      <FilterBar base={BASE} f={f} drivers={opts.drivers} trucks={opts.trucks} places={opts.places} />
      <div className="space-y-2">
        {res.rows.map((t) => (
          <TripCard key={t.id} trip={t} places={byId} now={now} />
        ))}
        {res.rows.length === 0 ? <p className="live-empty">No trips match.</p> : null}
      </div>
      <div className="flex justify-center gap-2">
        {page > 0 ? (
          <Link href={join(`${all ? "status=all&" : ""}page=${page - 1}`)} className="live-chip-xs">
            Newer
          </Link>
        ) : null}
        {res.more ? (
          <Link href={join(`${all ? "status=all&" : ""}page=${page + 1}`)} className={cx("live-chip-xs")}>
            Older
          </Link>
        ) : null}
      </div>
      <p className="text-center text-xs">
        <Link href={filterHref("/live/activity", f)} className="font-semibold text-brand-600">
          Same filters in Activity
        </Link>
      </p>
    </div>
  );
}
