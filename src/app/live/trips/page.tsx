import Link from "next/link";
import { Plus, Route, Search } from "lucide-react";

import { cx } from "@/components/ui";
import { loadPlaces, placeMap, requireLiveSession, searchTrips } from "@/lib/live/server";
import { istDayStart, prettyVehicle } from "@/lib/live/shared";

import { TripCard } from "../parts";
import { AutoRefresh, FleetMap, type MapTruck } from "../widgets";

export const metadata = { title: "Live tracking - Trips" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "Active" },
  { key: "in_transit", label: "In transit" },
  { key: "planned", label: "Planned" },
  { key: "arrived", label: "Arrived" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

const DAYS = [
  { key: "", label: "Any date" },
  { key: "today", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
];

const DIRS = [
  { key: "", label: "All" },
  { key: "outgoing", label: "Sending" },
  { key: "incoming", label: "Receiving" },
];

type Search = { status?: string; q?: string; days?: string; place?: string; dir?: string; page?: string };

function href(base: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  const merged = { ...base, ...patch };
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
  const s = p.toString();
  return `/live/trips${s ? `?${s}` : ""}`;
}

export default async function TripsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const status = TABS.some((t) => t.key === sp.status) ? sp.status! : "open";
  const now = Date.now();
  const from =
    sp.days === "today" ? istDayStart(now) : sp.days === "7" || sp.days === "30" ? new Date(now - Number(sp.days) * 86_400_000).toISOString() : null;
  const page = Math.max(0, Number(sp.page) || 0);

  const [{ rows, more }, places] = await Promise.all([
    searchTrips(ownerId, { status, q: sp.q, from, place: sp.place, direction: sp.dir, page }),
    loadPlaces(ownerId),
  ]);
  const byId = placeMap(places);
  const base: Search = { status, q: sp.q, days: sp.days, place: sp.place, dir: sp.dir };
  const onMap: MapTruck[] = rows
    .filter((t) => t.last_lat != null && t.last_lng != null && ["loading", "in_transit", "arrived"].includes(t.status))
    .slice(0, 30)
    .map((t) => ({
      id: t.id,
      label: t.driver_name || prettyVehicle(t.vehicle_no) || t.trip_name || "Trip",
      sub: `${t.trip_name ?? ""}${t.vehicle_no ? ` · ${prettyVehicle(t.vehicle_no)}` : ""}`,
      lat: t.last_lat!,
      lng: t.last_lng!,
      at: t.last_point_at,
      tone: t.status === "in_transit" ? "good" : "neutral",
    }));

  return (
    <div className="live-page mx-auto max-w-5xl space-y-3">
      {status === "open" ? <AutoRefresh ms={30_000} /> : null}
      <header className="live-page-head">
        <div>
          <h1>Trips</h1>
          <p>
            Sending and receiving, all tracked here.{" "}
            <Link href="/live/today" className="font-semibold text-brand-600">
              Today&apos;s summary
            </Link>
          </p>
        </div>
        <Link href="/live/trips/new" className="live-cta live-cta-sm hidden lg:inline-flex">
          <Plus size={15} /> New trip
        </Link>
      </header>

      <form action="/live/trips" className="live-search">
        <input type="hidden" name="status" value={status} />
        {sp.days ? <input type="hidden" name="days" value={sp.days} /> : null}
        <Search size={17} aria-hidden />
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Vehicle, invoice, e-way bill, customer…"
          aria-label="Search trips"
          enterKeyHint="search"
        />
      </form>

      <nav className="live-tabs" aria-label="Status">
        {TABS.map((t) => (
          <Link key={t.key} href={href(base, { status: t.key, page: undefined })} aria-current={t.key === status ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-1.5">
        {DIRS.map((d) => (
          <Link
            key={d.key || "alldir"}
            href={href(base, { dir: d.key || undefined, page: undefined })}
            className={cx("live-chip-filter", (sp.dir ?? "") === d.key && "is-on")}
          >
            {d.label}
          </Link>
        ))}
        <span className="mx-0.5 h-4 w-px bg-divider" aria-hidden />
        {DAYS.map((d) => (
          <Link
            key={d.key || "any"}
            href={href(base, { days: d.key || undefined, page: undefined })}
            className={cx("live-chip-filter", (sp.days ?? "") === d.key && "is-on")}
          >
            {d.label}
          </Link>
        ))}
        {places.length ? (
          <form action="/live/trips" className="ml-auto flex items-center gap-1.5">
            <input type="hidden" name="status" value={status} />
            {sp.q ? <input type="hidden" name="q" value={sp.q} /> : null}
            {sp.days ? <input type="hidden" name="days" value={sp.days} /> : null}
            {sp.dir ? <input type="hidden" name="dir" value={sp.dir} /> : null}
            <select name="place" defaultValue={sp.place ?? ""} className="field live-place-select" aria-label="Filter by place">
              <option value="">All places</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="submit" className="live-chip-filter">
              Go
            </button>
          </form>
        ) : null}
      </div>

      {onMap.length ? (
        <details className="panel live-map-details">
          <summary>Map ({onMap.length})</summary>
          <div className="p-2 pt-0">
            <FleetMap trucks={onMap} />
          </div>
        </details>
      ) : null}

      {rows.length ? (
        <div className="live-trip-grid">
          {rows.map((t) => (
            <TripCard key={t.id} trip={t} places={byId} now={now} />
          ))}
        </div>
      ) : (
        <div className="panel p-6 text-center">
          <Route size={22} className="mx-auto text-faint" />
          <p className="mt-2 text-sm font-semibold text-strong">No trips here</p>
          <p className="mt-1 text-xs text-muted">
            {sp.q ? "Nothing matches that search." : "Make a trip for each truck you send or receive. Add the driver, send him the link, and see it move."}
          </p>
          <Link href="/live/trips/new" className="live-cta live-cta-sm mt-3 inline-flex">
            <Plus size={15} /> New trip
          </Link>
        </div>
      )}

      {page > 0 || more ? (
        <div className="flex justify-between gap-2">
          {page > 0 ? <Link className="live-chip-filter" href={href(base, { page: String(page - 1) })}>← Newer</Link> : <span />}
          {more ? <Link className="live-chip-filter" href={href(base, { page: String(page + 1) })}>Older →</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
