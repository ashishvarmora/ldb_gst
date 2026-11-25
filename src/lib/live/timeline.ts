import { FALLBACK_KMPH, haversineKm, tripState, type LiveTrip, type RoutePlan } from "@/lib/live/shared";

/**
 * v6 "Where is my truck" (docs/LIVE-PLAN-v6.md §5). Pure: no DB, no AI.
 *
 *   scheduled(stop) = base + journeyHours x (stop.km / total_km)
 *       base = actual start (started_at) when the trip started, else planned start.
 *   passed(stop)    = first position within PASS_KM of the stop (actual), else the moment the
 *       truck's progress along the route first went past the stop's km (projected, interpolated).
 *   expected(stop)  = remaining stops only, from now:
 *       with a live ETA: now + (stop.km - progress) / (total - progress) x (eta - now)  -> ends exactly on the trip ETA
 *       else           : now + (stop.km - progress) / speed, speed = recent average (last 2 h) or the schedule pace.
 *   delay = (actual or expected) - scheduled; within ON_TIME_MIN = on time.
 */

export const PASS_KM = 5;
export const ON_TIME_MIN = 5;

export type TrackPoint = { lat: number; lng: number; t: number; speed: number | null };
export type StopKind = "origin" | "stop" | "dest";
export type TimeKind = "actual" | "projected" | "expected";

export type StopRow = {
  key: string;
  name: string;
  km: number;
  kind: StopKind;
  scheduled: number | null;
  time: number | null;
  timeKind: TimeKind | null;
  delayMin: number | null;
  passed: boolean;
};

export type Timeline = {
  rows: StopRow[];
  /** Truck sits after rows[after] (the last passed row) and before rows[after + 1]. Null = not moving on the route now. */
  truck: { after: number; kmToNext: number; progressKm: number } | null;
  base: number | null;
  baseKind: "actual" | "planned" | null;
  journeyH: number;
  journeyKind: "entered" | "planned" | "estimated";
  totalKm: number;
  speedBasis: "eta" | "recent" | "schedule" | null;
  speedKmph: number | null;
  source: RoutePlan["source"];
};

type LL = { lat: number; lng: number };

/** Journey hours: entered (0085) > planned arrival - planned start > distance at 40 km/h. */
export function journeyHoursOf(trip: Pick<LiveTrip, "journey_hours" | "planned_dispatch_at" | "promised_delivery_at">, totalKm: number): { h: number; kind: Timeline["journeyKind"] } {
  const entered = trip.journey_hours != null ? Number(trip.journey_hours) : NaN;
  if (Number.isFinite(entered) && entered > 0) return { h: entered, kind: "entered" };
  if (trip.planned_dispatch_at && trip.promised_delivery_at) {
    const h = (Date.parse(trip.promised_delivery_at) - Date.parse(trip.planned_dispatch_at)) / 3_600_000;
    if (Number.isFinite(h) && h > 0) return { h, kind: "planned" };
  }
  return { h: Math.max(0.5, totalKm / FALLBACK_KMPH), kind: "estimated" };
}

/** Progress (road km from the origin) of a point: nearest segment of the stop polyline, interpolated. */
function progressOn(verts: (LL & { km: number })[], p: LL): { km: number; offKm: number } {
  let best = { km: 0, offKm: Infinity };
  for (let i = 0; i < verts.length - 1; i++) {
    const a = verts[i];
    const b = verts[i + 1];
    const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
    const bx = (b.lng - a.lng) * k * 111;
    const by = (b.lat - a.lat) * 111;
    const px = (p.lng - a.lng) * k * 111;
    const py = (p.lat - a.lat) * 111;
    const len2 = bx * bx + by * by;
    const t = len2 ? Math.min(1, Math.max(0, (px * bx + py * by) / len2)) : 0;
    const off = Math.hypot(px - t * bx, py - t * by);
    if (off < best.offKm) best = { km: a.km + t * (b.km - a.km), offKm: off };
  }
  return best;
}

/** Path speed over the last 2 h of the track, clamped like the trip ETA (25-55 km/h). Null when too thin. */
function recentKmph(track: TrackPoint[], now: number): number | null {
  const recent = track.filter((p) => now - p.t <= 2 * 3_600_000);
  if (recent.length < 4) return null;
  let km = 0;
  for (let i = 1; i < recent.length; i++) km += haversineKm(recent[i - 1], recent[i]);
  const h = (recent[recent.length - 1].t - recent[0].t) / 3_600_000;
  if (h < 0.25) return null;
  return Math.min(55, Math.max(25, (km * 1.1) / h));
}

export function buildTimeline(trip: LiveTrip, plan: RoutePlan, track: TrackPoint[], now = Date.now()): Timeline {
  const state = tripState(trip);
  const totalKm = Math.max(1, plan.total_km);
  const jh = journeyHoursOf(trip, totalKm);
  const startedAt = trip.started_at ? Date.parse(trip.started_at) : null;
  const plannedAt = trip.planned_dispatch_at ? Date.parse(trip.planned_dispatch_at) : null;
  const base = startedAt ?? plannedAt;
  const baseKind = startedAt ? "actual" : plannedAt ? "planned" : null;
  const sched = (km: number) => (base != null ? base + jh.h * 3_600_000 * (km / totalKm) : null);

  const verts = [
    { ...plan.from, km: 0 },
    ...plan.stops.map((s) => ({ lat: s.lat, lng: s.lng, km: Math.min(s.km, totalKm - 1) })),
    { ...plan.to, km: totalKm },
  ];

  // Track incl. the trip's last position when newer.
  const pts = [...track];
  if (trip.last_lat != null && trip.last_lng != null && trip.last_point_at) {
    const t = Date.parse(trip.last_point_at);
    if (!pts.length || t > pts[pts.length - 1].t) pts.push({ lat: trip.last_lat, lng: trip.last_lng, t, speed: trip.last_speed_kmh });
  }
  // Monotonic progress per point (ignore far-off fixes).
  const prog: number[] = [];
  let run = 0;
  for (const p of pts) {
    const r = progressOn(verts, p);
    if (r.offKm <= 40) run = Math.max(run, r.km);
    prog.push(run);
  }
  const progressKm = state === "done" || trip.status === "arrived" ? totalKm : prog.length ? prog[prog.length - 1] : 0;

  /** When the truck passed `km`: actual (within PASS_KM of the point) or projected (progress crossed km). */
  const passTime = (v: LL, km: number): { t: number; kind: TimeKind } | null => {
    for (const p of pts) if (haversineKm(p, v) <= PASS_KM) return { t: p.t, kind: "actual" };
    for (let i = 0; i < pts.length; i++) {
      if (prog[i] >= km) {
        if (i === 0) return { t: pts[0].t, kind: "projected" };
        const span = prog[i] - prog[i - 1];
        const f = span > 0 ? (km - prog[i - 1]) / span : 1;
        return { t: Math.round(pts[i - 1].t + f * (pts[i].t - pts[i - 1].t)), kind: "projected" };
      }
    }
    return null;
  };

  // Expected times for what is still ahead (Active, not yet arrived).
  const moving = state === "active" && trip.status !== "arrived";
  const eta = trip.eta_at ? Date.parse(trip.eta_at) : null;
  let speedBasis: Timeline["speedBasis"] = null;
  let speedKmph: number | null = null;
  let expected: (km: number) => number | null = () => null;
  if (moving) {
    const left = totalKm - progressKm;
    if (eta && eta > now && left > 0) {
      speedBasis = "eta";
      speedKmph = Math.round(left / ((eta - now) / 3_600_000));
      expected = (km) => now + ((km - progressKm) / left) * (eta - now);
    } else {
      const r = recentKmph(pts, now);
      speedBasis = r ? "recent" : "schedule";
      speedKmph = Math.round(r ?? totalKm / jh.h);
      const v = Math.max(5, speedKmph);
      expected = (km) => now + ((km - progressKm) / v) * 3_600_000;
    }
  }

  const rows: StopRow[] = [];
  const push = (key: string, name: string, km: number, kind: StopKind, v: LL) => {
    const scheduled = sched(km);
    let time: number | null = null;
    let timeKind: TimeKind | null = null;
    let passed = false;
    if (kind === "origin") {
      if (startedAt) {
        time = startedAt;
        timeKind = "actual";
        passed = true;
      }
    } else if (kind === "dest" && (trip.arrived_at || trip.delivered_at)) {
      time = Date.parse((trip.arrived_at ?? trip.delivered_at)!);
      timeKind = "actual";
      passed = true;
    } else if (state !== "planned" && state !== "cancelled") {
      const pt = progressKm >= km - 0.5 || state === "done" ? passTime(v, km) : null;
      if (pt) {
        time = pt.t;
        timeKind = pt.kind;
        passed = true;
      } else if (progressKm >= km - 0.5) {
        passed = true; // passed, but no position to time it
      } else if (moving) {
        time = expected(km);
        timeKind = time != null ? "expected" : null;
      }
    }
    const delayMin = scheduled != null && time != null ? Math.round((time - scheduled) / 60000) : null;
    rows.push({ key, name, km: Math.round(km), kind, scheduled, time, timeKind, delayMin, passed });
  };
  push("o", plan.from.name, 0, "origin", plan.from);
  plan.stops.forEach((s, i) => push(`s${i}`, s.name, Math.min(s.km, totalKm - 1), "stop", s));
  push("d", plan.to.name, totalKm, "dest", plan.to);

  let truck: Timeline["truck"] = null;
  if (moving) {
    let after = 0;
    rows.forEach((r, i) => {
      if (r.passed || r.km <= progressKm) after = i;
    });
    after = Math.min(after, rows.length - 2);
    truck = { after, kmToNext: Math.max(0, Math.round(rows[after + 1].km - progressKm)), progressKm: Math.round(progressKm) };
  }

  return { rows, truck, base, baseKind, journeyH: jh.h, journeyKind: jh.kind, totalKm: Math.round(totalKm), speedBasis, speedKmph, source: plan.source };
}

/** "Delay 13 min" / "Before 12 min" / "On time" for a row. */
export function delayBadge(min: number | null): { text: string; tone: "bad" | "good" | "ok" } | null {
  if (min == null) return null;
  if (Math.abs(min) <= ON_TIME_MIN) return { text: "On time", tone: "ok" };
  const a = Math.abs(min);
  const t = a < 60 ? `${a} min` : `${Math.floor(a / 60)} h${a % 60 ? ` ${a % 60} min` : ""}`;
  return min > 0 ? { text: `Delay ${t}`, tone: "bad" } : { text: `Before ${t}`, tone: "good" };
}
