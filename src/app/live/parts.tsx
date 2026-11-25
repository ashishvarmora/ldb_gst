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
  driverSignal,
  SIGNAL_LABEL,
  type DriverSignal,
  type LiveDriver,
  type LivePlace,
  type LiveTrip,
  type LiveVehicle,
  type TripEvent,
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
          <p className="live-trip-vehicle">{trip.driver_name || prettyVehicle(trip.vehicle_no) || "No driver"}</p>
          <p className="live-trip-no">
            {tripNo(trip.trip_seq)}
            {trip.trip_name ? ` · ${trip.trip_name}` : ""}
            {trip.vehicle_no && trip.driver_name ? ` · ${prettyVehicle(trip.vehicle_no)}` : ""}
          </p>
        </div>
        <StatusPill status={trip.status} />
      </div>
      <p className="live-trip-route">
        <MapPin size={14} className="shrink-0" />
        <span className="min-w-0 truncate">
          {from || trip.from_name ? `${from?.name ?? trip.from_name} → ` : ""}
          <strong>{destinationText(trip, to?.name)}</strong>
        </span>
      </p>
      <div className="live-trip-meta">
        <SignalPill trip={trip} now={now} />
        {open && trip.distance_left_km != null && trip.status !== "arrived" ? <span>{Math.round(trip.distance_left_km)} km left</span> : null}
        {open && trip.eta_at && trip.status === "in_transit" ? <span>ETA {fmtIst(trip.eta_at)}</span> : null}
        {trip.status === "delivered" && trip.delivered_at ? <span>Delivered {fmtIst(trip.delivered_at)}</span> : null}
        {trip.status === "planned" && trip.planned_dispatch_at ? <span>Dispatch {fmtIst(trip.planned_dispatch_at)}</span> : null}
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

/* -------------------------------------------------------------------------- */
/* 0081: driver-first                                                          */
/* -------------------------------------------------------------------------- */

const SIGNAL_TONE: Record<DriverSignal, string> = {
  live: "good",
  recent: "brand",
  idle: "warn",
  waiting: "neutral",
  stopped: "warn",
  expired: "neutral",
  off: "neutral",
};

export function DriverSignalPill({ driver, now }: { driver: LiveDriver; now: number }) {
  const s = driverSignal(driver, now);
  const text =
    s === "recent" || s === "idle"
      ? `${s === "idle" ? "No signal · " : ""}${agoShort(driver.share_last_seen_at ?? driver.last_point_at, now)}`
      : SIGNAL_LABEL[s];
  return (
    <span className={cx("live-dsig", `live-dsig-${SIGNAL_TONE[s]}`)} suppressHydrationWarning>
      <span className="live-dsig-dot" aria-hidden />
      {text}
    </span>
  );
}

export function KindChip({ driver }: { driver: Pick<LiveDriver, "kind" | "company"> }) {
  if (driver.kind !== "one_time") return <span className="live-kind live-kind-own">Own</span>;
  return (
    <span className="live-kind live-kind-once" title={driver.company ?? undefined}>
      One-time{driver.company ? ` · ${driver.company}` : ""}
    </span>
  );
}

export function DriverCard({
  driver,
  vehicle,
  trip,
  places,
  now,
}: {
  driver: LiveDriver;
  vehicle: LiveVehicle | null;
  trip: LiveTrip | null;
  places: Map<string, LivePlace>;
  now: number;
}) {
  const s = driverSignal(driver, now);
  const to = trip?.to_place_id ? places.get(trip.to_place_id) : null;
  return (
    <Link href={`/live/drivers/${driver.id}`} className="live-driver-card">
      <span className={cx("live-avatar", `live-avatar-${SIGNAL_TONE[s]}`)} aria-hidden>
        {driver.name.trim().charAt(0).toUpperCase() || "D"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="live-driver-top">
          <strong className="truncate">{driver.name}</strong>
          <KindChip driver={driver} />
        </span>
        <span className="live-driver-sub">
          {vehicle ? <span className="font-mono">{prettyVehicle(vehicle.number)}</span> : <span>No truck</span>}
          <span aria-hidden>·</span>
          {trip ? (
            <span className="truncate">
              {tripNo(trip.trip_seq)} → {destinationText(trip, to?.name)}
            </span>
          ) : (
            <span>No trip</span>
          )}
        </span>
        <DriverSignalPill driver={driver} now={now} />
      </span>
      <ChevronRight size={16} className="shrink-0 text-faint" aria-hidden />
    </Link>
  );
}

/** Activity row text: "who · when", plus old -> new when a field changed. */
export function ActivityList({ events, showTrip = false }: { events: TripEvent[]; showTrip?: boolean }) {
  if (!events.length) return <p className="live-empty">Nothing recorded yet.</p>;
  return (
    <ol className="live-timeline">
      {events.map((e) => (
        <li key={e.id} className={`live-tl-${e.kind}`}>
          <span className="live-tl-dot" aria-hidden />
          <div className="min-w-0">
            <p className="live-tl-title">{e.title}</p>
            {e.field && (e.old_value || e.new_value) && !e.detail ? (
              <p className="live-tl-detail">
                {e.old_value || "-"} → {e.new_value || "-"}
              </p>
            ) : null}
            {e.detail ? <p className="live-tl-detail">{e.detail}</p> : null}
            <p className="live-tl-when">
              {fmtIst(e.created_at)} · {e.actor === "owner" ? "You" : e.actor === "driver" ? "Driver" : "Auto"}
              {showTrip && e.trip_id ? (
                <>
                  {" · "}
                  <Link href={`/live/trips/${e.trip_id}`}>trip</Link>
                </>
              ) : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
