import type { Metadata } from "next";
import { CheckCircle2, MapPin, Truck } from "lucide-react";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { logLive, plausibleToken } from "@/lib/live/server";
import {
  LIVE_WINDOW_MS,
  STATUS_LABEL,
  agoShort,
  fmtIst,
  mapsHref,
  osmEmbed,
  prettyVehicle,
  type LiveTrip,
} from "@/lib/live/shared";

import { AutoRefresh } from "@/app/live/widgets";
import "@/app/live/live.css";

/**
 * /track/<token> - the read-only page a factory shares with its customer
 * (live module, 0079). Shows status, the truck's last position, distance and
 * ETA. Never the driver's number, invoice value, freight or e-way bill.
 * The owner switches it off from the trip page (token set to null).
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Track consignment",
  robots: { index: false, follow: false, nocache: true },
  referrer: "no-referrer",
};

type Row = Pick<
  LiveTrip,
  | "id"
  | "owner_id"
  | "status"
  | "vehicle_no"
  | "to_name"
  | "to_city"
  | "to_place_id"
  | "invoice_no"
  | "material"
  | "last_lat"
  | "last_lng"
  | "last_point_at"
  | "distance_left_km"
  | "eta_at"
  | "started_at"
  | "arrived_at"
  | "delivered_at"
  | "promised_delivery_at"
>;

export default async function TrackPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let trip: Row | null = null;
  let ownerName = "";
  if (plausibleToken(token)) {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from("live_trips")
      .select(
        "id,owner_id,status,vehicle_no,to_name,to_city,to_place_id,invoice_no,material,last_lat,last_lng,last_point_at,distance_left_km,eta_at,started_at,arrived_at,delivered_at,promised_delivery_at",
      )
      .eq("track_token", token)
      .maybeSingle<Row>();
    if (error) logLive("track page", error);
    trip = data ?? null;
    if (trip) {
      const { data: owner } = await admin.from("profiles").select("office,full_name").eq("id", trip.owner_id).maybeSingle<{ office: string | null; full_name: string | null }>();
      ownerName = (owner?.office || owner?.full_name || "").trim();
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
  const done = trip.status === "delivered" || trip.status === "cancelled";
  const pos = !done && trip.last_lat != null && trip.last_lng != null ? { lat: trip.last_lat, lng: trip.last_lng } : null;
  const fresh = trip.last_point_at ? now - new Date(trip.last_point_at).getTime() < LIVE_WINDOW_MS * 2 : false;
  const dest = [trip.to_name, trip.to_city].filter(Boolean).join(", ");

  return (
    <main className="theme-light live-track mx-auto min-h-screen max-w-xl space-y-4 bg-page px-4 py-6">
      {!done ? <AutoRefresh ms={60_000} /> : null}
      <header className="flex items-center gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-[#fff1e6] text-[#c2570c]">
          <Truck size={22} />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted">{ownerName ? `Shipment from ${ownerName}` : "Shipment"}</p>
          <h1 className="font-mono text-xl font-bold text-strong">{prettyVehicle(trip.vehicle_no) || "Truck"}</h1>
        </div>
        <span className="live-status live-status-brand ml-auto">{STATUS_LABEL[trip.status]}</span>
      </header>

      {trip.status === "delivered" ? (
        <section className="panel flex items-center gap-3 p-4 text-good-500">
          <CheckCircle2 size={22} />
          <p className="font-semibold">Delivered {fmtIst(trip.delivered_at)}</p>
        </section>
      ) : null}

      <section className="panel overflow-hidden">
        {pos ? (
          <div className="live-map-frame live-map-lg">
            <iframe title="Truck position" src={osmEmbed(pos)} loading="lazy" referrerPolicy="no-referrer" />
          </div>
        ) : null}
        <dl className="live-stats">
          <div>
            <dt>Going to</dt>
            <dd>{dest || "-"}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{trip.last_point_at ? `${agoShort(trip.last_point_at, now)}${fresh ? " (live)" : ""}` : "-"}</dd>
          </div>
          <div>
            <dt>Distance left</dt>
            <dd>{!done && trip.distance_left_km != null ? `~${Math.round(trip.distance_left_km)} km` : "-"}</dd>
          </div>
          <div>
            <dt>Expected</dt>
            <dd>{!done && trip.status === "in_transit" && trip.eta_at ? fmtIst(trip.eta_at) : trip.status === "arrived" ? "Arrived" : fmtIst(trip.promised_delivery_at)}</dd>
          </div>
        </dl>
        {pos ? (
          <a href={mapsHref(pos.lat, pos.lng)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 border-t border-divider px-4 py-3 text-sm font-semibold text-brand-600">
            <MapPin size={15} /> Open in Google Maps
          </a>
        ) : null}
      </section>

      {trip.invoice_no || trip.material ? (
        <p className="text-sm text-muted">
          {[trip.invoice_no ? `Invoice ${trip.invoice_no}` : null, trip.material].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      <p className="text-xs text-faint">Location from the driver&apos;s phone; distance is approximate. Powered by Rahdari.</p>
    </main>
  );
}
