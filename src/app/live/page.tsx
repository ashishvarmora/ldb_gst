import Link from "next/link";
import { Plus, UserRound } from "lucide-react";

import { loadDriverBoard, loadPlaces, placeMap, requireLiveSession, type DriverRow } from "@/lib/live/server";
import { driverSignal, prettyVehicle, signalGroup } from "@/lib/live/shared";

import { DriverCard } from "./parts";
import { AutoRefresh, FleetMap, type MapTruck } from "./widgets";

export const metadata = { title: "Live tracking - Drivers" };
export const dynamic = "force-dynamic";

/**
 * /live - the home: every driver, by what his phone is doing right now.
 *   Live      - position in the last few minutes
 *   Last seen - sharing, quiet for under 30 min
 *   Idle      - everyone else (no signal 30+ min, link not opened, stopped, ended)
 * Tracking is the driver's phone; a trip is optional.
 */

const TABS = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "seen", label: "Last seen" },
  { key: "idle", label: "Idle" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default async function DriversHome({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const now = Date.now();
  const [{ rows }, places] = await Promise.all([loadDriverBoard(ownerId), loadPlaces(ownerId, { includeArchived: true })]);
  const byId = placeMap(places);

  const groupOf = (r: DriverRow) => signalGroup(driverSignal(r.driver, now));
  const counts = { all: rows.length, live: 0, seen: 0, idle: 0 } as Record<Tab, number>;
  for (const r of rows) counts[groupOf(r)]++;
  const tab: Tab = TABS.some((t) => t.key === sp.show) ? (sp.show as Tab) : "all";

  // Live first, then most recently heard, then name.
  const rank = { live: 0, seen: 1, idle: 2 } as const;
  const list = rows
    .filter((r) => tab === "all" || groupOf(r) === tab)
    .sort(
      (a, b) =>
        rank[groupOf(a)] - rank[groupOf(b)] ||
        (b.driver.share_last_seen_at ?? "").localeCompare(a.driver.share_last_seen_at ?? "") ||
        a.driver.name.localeCompare(b.driver.name),
    );

  const onMap: MapTruck[] = rows
    .filter((r) => r.driver.last_lat != null && r.driver.last_lng != null && groupOf(r) !== "idle")
    .slice(0, 30)
    .map((r) => ({
      id: r.driver.id,
      label: r.driver.name,
      sub: r.vehicle ? prettyVehicle(r.vehicle.number) : r.trip ? "On a trip" : "No trip",
      lat: r.driver.last_lat!,
      lng: r.driver.last_lng!,
      at: r.driver.last_point_at,
      tone: groupOf(r) === "live" ? "good" : "neutral",
    }));

  return (
    <div className="live-page mx-auto max-w-4xl space-y-4">
      <AutoRefresh ms={30_000} />
      <header className="live-page-head">
        <div>
          <h1>Drivers</h1>
          <p>
            {counts.live} live · {counts.seen} last seen · {counts.idle} idle
          </p>
        </div>
        <Link href="/live/new" className="live-cta live-cta-sm hidden lg:inline-flex">
          <Plus size={16} /> Track a driver
        </Link>
      </header>

      {rows.length === 0 ? (
        <section className="live-hero">
          <span className="live-hero-icon">
            <UserRound size={26} />
          </span>
          <h2 className="text-lg font-extrabold text-strong">Track your first driver</h2>
          <p>Add a driver&apos;s name and mobile, send the link on WhatsApp, and see his phone&apos;s location here. No app needed.</p>
          <Link href="/live/new" className="live-cta mt-2">
            <Plus size={16} /> Track a driver
          </Link>
        </section>
      ) : (
        <>
          <nav className="live-tabs" aria-label="Filter drivers">
            {TABS.map((t) => (
              <Link key={t.key} href={t.key === "all" ? "/live" : `/live?show=${t.key}`} aria-current={tab === t.key ? "page" : undefined}>
                {t.label} <span className="live-tab-count">{counts[t.key]}</span>
              </Link>
            ))}
          </nav>

          {onMap.length && tab !== "idle" ? (
            <details className="panel live-map-details" open={onMap.length > 0}>
              <summary>Map ({onMap.length})</summary>
              <div className="p-2 pt-0">
                <FleetMap trucks={onMap} />
              </div>
            </details>
          ) : null}

          <div className="live-list">
            {list.map((r) => (
              <DriverCard key={r.driver.id} driver={r.driver} vehicle={r.vehicle} trip={r.trip} places={byId} now={now} />
            ))}
            {list.length === 0 ? <p className="live-empty">No drivers here right now.</p> : null}
          </div>
        </>
      )}
    </div>
  );
}
