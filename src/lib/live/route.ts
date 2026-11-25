import "server-only";

import { routePlanAI, routeWaypoints, routeWaypointsBasic } from "@/lib/live-ai";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { liveSchema83, liveSchema85, logLive } from "@/lib/live/server";
import { haversineKm, roadKm, type LiveTrip, type RoutePlan, type RouteWaypoint } from "@/lib/live/shared";

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

type End = { name: string; lat: number; lng: number };

/** The cached plan still fits when both ends are within 1 km of what it was built for. */
export function planFits(plan: RoutePlan | null | undefined, from: End, to: End): plan is RoutePlan {
  return Boolean(
    plan && plan.v === 1 && Array.isArray(plan.stops) && plan.from && plan.to && haversineKm(plan.from, from) <= 1 && haversineKm(plan.to, to) <= 1,
  );
}

/**
 * v6 "Where is my truck": the trip's main stops From -> To, built ONCE per From/To pair
 * (AI, validated; rule-based highway hubs as fallback) and cached in live_trips.route_plan (0085).
 * A From/To change makes planFits() fail, so the next view rebuilds it. readOnly (customer page)
 * builds it too when missing; once cached, AI is not called again for the same pair.
 */
export async function ensureRoutePlan(trip: LiveTrip, from: End, to: End): Promise<RoutePlan> {
  if (planFits(trip.route_plan, from, to)) return trip.route_plan;
  // Before 0085 nothing can be cached, so stay on the free rule-based hubs (no AI call per page view).
  const canCache = await liveSchema85();
  const ai = canCache ? await routePlanAI(from, to).catch(() => null) : null;
  const plan: RoutePlan = ai
    ? { v: 1, from, to, total_km: ai.totalKm, stops: ai.stops, source: "ai", at: new Date().toISOString() }
    : { v: 1, from, to, total_km: Math.round(roadKm(from, to)), stops: routeWaypointsBasic(from, to), source: "rules", at: new Date().toISOString() };
  if (canCache) {
    const { error } = await getSupabaseAdmin().from("live_trips").update({ route_plan: plan }).eq("id", trip.id);
    if (error) logLive("route plan cache", error);
  }
  return plan;
}
