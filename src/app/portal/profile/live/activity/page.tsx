import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ChevronRight, History } from "lucide-react";

import { PageHeader } from "@/components/ui";
import { DaySections, PhaseSections, StatePill } from "@/app/live/parts";
import { driverDays, placeDays, tripsActivity, truckTrips, type TripSection } from "@/lib/live/activity";
import { loadPlaces, loadVehicles, logLive, requireLiveSession, UUID_RE } from "@/lib/live/server";
import { OWN_SITE_KINDS, fmtIst, prettyVehicle, tripTitle, type LiveDriver } from "@/lib/live/shared";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

import "@/app/live/live.css";

export const metadata = { title: "Live activity — Rahdari" };
export const dynamic = "force-dynamic";

/**
 * Profile > Live tracking > Activity (v4, docs/LIVE-PLAN-v4.md §6). Read-only,
 * derived from trip activity + positions; nothing lives on the masters.
 *   Trips       one section per trip, phases inside
 *   Drivers     per day (a multi-day trip splits by day)
 *   Trucks      per trip
 *   Warehouses  per day
 */

const TABS = [
  { key: "trips", label: "Trips" },
  { key: "drivers", label: "Drivers" },
  { key: "trucks", label: "Trucks" },
  { key: "warehouses", label: "Warehouses" },
] as const;
type Tab = (typeof TABS)[number]["key"];

function TripList({ sections, group }: { sections: TripSection[]; group: string }) {
  if (!sections.length) return <p className="live-empty">No trips yet.</p>;
  return (
    <div className="live-acc">
      {sections.map(({ trip, phases, count }, i) => (
        <details key={trip.id} name={group} open={i === 0 || undefined}>
          <summary>
            <strong className="truncate">{tripTitle(trip)}</strong>
            <StatePill trip={trip} />
            <small>{fmtIst(trip.created_at)}</small>
            <span className="live-acc-count">{count}</span>
          </summary>
          <div className="live-acc-body space-y-2">
            <Link href={`/live/trips/${trip.id}`} className="live-acc-links inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
              Open trip <ChevronRight size={12} />
            </Link>
            <PhaseSections groups={phases} group={`${group}-${trip.id}`} />
          </div>
        </details>
      ))}
    </div>
  );
}

function Picker({ tab, name, value, options }: { tab: Tab; name: string; value: string; options: { id: string; label: string }[] }) {
  return (
    <form action="/portal/profile/live/activity" className="flex gap-2">
      <input type="hidden" name="tab" value={tab} />
      <select name={name} defaultValue={value} className="field min-w-0 flex-1 text-sm" aria-label="Choose">
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button type="submit" className="live-btn-sm live-btn-brand">
        Show
      </button>
    </form>
  );
}

function More({ href }: { href: string }) {
  return (
    <Link href={href} className="live-chip-filter mx-auto mt-2 flex w-fit">
      View more
    </Link>
  );
}

export default async function LiveActivityPage({ searchParams }: { searchParams: Promise<{ tab?: string; id?: string; page?: string; before?: string }> }) {
  const sp = await searchParams;
  const live = await requireLiveSession();
  if (!live.enabled) redirect("/live");
  const tab: Tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as Tab) : "trips";
  const page = Math.max(0, Number(sp.page) || 0);
  const before = sp.before && !Number.isNaN(Date.parse(sp.before)) ? new Date(sp.before).toISOString() : null;
  const base = `/portal/profile/live/activity?tab=${tab}`;

  let body: React.ReactNode = null;
  if (tab === "trips") {
    const { sections, more } = await tripsActivity(live.ownerId, page);
    body = (
      <>
        <TripList sections={sections} group="act-trips" />
        {more ? <More href={`${base}&page=${page + 1}`} /> : null}
      </>
    );
  } else if (tab === "drivers") {
    const { data, error } = await getSupabaseAdmin().from("live_drivers").select("id,name,archived_at").eq("owner_id", live.ownerId).eq("kind", "own").order("name").limit(500);
    if (error) logLive("activity drivers", error);
    const drivers = (data ?? []) as Pick<LiveDriver, "id" | "name" | "archived_at">[];
    const id = sp.id && UUID_RE.test(sp.id) && drivers.some((d) => d.id === sp.id) ? sp.id : drivers[0]?.id;
    const r = id ? await driverDays(live.ownerId, id, before) : null;
    body = drivers.length ? (
      <>
        <Picker tab={tab} name="id" value={id ?? ""} options={drivers.map((d) => ({ id: d.id, label: `${d.name}${d.archived_at ? " (archived)" : ""}` }))} />
        {r ? <DaySections days={r.days} group="act-driver" trips={r.trips} /> : null}
        {r?.next ? <More href={`${base}&id=${id}&before=${encodeURIComponent(r.next)}`} /> : null}
      </>
    ) : (
      <p className="live-empty">No drivers yet.</p>
    );
  } else if (tab === "trucks") {
    const vehicles = await loadVehicles(live.ownerId);
    const id = sp.id && UUID_RE.test(sp.id) && vehicles.some((v) => v.id === sp.id) ? sp.id : vehicles[0]?.id;
    const r = id ? await truckTrips(live.ownerId, id, page) : null;
    body = vehicles.length ? (
      <>
        <Picker tab={tab} name="id" value={id ?? ""} options={vehicles.map((v) => ({ id: v.id, label: prettyVehicle(v.number) }))} />
        {r ? <TripList sections={r.sections} group="act-truck" /> : null}
        {r?.more ? <More href={`${base}&id=${id}&page=${page + 1}`} /> : null}
      </>
    ) : (
      <p className="live-empty">No trucks yet.</p>
    );
  } else {
    const places = (await loadPlaces(live.ownerId, { includeArchived: true })).filter((p) => OWN_SITE_KINDS.includes(p.kind));
    const id = sp.id && UUID_RE.test(sp.id) && places.some((p) => p.id === sp.id) ? sp.id : places[0]?.id;
    const r = id ? await placeDays(live.ownerId, id, before) : null;
    body = places.length ? (
      <>
        <Picker tab={tab} name="id" value={id ?? ""} options={places.map((p) => ({ id: p.id, label: `${p.name}${p.archived_at ? " (archived)" : ""}` }))} />
        {r ? <DaySections days={r.days} group="act-place" trips={r.trips} /> : null}
        {r?.next ? <More href={`${base}&id=${id}&before=${encodeURIComponent(r.next)}`} /> : null}
      </>
    ) : (
      <p className="live-empty">No warehouses yet.</p>
    );
  }

  return (
    <div className="account-workspace space-y-3">
      <Link href="/portal/profile/live" className="app-back-link">
        <ArrowLeft size={17} />
        Live tracking
      </Link>
      <PageHeader icon={<History size={20} />} title="Activity" subtitle="From trip records. Trips by phase, drivers and warehouses by day, trucks by trip." />
      <nav className="live-tabs" aria-label="Activity area">
        {TABS.map((t) => (
          <Link key={t.key} href={`/portal/profile/live/activity?tab=${t.key}`} aria-current={t.key === tab ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      <div className="space-y-2">{body}</div>
    </div>
  );
}
