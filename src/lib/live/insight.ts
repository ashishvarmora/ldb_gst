/**
 * v7 view helpers: the few facts a trip is judged by at a glance, each as a
 * short text plus a colour tone. Pure functions over a trip row, shared by the
 * owner's lists, the trip page, the Today dashboard and the customer page, so
 * all of them say the same thing in the same colour.
 *
 * Tone conventions (same as every fleet tool): good = green (on time, live),
 * warn = amber (at risk, signal getting old, standing), bad = red (late, no
 * signal, expired), brand = blue (moving / informational), neutral = grey.
 */
import {
  DELAY_GRACE_MS,
  LIVE_WINDOW_MS,
  NO_SIGNAL_MS,
  agoShort,
  durationShort,
  fmtIst,
  roadKm,
  tripState,
  type LiveTrip,
} from "@/lib/live/shared";

export type Tone = "good" | "warn" | "bad" | "brand" | "neutral";
export type View = { text: string; sub?: string; tone: Tone };

/** Below this a phone's GPS speed is noise from a parked truck, not movement. */
export const STOPPED_KMPH = 4;

/**
 * The name a trip is shown by. The trip number (T-0006) is a reference for
 * the records, not something a person scans for; the owner's own name for the
 * trip is, and failing that the route.
 */
export function tripHeading(
  trip: Pick<LiveTrip, "trip_name">,
  fromText: string | null | undefined,
  toText: string | null | undefined,
): string {
  const name = trip.trip_name?.trim();
  if (name) return name;
  const to = toText && toText !== "Destination not set" ? toText : null;
  if (fromText && to) return `${fromText} → ${to}`;
  if (to) return `To ${to}`;
  if (fromText) return `From ${fromText}`;
  return "Untitled trip";
}

/** Minutes the live ETA is past the promised arrival (negative = early). Null when either is missing. */
export function lateMinutes(trip: Pick<LiveTrip, "eta_at" | "promised_delivery_at">): number | null {
  if (!trip.eta_at || !trip.promised_delivery_at) return null;
  const d = (new Date(trip.eta_at).getTime() - new Date(trip.promised_delivery_at).getTime()) / 60000;
  return Number.isFinite(d) ? Math.round(d) : null;
}

/** Time only when it is today (IST), date and time otherwise. */
function when(iso: string | null | undefined, now: number): string {
  if (!iso) return "-";
  const day = (t: number) => new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return fmtIst(iso, day(new Date(iso).getTime()) !== day(now));
}

/**
 * The arrival line: ETA with on-time / late colour while moving, the actual
 * time once arrived or delivered, the planned start before it moves.
 */
export function etaView(trip: LiveTrip, now: number = Date.now()): View | null {
  const st = tripState(trip);
  if (st === "cancelled") return null;
  if (trip.status === "delivered") {
    const at = trip.delivered_at;
    const late = at && trip.promised_delivery_at ? (new Date(at).getTime() - new Date(trip.promised_delivery_at).getTime()) / 60000 : null;
    return {
      text: at ? when(at, now) : "Delivered",
      sub: late == null ? "Delivered" : late > DELAY_GRACE_MS / 60000 ? `${durationShort(late)} late` : "On time",
      tone: late != null && late > DELAY_GRACE_MS / 60000 ? "warn" : "good",
    };
  }
  if (trip.status === "arrived") return { text: trip.arrived_at ? when(trip.arrived_at, now) : "Arrived", sub: "Arrived", tone: "good" };
  if (st === "planned") {
    return trip.planned_dispatch_at
      ? { text: when(trip.planned_dispatch_at, now), sub: "Planned start", tone: "neutral" }
      : null;
  }
  if (!trip.eta_at) return trip.promised_delivery_at ? { text: when(trip.promised_delivery_at, now), sub: "Planned arrival", tone: "neutral" } : null;
  if (new Date(trip.eta_at).getTime() < now - 10 * 60_000) {
    // The ETA was worked out from the last position and that moment has passed: the GPS went quiet before arrival.
    return { text: when(trip.eta_at, now), sub: "Overdue - no new GPS", tone: "bad" };
  }
  const late = lateMinutes(trip);
  const stale = trip.last_point_at ? now - new Date(trip.last_point_at).getTime() > NO_SIGNAL_MS : true;
  if (late == null) return { text: when(trip.eta_at, now), sub: stale ? "ETA (old GPS)" : "ETA", tone: stale ? "warn" : "brand" };
  if (late > DELAY_GRACE_MS / 60000) return { text: when(trip.eta_at, now), sub: `Late ${durationShort(late)}`, tone: "bad" };
  if (late > 0) return { text: when(trip.eta_at, now), sub: `At risk +${durationShort(late)}`, tone: "warn" };
  return { text: when(trip.eta_at, now), sub: stale ? "On time (old GPS)" : "On time", tone: stale ? "warn" : "good" };
}

/**
 * How fresh the position is. Live under 2.5 min, then "12 min ago" (amber
 * after 10 min), red with "No GPS" after 30 min - the same thresholds the
 * alerts use.
 */
export function gpsView(
  trip: Pick<LiveTrip, "status" | "share_status" | "last_point_at" | "share_last_seen_at">,
  now: number = Date.now(),
): View | null {
  const st = tripState(trip as LiveTrip);
  if (st === "done" || st === "cancelled") return null;
  if (trip.share_status === "revoked") return { text: "Link off", tone: "neutral" };
  if (trip.share_status === "stopped") return { text: "Driver paused", tone: "warn" };
  const lastIso = trip.share_last_seen_at ?? trip.last_point_at;
  if (!lastIso) return trip.share_status === "invited" ? { text: "Link not opened", tone: "neutral" } : { text: "No GPS yet", tone: "neutral" };
  const age = now - new Date(lastIso).getTime();
  if (age <= LIVE_WINDOW_MS) return { text: "Live", tone: "good" };
  if (age <= 10 * 60_000) return { text: agoShort(lastIso, now), tone: "brand" };
  if (age <= NO_SIGNAL_MS) return { text: agoShort(lastIso, now), tone: "warn" };
  return { text: `No GPS ${agoShort(lastIso, now).replace(" ago", "")}`, tone: "bad" };
}

/**
 * Speed as a person reads it. A parked truck's GPS wanders a few km/h, so
 * anything under STOPPED_KMPH - or a known standing spell - is "Stopped", with
 * how long when that is known. Nothing at all once the GPS is old: a speed
 * from an hour ago is not the truck's speed.
 */
export function speedView(
  trip: Pick<LiveTrip, "status" | "last_speed_kmh" | "last_point_at">,
  standingMinutes: number | null,
  now: number = Date.now(),
): View | null {
  if (tripState(trip as LiveTrip) !== "active" || trip.status === "arrived") return null;
  if (!trip.last_point_at || now - new Date(trip.last_point_at).getTime() > NO_SIGNAL_MS) return { text: "-", sub: "Speed", tone: "neutral" };
  if (standingMinutes != null && standingMinutes >= 10) {
    return { text: "Stopped", sub: durationShort(standingMinutes), tone: standingMinutes >= 30 ? "warn" : "neutral" };
  }
  const v = trip.last_speed_kmh;
  if (v == null) return { text: "-", sub: "Speed", tone: "neutral" };
  if (v < STOPPED_KMPH) return { text: "Stopped", sub: "now", tone: "neutral" };
  return { text: `${Math.round(v)}`, sub: "km/h", tone: v > 80 ? "warn" : "brand" };
}

/** Share of the road already covered, 0-100, from the start point and the km left. Null when unknown. */
export function progressPct(
  origin: { lat: number; lng: number } | null,
  dest: { lat: number; lng: number } | null,
  trip: Pick<LiveTrip, "status" | "distance_left_km">,
): number | null {
  if (trip.status === "arrived" || trip.status === "delivered") return 100;
  if (tripState(trip as LiveTrip) !== "active") return 0;
  if (!origin || !dest || trip.distance_left_km == null) return null;
  const total = roadKm(origin, dest);
  if (total < 1) return null;
  return Math.max(2, Math.min(98, Math.round((1 - trip.distance_left_km / total) * 100)));
}
