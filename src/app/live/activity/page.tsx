import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { driverDays, tripSections } from "@/lib/live/activity";
import { rangeStart, requireLiveSession, searchTrips } from "@/lib/live/server";
import { fmtIst, tripTitle } from "@/lib/live/shared";

import { BackLink } from "../BackLink";
import { FilterBar, filterHref, readFilters } from "../blocks";
import { loadFilterOptions } from "../filter-data";
import { DaySections, InfoTip, PhaseSections, StatePill } from "../parts";

export const metadata = { title: "Live tracking - Activity" };
export const dynamic = "force-dynamic";

const BASE = "/live/activity";
const PAGE = 8;

/**
 * Activity (v5 §7): the event log, one block per trip (phases inside).
 * view=day only when a driver is picked: his working day across trips.
 */
export default async function ActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const live = await requireLiveSession();
  const f = readFilters(sp);
  const dayView = sp.view === "day" && Boolean(f.driver);
  const page = Math.max(0, Number(sp.page) || 0);
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before).toISOString() : null;
  const opts = await loadFilterOptions(live.ownerId);
  const here = filterHref(BASE, f, {}, dayView ? "day" : undefined);
  const join = (extra: string) => `${here}${here.includes("?") ? "&" : "?"}${extra}`;

  let body: React.ReactNode;
  let more: string | null = null;
  if (dayView) {
    const r = await driverDays(live.ownerId, f.driver, before);
    body = <DaySections days={r.days} group="act-day" trips={r.trips} />;
    if (r.next) more = join(`before=${encodeURIComponent(r.next)}`);
  } else {
    const res = await searchTrips(live.ownerId, { status: "all", q: f.q, from: rangeStart(f.range), driver: f.driver, vehicle: f.truck, place: f.place, page, pageSize: PAGE });
    const sections = await tripSections(res.rows);
    body = sections.length ? (
      <div className="live-acc">
        {sections.map(({ trip, phases, count }, i) => (
          <details key={trip.id} name="act-trips" open={i === 0 || undefined}>
            <summary>
              <strong className="truncate">{tripTitle(trip)}</strong>
              <StatePill trip={trip} />
              <small>{fmtIst(trip.created_at)}</small>
              <span className="live-acc-count">{count}</span>
            </summary>
            <div className="live-acc-body space-y-2">
              <Link href={`/live/trips/${trip.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
                Open trip <ChevronRight size={12} />
              </Link>
              <PhaseSections groups={phases} group={`act-${trip.id}`} />
            </div>
          </details>
        ))}
      </div>
    ) : (
      <p className="live-empty">Nothing matches.</p>
    );
    if (res.more) more = join(`page=${page + 1}`);
  }

  return (
    <div className="live-page mx-auto max-w-2xl space-y-3">
      <BackLink href="/live/profile" label="Profile" />
      <header className="live-mhead">
        <h1>Activity</h1>
        <InfoTip label="About activity">
          Everything that happened, grouped by trip: status changes, alerts, edits with reasons, notes. Pick a driver to see his day-by-day view.
        </InfoTip>
        <span className="flex-1" />
        {f.driver ? (
          <nav className="live-seg-xs" aria-label="View">
            <Link href={filterHref(BASE, f)} aria-current={!dayView ? "page" : undefined}>
              By trip
            </Link>
            <Link href={filterHref(BASE, f, {}, "day")} aria-current={dayView ? "page" : undefined}>
              By day
            </Link>
          </nav>
        ) : null}
      </header>
      <FilterBar base={BASE} f={f} drivers={opts.drivers} trucks={opts.trucks} places={opts.places} view={dayView ? "day" : undefined} />
      {dayView ? <p className="text-xs text-faint">Day view shows the driver&apos;s days; time range and search apply to the trip view.</p> : null}
      <div className="space-y-2">{body}</div>
      {more ? (
        <div className="flex justify-center">
          <Link href={more} className="live-chip-xs">
            Older
          </Link>
        </div>
      ) : null}
      <p className="text-center text-xs">
        <Link href={filterHref("/live/history", f)} className="font-semibold text-brand-600">
          Same filters in History
        </Link>
      </p>
    </div>
  );
}
