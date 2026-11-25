import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { eventColumns, liveSchema83, logLive, UUID_RE } from "@/lib/live/server";
import { eventPhase, istDayKey, istDayStartOf, type LiveTrip, type TripEvent, type TripState } from "@/lib/live/shared";

/**
 * v4 (0083) activity, derived from ONE store: live_trip_events (+ positions).
 * Nothing here writes; masters never hold history.
 *
 *   trips       one section per trip, phases inside
 *   drivers     per driver, per IST day (a multi-day trip splits by day)
 *   warehouses  per place, per IST day (trips from / to it)
 *   trucks      per truck, per trip
 */

const db = () => getSupabaseAdmin();
const EVENTS_PER_PAGE = 250;

export type PhaseGroup = { phase: TripState; events: TripEvent[] };
export type TripSection = { trip: LiveTrip; phases: PhaseGroup[]; count: number };
export type DaySection = { day: string; events: TripEvent[]; points: number | null };
export type TripRef = Pick<LiveTrip, "id" | "trip_seq" | "trip_name" | "status">;

const ORDER: TripState[] = ["planned", "active", "done", "cancelled"];

/** Events (newest first) split by the trip phase they happened in; empty phases dropped. */
export function groupByPhase(events: TripEvent[], trip: LiveTrip | null): PhaseGroup[] {
  const map = new Map<TripState, TripEvent[]>();
  for (const e of events) {
    const p = eventPhase(e, trip);
    if (!map.has(p)) map.set(p, []);
    map.get(p)!.push(e);
  }
  return ORDER.filter((p) => map.has(p)).map((phase) => ({ phase, events: map.get(phase)! }));
}

function byDay(events: TripEvent[]): Map<string, TripEvent[]> {
  const m = new Map<string, TripEvent[]>();
  for (const e of events) {
    const k = istDayKey(e.created_at);
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(e);
  }
  return m;
}

/** Page of day sections from a newest-first event list; a cut-off oldest day waits for "View more". */
function daysPage(events: TripEvent[]): { days: [string, TripEvent[]][]; next: string | null } {
  const days = [...byDay(events).entries()];
  if (events.length < EVENTS_PER_PAGE) return { days, next: null };
  if (days.length > 1) days.pop();
  return { days, next: istDayStartOf(days[days.length - 1][0]) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function eventsWhere(apply: (q: any) => any, before: string | null): Promise<TripEvent[]> {
  let q = apply(db().from("live_trip_events").select(await eventColumns()));
  if (before) q = q.lt("created_at", before);
  const { data, error } = await q.order("created_at", { ascending: false }).limit(EVENTS_PER_PAGE);
  if (error) {
    logLive("activity", error);
    return [];
  }
  return (data ?? []) as unknown as TripEvent[];
}

export async function tripRefs(ownerId: string, ids: string[]): Promise<Map<string, TripRef>> {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return new Map();
  const { data } = await db().from("live_trips").select("id,trip_seq,trip_name,status").eq("owner_id", ownerId).in("id", uniq.slice(0, 300));
  return new Map(((data ?? []) as TripRef[]).map((t) => [t.id, t]));
}

/* ---- trips: one section per trip ---------------------------------------- */

export async function tripsActivity(ownerId: string, page: number, size = 8): Promise<{ sections: TripSection[]; more: boolean }> {
  let q = db().from("live_trips").select("*").eq("owner_id", ownerId);
  if (await liveSchema83()) q = q.is("archived_at", null);
  const { data, error } = await q.order("created_at", { ascending: false }).range(page * size, page * size + size);
  if (error) {
    logLive("trips activity", error);
    return { sections: [], more: false };
  }
  const all = (data ?? []) as LiveTrip[];
  const trips = all.slice(0, size);
  return { sections: await sectionsFor(trips), more: all.length > size };
}

async function sectionsFor(trips: LiveTrip[]): Promise<TripSection[]> {
  if (!trips.length) return [];
  const { data, error } = await db()
    .from("live_trip_events")
    .select(await eventColumns())
    .in("trip_id", trips.map((t) => t.id))
    .order("created_at", { ascending: false })
    .limit(1500);
  if (error) logLive("trip sections", error);
  const events = (data ?? []) as unknown as TripEvent[];
  return trips.map((trip) => {
    const mine = events.filter((e) => e.trip_id === trip.id);
    return { trip, phases: groupByPhase(mine, trip), count: mine.length };
  });
}

/* ---- drivers: per day ------------------------------------------------------ */

export async function driverDays(
  ownerId: string,
  driverId: string,
  before: string | null,
): Promise<{ days: DaySection[]; next: string | null; trips: Map<string, TripRef> }> {
  if (!UUID_RE.test(driverId)) return { days: [], next: null, trips: new Map() };
  const events = await eventsWhere((q) => q.eq("owner_id", ownerId).eq("driver_id", driverId), before);
  const { days, next } = daysPage(events);
  // Positions received that day (cheap head counts on the driver/time index).
  const counts = await Promise.all(
    days.map(async ([day]) => {
      const start = istDayStartOf(day);
      const end = new Date(Date.parse(start) + 86_400_000).toISOString();
      const { count } = await db()
        .from("live_locations")
        .select("id", { count: "exact", head: true })
        .eq("driver_id", driverId)
        .gte("recorded_at", start)
        .lt("recorded_at", end);
      return count ?? null;
    }),
  );
  const trips = await tripRefs(ownerId, events.map((e) => e.trip_id ?? ""));
  return { days: days.map(([day, ev], i) => ({ day, events: ev, points: counts[i] })), next, trips };
}

/* ---- warehouses: per day ----------------------------------------------------- */

export async function placeDays(
  ownerId: string,
  placeId: string,
  before: string | null,
): Promise<{ days: DaySection[]; next: string | null; trips: Map<string, TripRef> }> {
  if (!UUID_RE.test(placeId)) return { days: [], next: null, trips: new Map() };
  const { data } = await db()
    .from("live_trips")
    .select("id")
    .eq("owner_id", ownerId)
    .or(`from_place_id.eq.${placeId},to_place_id.eq.${placeId}`)
    .order("created_at", { ascending: false })
    .limit(300);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (!ids.length) return { days: [], next: null, trips: new Map() };
  const events = await eventsWhere((q) => q.in("trip_id", ids), before);
  const { days, next } = daysPage(events);
  const trips = await tripRefs(ownerId, events.map((e) => e.trip_id ?? ""));
  return { days: days.map(([day, ev]) => ({ day, events: ev, points: null })), next, trips };
}

/* ---- trucks: per trip ----------------------------------------------------- */

export async function truckTrips(ownerId: string, vehicleId: string, page: number, size = 6): Promise<{ sections: TripSection[]; more: boolean }> {
  if (!UUID_RE.test(vehicleId)) return { sections: [], more: false };
  const { data, error } = await db()
    .from("live_trips")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("vehicle_id", vehicleId)
    .order("created_at", { ascending: false })
    .range(page * size, page * size + size);
  if (error) {
    logLive("truck trips", error);
    return { sections: [], more: false };
  }
  const all = (data ?? []) as LiveTrip[];
  return { sections: await sectionsFor(all.slice(0, size)), more: all.length > size };
}
