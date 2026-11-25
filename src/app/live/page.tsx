import Link from "next/link";
import { Suspense } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileWarning,
  Flag,
  PackageCheck,
  PauseCircle,
  Sparkles,
  Truck,
} from "lucide-react";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { aiAvailable } from "@/lib/ai";
import { summarizeOperations, summarizeOperationsBasic, type OperationsFacts } from "@/lib/live-ai";
import {
  loadOpenTrips,
  loadPlaces,
  loadRecentEvents,
  logLive,
  placeMap,
  requireLiveSession,
} from "@/lib/live/server";
import {
  EWAY_DASH_MS,
  agoShort,
  destinationText,
  istDayStart,
  prettyVehicle,
  type LivePlace,
  type LiveTrip,
  type TripEvent,
} from "@/lib/live/shared";

import { KpiTile, SectionTitle, TripCard, tripIssues } from "./parts";
import { AutoRefresh, FleetMap, type MapTruck } from "./widgets";

export const metadata = { title: "Live tracking - Today" };
export const dynamic = "force-dynamic";

/* The AI summary is cached per account for a few minutes: the dashboard
   refreshes every 30 s and nobody needs a new paragraph that often. */
const summaryCache = new Map<string, { at: number; key: string; text: string; ai: boolean }>();
const SUMMARY_TTL_MS = 10 * 60 * 1000;

async function SummaryCard({ ownerId, facts }: { ownerId: string; facts: OperationsFacts }) {
  const key = JSON.stringify(facts.counts);
  const hit = summaryCache.get(ownerId);
  let text: string;
  let ai = false;
  if (hit && hit.key === key && Date.now() - hit.at < SUMMARY_TTL_MS) {
    text = hit.text;
    ai = hit.ai;
  } else {
    const fromAi = aiAvailable() ? await summarizeOperations(facts).catch(() => null) : null;
    ai = Boolean(fromAi);
    text = fromAi ?? summarizeOperationsBasic(facts);
    summaryCache.set(ownerId, { at: Date.now(), key, text, ai });
  }
  return (
    <section className="live-summary">
      <p className="live-summary-head">
        <Sparkles size={15} /> {ai ? "Today in short (AI)" : "Today in short"}
      </p>
      <ul>
        {text
          .split("\n")
          .map((l) => l.replace(/^•\s*/, "").trim())
          .filter(Boolean)
          .map((l) => (
            <li key={l}>{l}</li>
          ))}
      </ul>
    </section>
  );
}

async function loadToday(ownerId: string, dayStart: string): Promise<LiveTrip[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("live_trips")
    .select("*")
    .eq("owner_id", ownerId)
    .or(`delivered_at.gte.${dayStart},arrived_at.gte.${dayStart},started_at.gte.${dayStart}`)
    .limit(300);
  if (error) {
    logLive("today", error);
    return [];
  }
  return (data ?? []) as LiveTrip[];
}

function Setup({ places, hasTrips }: { places: LivePlace[]; hasTrips: boolean }) {
  const hasFactory = places.some((p) => p.kind === "factory" || p.kind === "warehouse" || p.kind === "branch");
  const hasCustomer = places.some((p) => p.kind === "customer");
  const steps = [
    { done: hasFactory, title: "Add your factory / godown", text: "Marks loading and departure automatically.", href: "/live/places?add=factory" },
    { done: hasCustomer, title: "Add a few customers / dealers", text: "Arrival is marked when the truck reaches them.", href: "/live/places?add=customer" },
    { done: hasTrips, title: "Create your first trip", text: "Paste the e-way bill text - the form fills itself.", href: "/live/trips/new" },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <section className="panel p-4">
      <h2 className="text-base font-bold text-strong">Get set up in 3 steps</h2>
      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.title}>
            <Link href={s.href} className="live-setup-step">
              {s.done ? <CheckCircle2 size={20} className="text-good-500" /> : <Circle size={20} className="text-faint" />}
              <span className="min-w-0">
                <strong className={s.done ? "line-through opacity-60" : undefined}>{s.title}</strong>
                <small>{s.text}</small>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

const EVENT_ICON: Record<string, typeof Flag> = {
  stoppage: PauseCircle,
  delay: AlertTriangle,
  eway_expiring: FileWarning,
  eway_expired: FileWarning,
  no_signal: AlertTriangle,
};

export default async function LiveDashboard() {
  const { ownerId } = await requireLiveSession();
  const now = Date.now();
  const dayStart = istDayStart(now);

  const [open, places, today, events] = await Promise.all([
    loadOpenTrips(ownerId),
    loadPlaces(ownerId),
    loadToday(ownerId, dayStart),
    loadRecentEvents(ownerId, new Date(now - 24 * 3_600_000).toISOString(), 40),
  ]);
  const byId = placeMap(places);
  const tripById = new Map([...open, ...today].map((t) => [t.id, t]));

  const inTransit = open.filter((t) => t.status === "in_transit");
  const loading = open.filter((t) => t.status === "planned" || t.status === "loading");
  const delayed = inTransit.filter((t) => tripIssues(t, now).some((i) => i.key === "late"));
  const arrivedToday = today.filter((t) => t.arrived_at && t.arrived_at >= dayStart);
  const deliveredToday = today.filter((t) => t.status === "delivered" && t.delivered_at && t.delivered_at >= dayStart);
  const dispatchedToday = today.filter((t) => t.started_at && t.started_at >= dayStart);
  const ewaySoon = open.filter(
    (t) =>
      (t.status === "loading" || t.status === "in_transit") &&
      t.eway_valid_until &&
      new Date(t.eway_valid_until).getTime() - now <= EWAY_DASH_MS,
  );
  const ewayExpired = ewaySoon.filter((t) => new Date(t.eway_valid_until!).getTime() <= now);
  const stopEvents = events.filter(
    (e) => e.kind === "stoppage" && now - new Date(e.created_at).getTime() < 90 * 60 * 1000 && tripById.get(e.trip_id)?.status === "in_transit",
  );
  const stoppedIds = new Set(stopEvents.map((e) => e.trip_id));

  const attention = open
    .filter((t) => tripIssues(t, now).length > 0 || stoppedIds.has(t.id))
    .slice(0, 6);

  const mapTrucks: MapTruck[] = open
    .filter((t) => t.last_lat != null && t.last_lng != null)
    .sort((a, b) => (b.last_point_at ?? "").localeCompare(a.last_point_at ?? ""))
    .slice(0, 30)
    .map((t) => {
      const issues = tripIssues(t, now);
      return {
        id: t.id,
        label: prettyVehicle(t.vehicle_no) || "Truck",
        sub: destinationText(t, t.to_place_id ? byId.get(t.to_place_id)?.name : null),
        lat: t.last_lat!,
        lng: t.last_lng!,
        at: t.last_point_at,
        tone: issues.some((i) => i.tone === "bad") ? "bad" : issues.length || stoppedIds.has(t.id) ? "warn" : "good",
      };
    });

  const facts: OperationsFacts = {
    asOf: new Date(now).toISOString(),
    scope: "live",
    counts: {
      inTransit: inTransit.length,
      delayed: delayed.length,
      arrivedToday: arrivedToday.length,
      deliveredToday: deliveredToday.length,
      stoppedNow: stoppedIds.size,
      ewayExpiringSoon: ewaySoon.length - ewayExpired.length,
      ewayExpired: ewayExpired.length,
      dispatchedToday: dispatchedToday.length,
    },
    delayedTrips: delayed.map((t) => ({
      vehicleNo: prettyVehicle(t.vehicle_no),
      toPlace: destinationText(t, t.to_place_id ? byId.get(t.to_place_id)?.name : null),
      delayMinutes:
        t.eta_at && t.promised_delivery_at
          ? Math.round((new Date(t.eta_at).getTime() - new Date(t.promised_delivery_at).getTime()) / 60000)
          : undefined,
    })),
    stoppages: stopEvents.map((e) => ({
      vehicleNo: prettyVehicle(tripById.get(e.trip_id)?.vehicle_no),
      minutes: Number(/(\d+) min/.exec(e.title)?.[1] ?? 30),
    })),
    ewayExpiring: ewaySoon.map((t) => ({ vehicleNo: prettyVehicle(t.vehicle_no), ewayBillNo: t.eway_bill_no ?? undefined, validUntil: t.eway_valid_until ?? undefined })),
    deliveries: deliveredToday.map((t) => ({
      vehicleNo: prettyVehicle(t.vehicle_no),
      toPlace: destinationText(t, t.to_place_id ? byId.get(t.to_place_id)?.name : null),
      onTime: t.promised_delivery_at && t.delivered_at ? t.delivered_at <= t.promised_delivery_at : undefined,
    })),
  };

  const alertsFeed = events.filter((e) => e.actor !== "owner").slice(0, 8);
  const hasAny = open.length > 0 || today.length > 0;

  return (
    <div className="live-page mx-auto max-w-5xl space-y-5">
      <AutoRefresh ms={45_000} />
      <header className="live-page-head">
        <div>
          <h1>Today</h1>
          <p>{new Date(now).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" })}</p>
        </div>
        <Link href="/live/trips/new" className="live-cta hidden lg:inline-flex">
          + New trip
        </Link>
      </header>

      <Setup places={places} hasTrips={hasAny || events.length > 0} />

      <div className="live-kpis">
        <KpiTile label="In transit" value={inTransit.length} href="/live/trips?status=in_transit" tone="brand" icon={<Truck size={18} />} />
        <KpiTile label="Likely late" value={delayed.length} href="/live/trips?status=in_transit" tone="bad" icon={<AlertTriangle size={18} />} />
        <KpiTile label="E-way < 12 h" value={ewaySoon.length} href="/live/trips?status=open" tone="warn" icon={<FileWarning size={18} />} />
        <KpiTile label="Stopped now" value={stoppedIds.size} href="/live/trips?status=in_transit" tone="warn" icon={<PauseCircle size={18} />} />
        <KpiTile label="Arrived today" value={arrivedToday.length} href="/live/trips?status=arrived" tone="good" icon={<Flag size={18} />} />
        <KpiTile label="Delivered today" value={deliveredToday.length} href="/live/trips?status=delivered" tone="good" icon={<PackageCheck size={18} />} />
      </div>

      {hasAny ? (
        <Suspense fallback={<section className="live-summary live-summary-loading">Reading today’s trips…</section>}>
          <SummaryCard ownerId={ownerId} facts={facts} />
        </Suspense>
      ) : null}

      {attention.length ? (
        <section>
          <SectionTitle title="Needs attention" href="/live/trips?status=open" />
          <div className="live-trip-grid">
            {attention.map((t) => (
              <TripCard key={t.id} trip={t} places={byId} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      {mapTrucks.length ? (
        <section>
          <SectionTitle title="Where the trucks are" />
          <FleetMap trucks={mapTrucks} />
        </section>
      ) : null}

      <section>
        <SectionTitle title={`On the road (${inTransit.length})`} href="/live/trips?status=in_transit" />
        {inTransit.length ? (
          <div className="live-trip-grid">
            {inTransit.slice(0, 8).map((t) => (
              <TripCard key={t.id} trip={t} places={byId} now={now} />
            ))}
          </div>
        ) : (
          <p className="live-empty">No truck on the road right now.</p>
        )}
      </section>

      {loading.length ? (
        <section>
          <SectionTitle title={`Planned / loading (${loading.length})`} href="/live/trips?status=open" />
          <div className="live-trip-grid">
            {loading.slice(0, 6).map((t) => (
              <TripCard key={t.id} trip={t} places={byId} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      {alertsFeed.length ? (
        <section>
          <SectionTitle title="Last 24 hours" />
          <ul className="panel divide-y divide-divider">
            {alertsFeed.map((e: TripEvent) => {
              const Icon = EVENT_ICON[e.kind] ?? Flag;
              const trip = tripById.get(e.trip_id);
              return (
                <li key={e.id}>
                  <Link href={`/live/trips/${e.trip_id}`} className="live-feed-row">
                    <Icon size={16} className="mt-0.5 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1">
                      <strong>{e.title}</strong>
                      <small>
                        {trip ? `${prettyVehicle(trip.vehicle_no)} · ` : ""}
                        {agoShort(e.created_at, now)}
                      </small>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
