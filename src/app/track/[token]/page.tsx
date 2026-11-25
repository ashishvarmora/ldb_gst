import type { Metadata } from "next";
import { CheckCircle2, MapPin, Package, Phone, Truck, UserRound } from "lucide-react";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logLive, plausibleToken } from "@/lib/live/server";
import {
  LIVE_WINDOW_MS,
  STATE_LABEL,
  STATE_TONE,
  agoShort,
  fmtIst,
  mapsHref,
  osmEmbed,
  prettyVehicle,
  tripNo,
  tripState,
  variance,
  type LiveTrip,
} from "@/lib/live/shared";

import { Suspense } from "react";

import { RouteTimeline } from "@/app/live/RouteTimeline";
import { AutoRefresh } from "@/app/live/widgets";
import "@/app/live/live.css";

/**
 * /track/<token> - the read-only page a business shares with its customer
 * (v5, docs/LIVE-PLAN-v5.md §8). What a customer needs: trip, sender, route,
 * status, map, planned arrival and live ETA, distance left, driver first name
 * (call button only if the owner opted in), truck, goods, delivery.
 * Never: invoice value, freight, e-way bill, notes, activity.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Track consignment",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

/* v6: the whole row is read on the server (the route timeline needs times, coordinates and the cached
   route plan); only the fields below are ever rendered. Never invoice value, freight, e-way bill, notes. */
type Row = LiveTrip;
type P = { id: string; name: string; lat: number | null; lng: number | null };

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let trip: Row | null = null;
  let sender = "";
  let fromName = "";
  let toName = "";
  let fromPt: { lat: number; lng: number } | null = null;
  let toPt: { lat: number; lng: number } | null = null;
  let showDriver = true;
  let callDriver = false;
  if (plausibleToken(token)) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.from("live_trips").select("*").eq("track_token", token).maybeSingle<Row>();
    if (error) logLive("track page", error);
    trip = data ?? null;
    if (trip) {
      const ids = [trip.from_place_id, trip.to_place_id].filter(Boolean) as string[];
      const [owner, lp, pl] = await Promise.all([
        admin.from("profiles").select("office,full_name").eq("id", trip.owner_id).maybeSingle<{ office: string | null; full_name: string | null }>(),
        admin.from("live_profiles").select("*").eq("owner_id", trip.owner_id).maybeSingle<{ business_name: string | null; track_show_driver?: boolean | null; track_call_driver?: boolean | null }>(),
        ids.length ? admin.from("live_places").select("id,name,lat,lng").in("id", ids) : Promise.resolve({ data: [] as P[] }),
      ]);
      sender = (lp.data?.business_name || owner.data?.office || owner.data?.full_name || "").trim();
      showDriver = lp.data?.track_show_driver !== false;
      callDriver = lp.data?.track_call_driver === true;
      const rows = new Map(((pl.data ?? []) as P[]).map((p) => [p.id, p]));
      const names = new Map([...rows.values()].map((p) => [p.id, p.name]));
      const fp = trip.from_place_id ? rows.get(trip.from_place_id) : null;
      const tp = trip.to_place_id ? rows.get(trip.to_place_id) : null;
      fromPt = trip.from_lat != null && trip.from_lng != null ? { lat: trip.from_lat, lng: trip.from_lng } : fp?.lat != null && fp?.lng != null ? { lat: fp.lat, lng: fp.lng } : null;
      toPt = trip.to_lat != null && trip.to_lng != null ? { lat: trip.to_lat, lng: trip.to_lng } : tp?.lat != null && tp?.lng != null ? { lat: tp.lat, lng: tp.lng } : null;
      fromName = (trip.from_place_id ? names.get(trip.from_place_id) : null) ?? trip.from_name ?? "";
      toName = [(trip.to_place_id ? names.get(trip.to_place_id) : null) ?? trip.to_name, trip.to_city].filter(Boolean).join(", ");
    }
  }

  if (!trip) {
    return (
      <main className="theme-light mx-auto flex min-h-screen max-w-md flex-col justify-center gap-2 bg-page px-5 text-center">
        <h1 className="text-xl font-bold text-strong">Link not active</h1>
        <p className="text-sm text-muted">This tracking link has been switched off or is not valid. Ask the sender for a new one.</p>
      </main>
    );
  }

  const now = Date.now();
  const state = tripState(trip);
  const closed = state === "done" || state === "cancelled";
  const pos = !closed && trip.last_lat != null && trip.last_lng != null ? { lat: trip.last_lat, lng: trip.last_lng } : null;
  const fresh = trip.last_point_at ? now - new Date(trip.last_point_at).getTime() < LIVE_WINDOW_MS * 2 : false;
  const liveEta = state === "active" && trip.status !== "arrived" ? trip.eta_at : null;
  const v = variance(trip.arrived_at ?? trip.delivered_at ?? liveEta, trip.promised_delivery_at);
  const goods = [trip.material, trip.quantity != null ? `${trip.quantity} ${trip.quantity_unit ?? ""}`.trim() : null, trip.weight_kg != null ? `${trip.weight_kg} kg` : null].filter(Boolean).join(" · ");
  const driverFirst = trip.driver_name?.trim().split(/\s+/)[0] ?? "";

  return (
    <main className="theme-light live-track mx-auto min-h-screen max-w-xl space-y-3 bg-page px-4 py-5">
      {!closed ? <AutoRefresh ms={60_000} /> : null}
      <header className="flex items-start gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[#fff1e6] text-[#c2570c]">
          <Truck size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-muted">{sender ? `Shipment from ${sender}` : "Shipment"}</p>
          <h1 className="truncate text-lg font-bold text-strong">
            {tripNo(trip.trip_seq)}
            {trip.trip_name ? ` · ${trip.trip_name}` : ""}
          </h1>
          <p className="truncate text-sm text-ink">
            {fromName ? `${fromName} → ` : ""}
            <strong>{toName || "-"}</strong>
          </p>
        </div>
        <span className={`live-status live-status-${STATE_TONE[state]}`}>
          {STATE_LABEL[state]}
          {trip.status === "arrived" ? " · arrived" : ""}
        </span>
      </header>

      {trip.status === "delivered" ? (
        <section className="panel p-3 text-good-500">
          <p className="flex items-center gap-2 font-semibold">
            <CheckCircle2 size={18} /> Delivered {fmtIst(trip.delivered_at)}
          </p>
          {trip.pod_note ? <p className="mt-1 text-sm text-ink">{trip.pod_note}</p> : null}
        </section>
      ) : null}

      <section className="panel overflow-hidden">
        {pos ? (
          <div className="live-map-frame live-map-lg">
            <iframe title="Truck position" src={osmEmbed(pos)} loading="lazy" referrerPolicy="no-referrer" />
            <a href={mapsHref(pos.lat, pos.lng)} target="_blank" rel="noopener noreferrer" className="live-map-open">
              <MapPin size={13} /> Maps
            </a>
          </div>
        ) : null}
        <dl className="live-stats">
          <div>
            <dt>Last update</dt>
            <dd>{trip.last_point_at && !closed ? `${agoShort(trip.last_point_at, now)}${fresh ? " · live" : ""}` : "-"}</dd>
          </div>
          <div>
            <dt>Distance left</dt>
            <dd>{!closed && trip.distance_left_km != null && trip.status !== "arrived" ? `~${Math.round(trip.distance_left_km)} km` : "-"}</dd>
          </div>
          <div>
            <dt>Planned arrival</dt>
            <dd>{fmtIst(trip.promised_delivery_at)}</dd>
          </div>
          <div>
            <dt>{trip.status === "arrived" ? "Arrived" : "Live ETA"}</dt>
            <dd>
              {trip.status === "arrived" ? fmtIst(trip.arrived_at) : liveEta ? fmtIst(liveEta) : "-"}
              {v && !closed ? <em className={`live-var live-var-${v.tone}`}>{v.text}</em> : null}
            </dd>
          </div>
        </dl>
      </section>

      {state !== "cancelled" ? (
        <Suspense fallback={null}>
          <RouteTimeline trip={trip} from={fromPt ? { ...fromPt, name: fromName || "Start" } : null} to={toPt ? { ...toPt, name: toName || "Destination" } : null} customer />
        </Suspense>
      ) : null}

      <section className="panel p-3">
        <dl className="live-dl live-dl-tight">
          <div className="live-dl-row">
            <dt>
              <Truck size={13} className="inline" /> Truck
            </dt>
            <dd className="font-mono">{prettyVehicle(trip.vehicle_no) || "-"}</dd>
          </div>
          {showDriver && driverFirst ? (
            <div className="live-dl-row">
              <dt>
                <UserRound size={13} className="inline" /> Driver
              </dt>
              <dd className="flex items-center gap-2">
                {driverFirst}
                {callDriver && trip.driver_phone && !closed ? (
                  <a href={`tel:${trip.driver_phone}`} className="live-ib" aria-label={`Call ${driverFirst}`}>
                    <Phone size={14} />
                  </a>
                ) : null}
              </dd>
            </div>
          ) : null}
          {goods ? (
            <div className="live-dl-row">
              <dt>
                <Package size={13} className="inline" /> Goods
              </dt>
              <dd>{goods}</dd>
            </div>
          ) : null}
          {trip.started_at ? (
            <div className="live-dl-row">
              <dt>Started</dt>
              <dd>{fmtIst(trip.started_at)}</dd>
            </div>
          ) : null}
        </dl>
      </section>
      <p className="text-xs text-faint">Location from the driver&apos;s phone; distance and ETA are approximate. Powered by Rahdari.</p>
    </main>
  );
}
