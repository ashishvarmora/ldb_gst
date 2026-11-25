import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { liveSchema83, loadPlaces, loadVehicles, logLive } from "@/lib/live/server";
import { istDayKey, prettyVehicle, tripState, type LiveTrip } from "@/lib/live/shared";

/**
 * v6 Logbook (docs/LIVE-PLAN-v6.md §3): usage per truck / driver / warehouse, worked out from the
 * trips created in the chosen time range. Read-only; masters never hold history.
 *
 *   hours = end - actual start, end = delivered / arrived / cancelled, or now while Active
 *   days  = distinct IST calendar days touched between start and end
 */

export const LOGBOOK_TABS = ["trips", "trucks", "drivers", "warehouses"] as const;
export type LogbookTab = (typeof LOGBOOK_TABS)[number];

export type Usage = { id: string; name: string; sub: string | null; trips: number; active: number; days: number; hours: number; last: LiveTrip | null; out?: number; in?: number };

const MAX_TRIPS = 1500;

/** Trips created since `fromIso` (null = all time), newest first, capped. */
export async function tripsSince(ownerId: string, fromIso: string | null): Promise<LiveTrip[]> {
  let q = getSupabaseAdmin().from("live_trips").select("*").eq("owner_id", ownerId);
  if (fromIso) q = q.gte("created_at", fromIso);
  if (await liveSchema83()) q = q.is("archived_at", null);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(MAX_TRIPS);
  if (error) {
    logLive("logbook trips", error);
    return [];
  }
  return (data ?? []) as LiveTrip[];
}

/** Start / end of a trip's time on the road (ms), or null before it started. */
export function tripSpan(t: LiveTrip, now = Date.now()): { start: number; end: number } | null {
  if (!t.started_at) return null;
  const start = Date.parse(t.started_at);
  const endIso = t.delivered_at ?? t.arrived_at ?? t.cancelled_at;
  const end = endIso ? Date.parse(endIso) : tripState(t) === "active" ? now : start;
  return end >= start ? { start, end } : null;
}

function addUsage(u: Usage, t: LiveTrip, days: Set<string>, now: number) {
  u.trips += 1;
  if (tripState(t) === "active") u.active += 1;
  if (!u.last) u.last = t;
  const span = tripSpan(t, now);
  if (span) {
    u.hours += (span.end - span.start) / 3_600_000;
    for (let d = span.start; d <= span.end + 1; d += 86_400_000) days.add(istDayKey(new Date(Math.min(d, span.end)).toISOString()));
    days.add(istDayKey(new Date(span.end).toISOString()));
  }
}

function finish(map: Map<string, { u: Usage; days: Set<string> }>, q: string): Usage[] {
  const term = q.trim().toLowerCase().replace(/\s+/g, "");
  return [...map.values()]
    .map(({ u, days }) => ({ ...u, days: days.size, hours: Math.round(u.hours) }))
    .filter((u) => !term || `${u.name}${u.sub ?? ""}`.toLowerCase().replace(/\s+/g, "").includes(term))
    .sort((a, b) => b.active - a.active || b.trips - a.trips || a.name.localeCompare(b.name));
}

export async function truckUsage(ownerId: string, trips: LiveTrip[], q: string, now = Date.now()): Promise<Usage[]> {
  const vehicles = await loadVehicles(ownerId);
  const map = new Map<string, { u: Usage; days: Set<string> }>();
  for (const v of vehicles) map.set(v.id, { u: { id: v.id, name: prettyVehicle(v.number), sub: v.vehicle_type ?? null, trips: 0, active: 0, days: 0, hours: 0, last: null }, days: new Set() });
  for (const t of trips) {
    if (!t.vehicle_id) continue;
    if (!map.has(t.vehicle_id)) map.set(t.vehicle_id, { u: { id: t.vehicle_id, name: prettyVehicle(t.vehicle_no), sub: "archived", trips: 0, active: 0, days: 0, hours: 0, last: null }, days: new Set() });
    const e = map.get(t.vehicle_id)!;
    addUsage(e.u, t, e.days, now);
  }
  return finish(map, q);
}

export async function driverUsage(ownerId: string, trips: LiveTrip[], q: string, now = Date.now()): Promise<Usage[]> {
  const { data, error } = await getSupabaseAdmin().from("live_drivers").select("id,name,phone,archived_at").eq("owner_id", ownerId).eq("kind", "own").order("name").limit(500);
  if (error) logLive("logbook drivers", error);
  const map = new Map<string, { u: Usage; days: Set<string> }>();
  for (const d of (data ?? []) as { id: string; name: string; archived_at: string | null }[]) {
    if (d.archived_at) continue;
    map.set(d.id, { u: { id: d.id, name: d.name, sub: null, trips: 0, active: 0, days: 0, hours: 0, last: null }, days: new Set() });
  }
  const archived = new Map(((data ?? []) as { id: string; name: string; archived_at: string | null }[]).filter((d) => d.archived_at).map((d) => [d.id, d.name]));
  for (const t of trips) {
    if (!t.driver_id || t.inline_driver) continue;
    if (!map.has(t.driver_id)) {
      if (!archived.has(t.driver_id)) continue; // temporary drivers are not in the logbook's driver list
      map.set(t.driver_id, { u: { id: t.driver_id, name: archived.get(t.driver_id)!, sub: "archived", trips: 0, active: 0, days: 0, hours: 0, last: null }, days: new Set() });
    }
    const e = map.get(t.driver_id)!;
    addUsage(e.u, t, e.days, now);
  }
  return finish(map, q);
}

export async function warehouseUsage(ownerId: string, trips: LiveTrip[], q: string, now = Date.now()): Promise<Usage[]> {
  const places = await loadPlaces(ownerId, { includeArchived: true });
  const map = new Map<string, { u: Usage; days: Set<string> }>();
  for (const p of places) {
    if (p.archived_at) continue;
    map.set(p.id, { u: { id: p.id, name: p.name, sub: p.city ?? null, trips: 0, active: 0, days: 0, hours: 0, last: null, out: 0, in: 0 }, days: new Set() });
  }
  for (const t of trips) {
    for (const [pid, dir] of [
      [t.from_place_id, "out"],
      [t.to_place_id, "in"],
    ] as const) {
      if (!pid) continue;
      const e = map.get(pid);
      if (!e) continue;
      addUsage(e.u, t, e.days, now);
      e.u[dir] = (e.u[dir] ?? 0) + 1;
    }
  }
  return finish(map, q);
}
