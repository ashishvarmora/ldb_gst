import "server-only";

import { routeWaypoints, routeWaypointsBasic } from "@/lib/live-ai";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { liveSchema83, logLive } from "@/lib/live/server";
import { haversineKm, type LiveTrip, type RouteWaypoint } from "@/lib/live/shared";

/** Re-work the road ahead only after the truck moved this far from the cached point. */
export const ROUTE_REFRESH_KM = 25;

export type RoadAhead = { points: RouteWaypoint[]; source: "ai" | "rules"; at: string; cached: boolean };

/**
 * The approximate road ahead for an Active trip: major cities between the
 * truck and the destination. Cached on the trip (0083); recomputed only when
 * the truck moved > 25 km since, so AI is called a few times per trip at most.
 */
export async function roadAhead(
  trip: LiveTrip,
  current: { lat: number; lng: number },
  dest: { lat: number; lng: number; name?: string | null },
  fromName?: string | null,
): Promise<RoadAhead> {
  const cached = trip.route_at && trip.route_lat != null && trip.route_lng != null && Array.isArray(trip.route_waypoints);
  if (cached && haversineKm(current, { lat: trip.route_lat!, lng: trip.route_lng! }) <= ROUTE_REFRESH_KM) {
    // Drop cities already passed (closer to us than when cached).
    const left = (trip.route_waypoints ?? [])
      .map((p) => ({ ...p, km: Math.round(haversineKm(current, p) * 1.25) }))
      .filter((p) => haversineKm(p, dest) < haversineKm(current, dest) - 5);
    return { points: left, source: trip.route_source ?? "rules", at: trip.route_at!, cached: true };
  }
  let source: "ai" | "rules" = "ai";
  let points = await routeWaypoints({ name: fromName ?? null, ...current }, { name: dest.name ?? null, ...dest }, current).catch(() => null);
  if (!points) {
    source = "rules";
    points = routeWaypointsBasic(current, dest);
  }
  const at = new Date().toISOString();
  if (await liveSchema83()) {
    const { error } = await getSupabaseAdmin()
      .from("live_trips")
      .update({ route_waypoints: points, route_at: at, route_lat: current.lat, route_lng: current.lng, route_source: source })
      .eq("id", trip.id);
    if (error) logLive("route cache", error);
  }
  return { points, source, at, cached: false };
}
