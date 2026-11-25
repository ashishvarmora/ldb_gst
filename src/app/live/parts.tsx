import Link from "next/link";
import { AlertTriangle, ChevronRight, Clock, FileWarning, MapPin, Navigation, PauseCircle, WifiOff } from "lucide-react";

import { cx } from "@/components/ui";
import {
  DELAY_GRACE_MS,
  EWAY_DASH_MS,
  NO_SIGNAL_MS,
  STATUS_LABEL,
  STATUS_TONE,
  agoShort,
  destinationText,
  fmtIst,
  prettyVehicle,
  signalState,
  tripNo,
  untilShort,
  type LivePlace,
  type LiveTrip,
  type TripStatus,
} from "@/lib/live/shared";

/** Server-rendered building blocks shared by the Live pages. */

export function StatusPill({ status, className }: { status: TripStatus; className?: string }) {
  return <span className={cx("live-status", `live-status-${STATUS_TONE[status]}`, className)}>{STATUS_LABEL[status]}</span>;
}

export function SignalPill({ trip, now }: { trip: LiveTrip; now: number }) {
  if (trip.status === "delivered" || trip.status === "cancelled") return null;
  const s = signalState(trip, now);
  const map = {
    live: { text: "Live", cls: "live-signal-live", icon: Navigation },
    recent: { text: `GPS ${agoShort(trip.share_last_seen_at ?? trip.last_point_at, now)}`, cls: "live-signal-recent", icon: Clock },
    waiting: { text: "Link not opened", cls: "live-signal-off", icon: Clock },
    stopped: { text: "Driver stopped GPS", cls: "live-signal-warn", icon: PauseCircle },
    off: { text: "GPS link off", cls: "live-signal-off", icon: WifiOff },
  }[s];
  return (
    <span className={cx("live-signal", map.cls)}>
      <map.icon size={12} /> {map.text}
    </span>
  );
}

/** The issues a trip has right now, worst first. Pure, for lists and the dashboard. */
export function tripIssues(trip: LiveTrip, now: number): { key: string; text: string; tone: "bad" | "warn" }[] {
  const out: { key: string; text: string; tone: "bad" | "warn" }[] = [];
  const open = trip.status === "loading" || trip.status === "in_transit";
  if (open && trip.eway_valid_until) {
    const left = new Date(trip.eway_valid_until).getTime() - now;
    if (left <= 0) out.push({ key: "ewayx", text: "E-way bill expired", tone: "bad" });
    else if (left <= EWAY_DASH_MS) out.push({ key: "eway", text: `E-way bill ends ${untilShort(trip.eway_valid_until, now)}`, tone: "warn" });
  }
  if (trip.status === "in_transit" && trip.eta_at && trip.promised_delivery_at) {
    if (new Date(trip.eta_at).getTime() > new Date(trip.promised_delivery_at).getTime() + DELAY_GRACE_MS) {
      out.push({ key: "late", text: "Likely late", tone: "bad" });
    }
  }
  if (trip.status === "in_transit" && trip.share_status === "active") {
    const last = new Date(trip.share_last_seen_at ?? trip.last_point_at ?? 0).getTime();
    if (last && now - last > NO_SIGNAL_MS) out.push({ key: "nosig", text: "No GPS 30+ min", tone: "warn" });
  }
  return out;
}

export function TripCard({ trip, places, now }: { trip: LiveTrip; places: Map<string, LivePlace>; now: number }) {
  const from = trip.from_place_id ? places.get(trip.from_place_id) : null;
  const to = trip.to_place_id ? places.get(trip.to_place_id) : null;
  const issues = tripIssues(trip, now);
  const open = trip.status !== "delivered" && trip.status !== "cancelled";
  return (
    <Link href={`/live/trips/${trip.id}`} className="live-trip-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="live-trip-vehicle">{prettyVehicle(trip.vehicle_no) || "No vehicle yet"}</p>
          <p className="live-trip-no">
            {tripNo(trip.trip_seq)}
            {trip.invoice_no ? ` · Inv ${trip.invoice_no}` : ""}
          </p>
        </div>
        <StatusPill status={trip.status} />
      </div>
      <p className="live-trip-route">
        <MapPin size={14} className="shrink-0" />
        <span className="min-w-0 truncate">
          {from ? `${from.name} → ` : ""}
          <strong>{destinationText(trip, to?.name)}</strong>
        </span>
      </p>
      <div className="live-trip-meta">
        <SignalPill trip={trip} now={now} />
        {open && trip.distance_left_km != null && trip.status !== "arrived" ? <span>{Math.round(trip.distance_left_km)} km left</span> : null}
        {open && trip.eta_at && trip.status === "in_transit" ? <span>ETA {fmtIst(trip.eta_at)}</span> : null}
        {trip.status === "delivered" && trip.delivered_at ? <span>Delivered {fmtIst(trip.delivered_at)}</span> : null}
        {trip.status === "planned" && trip.planned_dispatch_at ? <span>Dispatch {fmtIst(trip.planned_dispatch_at)}</span> : null}
        {trip.driver_name ? <span className="truncate">{trip.driver_name}</span> : null}
      </div>
      {issues.length ? (
        <div className="live-trip-issues">
          {issues.map((i) => (
            <span key={i.key} className={cx("live-issue", i.tone === "bad" ? "live-issue-bad" : "live-issue-warn")}>
              {i.key.startsWith("eway") ? <FileWarning size={12} /> : <AlertTriangle size={12} />} {i.text}
            </span>
          ))}
        </div>
      ) : null}
      <ChevronRight size={16} className="live-trip-chevron" aria-hidden />
    </Link>
  );
}

export function KpiTile({
  label,
  value,
  href,
  tone = "neutral",
  icon,
}: {
  label: string;
  value: number;
  href: string;
  tone?: "neutral" | "brand" | "good" | "warn" | "bad";
  icon: React.ReactNode;
}) {
  return (
    <Link href={href} className={cx("live-kpi", `live-kpi-${tone}`, value === 0 && "is-zero")}>
      <span className="live-kpi-icon">{icon}</span>
      <strong>{value}</strong>
      <small>{label}</small>
    </Link>
  );
}

export function SectionTitle({ title, href, link }: { title: string; href?: string; link?: string }) {
  return (
    <div className="live-section-title">
      <h2>{title}</h2>
      {href ? (
        <Link href={href}>
          {link ?? "See all"} <ChevronRight size={14} />
        </Link>
      ) : null}
    </div>
  );
}
