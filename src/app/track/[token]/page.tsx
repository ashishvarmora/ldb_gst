import type { Metadata } from "next";
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Flag,
  MapPin,
  Package,
  Phone,
  PlayCircle,
  Route,
  Satellite,
  Truck,
  UserRound,
  XCircle,
} from "lucide-react";

import { cx } from "@/components/ui";
import { etaView, progressPct, tripHeading } from "@/lib/live/insight";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logLive, plausibleToken } from "@/lib/live/server";
import {
  LIVE_WINDOW_MS,
  agoShort,
  fmtIst,
  mapsHref,
  osmEmbed,
  prettyVehicle,
  tripState,
  variance,
  type LiveTrip,
} from "@/lib/live/shared";

import { Suspense } from "react";

import { RouteTimeline } from "@/app/live/RouteTimeline";
import { InfoTip } from "@/app/live/parts";
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

  const heading = tripHeading(trip, fromName || null, toName || null);
  const eta = etaView(trip, now);
  const pct = progressPct(fromPt, toPt, trip);
  const moving = state === "active" && trip.status !== "arrived";
  const headline =
    trip.status === "delivered"
      ? { icon: CheckCircle2, text: "Delivered", sub: fmtIst(trip.delivered_at), tone: "good" }
      : trip.status === "arrived"
        ? { icon: Flag, text: "Truck has arrived", sub: fmtIst(trip.arrived_at), tone: "good" }
        : state === "cancelled"
          ? { icon: XCircle, text: "Trip cancelled", sub: "Please contact the sender", tone: "bad" }
          : moving
            ? liveEta && new Date(liveEta).getTime() < now - 10 * 60_000
              ? { icon: Truck, text: "On the way - running late", sub: "Waiting for the truck's next location update", tone: "warn" }
              : { icon: Truck, text: "On the way", sub: liveEta ? `Arriving around ${fmtIst(liveEta, false)}` : "Arrival time updates as the truck moves", tone: eta?.tone === "bad" ? "bad" : eta?.tone === "warn" ? "warn" : "brand" }
            : { icon: CalendarClock, text: "Not started yet", sub: trip.planned_dispatch_at ? `Planned start ${fmtIst(trip.planned_dispatch_at)}` : "The sender will start it soon", tone: "neutral" };

  return (
    <main className="theme-light live-track mx-auto min-h-screen max-w-xl space-y-3 bg-page px-4 py-5">
      {!closed ? <AutoRefresh ms={45_000} /> : null}
      <header className="flex items-center gap-2.5">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[#fff1e6] text-[#c2570c]">
          <Package size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted">{sender ? `Shipment from ${sender}` : "Your shipment"}</p>
          <h1 className="truncate text-base font-bold text-strong">{heading}</h1>
        </div>
        <InfoTip label="About this page">
          This page shows where your shipment is. The truck&apos;s location comes from the driver&apos;s phone and refreshes by itself. Distance and
          arrival time are estimates and change as the truck moves. Only the sender can change this trip.
        </InfoTip>
      </header>

      <section className={cx("lv-cust-hero", `lv-t-${headline.tone}`)}>
        <headline.icon size={26} className="shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="lv-cust-head">{headline.text}</p>
          <p className="lv-cust-sub" suppressHydrationWarning>
            {headline.sub}
            {v && !closed && moving ? <em className={`live-var live-var-${v.tone}`}>{v.text}</em> : null}
          </p>
        </div>
      </section>

      <section className="lv-hero">
        <div className="lv-route" aria-label={`From ${fromName || "start"} to ${toName || "destination"}`}>
          <span className="lv-route-end">
            <span className="lv-route-pin" aria-hidden />
            <span className="truncate">{fromName || "Start"}</span>
          </span>
          <span className="lv-route-track" aria-hidden>
            <span className="lv-route-fill" style={{ width: `${pct ?? (moving ? 50 : 0)}%` }} />
            {moving ? (
              <span className="lv-route-truck" style={{ left: `${pct ?? 50}%` }}>
                <Truck size={12} />
              </span>
            ) : null}
          </span>
          <span className="lv-route-end is-to">
            <MapPin size={13} className="shrink-0" aria-hidden />
            <span className="truncate">{toName || "Destination"}</span>
          </span>
        </div>
      </section>

      {!closed ? (
        <div className="lv-tiles lv-tiles-3">
          <div className={cx("lv-tile", `lv-t-${eta?.tone ?? "neutral"}`)} suppressHydrationWarning>
            <span className="lv-tile-label">
              <Clock size={12} aria-hidden /> {trip.status === "arrived" ? "Arrived" : liveEta ? "Expected" : "Planned"}
            </span>
            <strong>{trip.status === "arrived" ? fmtIst(trip.arrived_at, false) : liveEta ? fmtIst(liveEta, false) : fmtIst(trip.promised_delivery_at)}</strong>
            <small>{liveEta && trip.promised_delivery_at ? `Planned ${fmtIst(trip.promised_delivery_at)}` : " "}</small>
          </div>
          <div className="lv-tile lv-t-brand">
            <span className="lv-tile-label">
              <Route size={12} aria-hidden /> Distance left
            </span>
            <strong>{moving && trip.distance_left_km != null ? `${Math.round(trip.distance_left_km)} km` : "-"}</strong>
            <small>approx</small>
          </div>
          <div className={cx("lv-tile", fresh ? "lv-t-good" : "lv-t-neutral")} suppressHydrationWarning>
            <span className="lv-tile-label">
              <Satellite size={12} aria-hidden /> Updated
            </span>
            <strong>{trip.last_point_at ? (fresh ? "Live" : agoShort(trip.last_point_at, now).replace(" ago", "")) : "-"}</strong>
            <small>{fresh ? "right now" : trip.last_point_at ? "ago" : " "}</small>
          </div>
        </div>
      ) : null}

      {trip.status === "delivered" && trip.pod_note ? <p className="lv-note">Note from delivery: {trip.pod_note}</p> : null}

      {pos ? (
        <section className="panel overflow-hidden">
          <div className="live-map-frame live-map-lg">
            <iframe title="Truck position" src={osmEmbed(pos, toPt)} loading="lazy" referrerPolicy="no-referrer" />
            <a href={mapsHref(pos.lat, pos.lng)} target="_blank" rel="noopener noreferrer" className="live-map-open">
              <MapPin size={13} /> Open in Maps
            </a>
          </div>
        </section>
      ) : null}

      {state !== "cancelled" ? (
        <Suspense fallback={null}>
          <RouteTimeline trip={trip} from={fromPt ? { ...fromPt, name: fromName || "Start" } : null} to={toPt ? { ...toPt, name: toName || "Destination" } : null} customer />
        </Suspense>
      ) : null}

      <section className="lv-facts">
        <span className="lv-fact">
          <Truck size={14} aria-hidden />
          <span>
            <small>Truck</small>
            <b className="font-mono">{prettyVehicle(trip.vehicle_no) || "-"}</b>
          </span>
        </span>
        {showDriver && driverFirst ? (
          <span className="lv-fact">
            <UserRound size={14} aria-hidden />
            <span>
              <small>Driver</small>
              <b>{driverFirst}</b>
            </span>
            {callDriver && trip.driver_phone && !closed ? (
              <a href={`tel:${trip.driver_phone}`} className="lv-fact-call" aria-label={`Call ${driverFirst}`}>
                <Phone size={14} /> Call
              </a>
            ) : null}
          </span>
        ) : null}
        {goods ? (
          <span className="lv-fact">
            <Package size={14} aria-hidden />
            <span>
              <small>Goods</small>
              <b>{goods}</b>
            </span>
          </span>
        ) : null}
        {trip.started_at ? (
          <span className="lv-fact">
            <PlayCircle size={14} aria-hidden />
            <span>
              <small>Started</small>
              <b>{fmtIst(trip.started_at)}</b>
            </span>
          </span>
        ) : null}
      </section>
      <p className="text-center text-[11px] text-faint">Powered by Rahdari</p>
    </main>
  );
}
