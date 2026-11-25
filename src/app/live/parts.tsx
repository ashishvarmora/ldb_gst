import Link from "next/link";
import { AlertTriangle, ChevronRight, Clock, FileWarning, Info, Navigation, PauseCircle, WifiOff } from "lucide-react";

import { cx } from "@/components/ui";
import {
  DELAY_GRACE_MS,
  EWAY_DASH_MS,
  NO_SIGNAL_MS,
  STATE_LABEL,
  STATE_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  dayLabel,
  tripState,
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
  type TripState,
  type TripStatus,
} from "@/lib/live/shared";

/** Server-rendered building blocks shared by the Live pages. */

export function StatusPill({ status, className }: { status: TripStatus; className?: string }) {
  return <span className={cx("live-status", `live-status-${STATUS_TONE[status]}`, className)}>{STATUS_LABEL[status]}</span>;
}

/** v4: Planned / Active / Done / Cancelled, with the sub-step (Arrived) when it helps. */
export function StatePill({ trip, className }: { trip: Pick<LiveTrip, "status">; className?: string }) {
  const st = tripState(trip);
  return (
    <span className={cx("live-status", `live-status-${STATE_TONE[st]}`, className)}>
      {STATE_LABEL[st]}
      {trip.status === "arrived" ? " · arrived" : ""}
    </span>
  );
}

/** (i) explanation that opens on tap; no JS. */
export function InfoTip({ label = "What is this?", children }: { label?: string; children: React.ReactNode }) {
  return (
    <details className="live-info">
      <summary aria-label={label}>
        <Info size={14} />
      </summary>
      <div className="live-info-pop">{children}</div>
    </details>
  );
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

/**
 * v6 compact trip row (list hierarchy: what you scan for, nothing more).
 *   1  trip no + name · issue icons · status chip
 *   2  driver · truck (truck in plate font, driver in body font)
 *   3  from → to · right: km left + ETA / done time / planned start
 * Everything else (goods, documents, timeline) lives on the trip page.
 */
export function TripCard({ trip, places, now, href }: { trip: LiveTrip; places: Map<string, LivePlace>; now: number; href?: string }) {
  const from = trip.from_place_id ? places.get(trip.from_place_id) : null;
  const to = trip.to_place_id ? places.get(trip.to_place_id) : null;
  const issues = tripIssues(trip, now);
  const st = tripState(trip);
  const fromText = from?.name ?? trip.party_name ?? trip.from_name ?? null;
  let tail: string | null = null;
  if (st === "active" && trip.status !== "arrived") {
    tail = [trip.distance_left_km != null ? `${Math.round(trip.distance_left_km)} km` : null, trip.eta_at ? `ETA ${fmtIst(trip.eta_at, false)}` : null].filter(Boolean).join(" · ") || null;
  } else if (trip.status === "arrived") tail = trip.arrived_at ? `Arrived ${fmtIst(trip.arrived_at, false)}` : "Arrived";
  else if (st === "done" && trip.delivered_at) tail = `Done ${fmtIst(trip.delivered_at)}`;
  else if (st === "planned" && trip.planned_dispatch_at) tail = `Starts ${fmtIst(trip.planned_dispatch_at)}`;
  return (
    <Link href={href ?? `/live/trips/${trip.id}`} className="live-trow">
      <span className="live-trow-l1">
        <strong className="truncate">
          {tripNo(trip.trip_seq)}
          {trip.trip_name ? <span className="live-trow-name"> {trip.trip_name}</span> : null}
        </strong>
        {issues.map((i) => (
          <span key={i.key} className={cx("live-trow-ic", i.tone === "bad" ? "is-bad" : "is-warn")} title={i.text} aria-label={i.text}>
            {i.key.startsWith("eway") ? <FileWarning size={12} /> : i.key === "nosig" ? <WifiOff size={12} /> : <AlertTriangle size={12} />}
          </span>
        ))}
        <StatePill trip={trip} className="live-status-xs" />
      </span>
      <span className="live-trow-l2">
        <span className={cx("live-dot", trip.direction === "incoming" ? "is-in" : "is-out")} title={trip.direction === "incoming" ? "Receiving" : "Sending"} aria-hidden />
        <span className="truncate">{trip.driver_name || "No driver"}</span>
        {trip.vehicle_no ? <span className="live-plate">{prettyVehicle(trip.vehicle_no)}</span> : null}
        {trip.driver_id && st === "active" ? <SignalPill trip={trip} now={now} /> : null}
      </span>
      <span className="live-trow-l3">
        <span className="min-w-0 truncate">
          {fromText ? `${fromText} → ` : ""}
          {destinationText(trip, to?.name)}
        </span>
        {tail ? <span className="live-trow-tail">{tail}</span> : null}
      </span>
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

/** Own drivers need no chip; a receiving trip's driver is "Trip-only" (0082). */
export function KindChip({ driver }: { driver: Pick<LiveDriver, "kind" | "company"> }) {
  if (driver.kind !== "one_time") return null;
  return (
    <span className="live-kind live-kind-once" title={driver.company ?? undefined}>
      Trip-only{driver.company ? ` · ${driver.company}` : ""}
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
            {e.reason && !(e.detail ?? "").includes(e.reason) ? <p className="live-tl-detail">Reason: {e.reason}</p> : null}
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

const PHASE_NOTE: Record<TripState, string> = {
  planned: "Set-up before the start",
  active: "On the road",
  done: "After delivery",
  cancelled: "After cancelling",
};

/** A trip's activity in one accordion per phase (only one open at a time). */
export function PhaseSections({
  groups,
  group,
  openPhase,
}: {
  groups: { phase: TripState; events: TripEvent[] }[];
  group: string;
  openPhase?: TripState | null;
}) {
  if (!groups.length) return <p className="live-empty">Nothing recorded yet.</p>;
  return (
    <div className="live-acc">
      {groups.map((g) => (
        <details key={g.phase} name={group} open={g.phase === (openPhase ?? groups[groups.length - 1].phase) || undefined}>
          <summary>
            <span className={cx("live-status", `live-status-${STATE_TONE[g.phase]}`)}>{STATE_LABEL[g.phase]}</span>
            <small>{PHASE_NOTE[g.phase]}</small>
            <span className="live-acc-count">{g.events.length}</span>
          </summary>
          <div className="live-acc-body">
            <ActivityList events={g.events} />
          </div>
        </details>
      ))}
    </div>
  );
}

export type TripLabel = { id: string; trip_seq: number; trip_name?: string | null };

/** Day accordions (driver / warehouse activity). */
export function DaySections({
  days,
  group,
  trips,
}: {
  days: { day: string; events: TripEvent[]; points: number | null }[];
  group: string;
  trips: Map<string, TripLabel>;
}) {
  if (!days.length) return <p className="live-empty">Nothing recorded yet.</p>;
  return (
    <div className="live-acc">
      {days.map((d, i) => {
        const tripIds = [...new Set(d.events.map((e) => e.trip_id).filter(Boolean) as string[])];
        return (
          <details key={d.day} name={group} open={i === 0 || undefined}>
            <summary>
              <strong>{dayLabel(d.day)}</strong>
              <small>
                {tripIds.length ? `${tripIds.length} trip${tripIds.length === 1 ? "" : "s"}` : "No trip"}
                {d.points != null ? ` · ${d.points} positions` : ""}
              </small>
              <span className="live-acc-count">{d.events.length}</span>
            </summary>
            <div className="live-acc-body">
              {tripIds.length ? (
                <p className="live-acc-links">
                  {tripIds.map((id) => {
                    const t = trips.get(id);
                    return (
                      <Link key={id} href={`/live/trips/${id}`}>
                        {t ? `${tripNo(t.trip_seq)}${t.trip_name ? ` · ${t.trip_name}` : ""}` : "Trip"} <ChevronRight size={12} />
                      </Link>
                    );
                  })}
                </p>
              ) : null}
              <ActivityList events={d.events} />
            </div>
          </details>
        );
      })}
    </div>
  );
}
