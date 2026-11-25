import "server-only";

import { randomBytes } from "node:crypto";
import { cache } from "react";

import { env } from "@/lib/env";
import { indianMobileDigits } from "@/lib/phone";
import { requirePortalSession, type PortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  OPEN_STATUSES,
  prettyVehicle,
  tripNo,
  type LiveDriver,
  type LivePlace,
  type LiveTrip,
  type LiveVehicle,
  type Point,
  type TripEvent,
} from "@/lib/live/shared";

/**
 * Live tracking module (0079) - server-side reads and the session gate.
 *
 * WORKSPACE. ownerId is the account whose data this is. Today it is always the
 * signed-in user; when team members arrive, liveWorkspaceFor() is the one place
 * that maps a member to their owner's workspace (and their role).
 */

export type LiveRole = "owner" | "manager" | "dispatcher";

export type LiveSession = {
  session: PortalSession;
  ownerId: string;
  role: LiveRole;
  /** profiles.modules exists (0079 applied). */
  available: boolean;
  /** 'live' is switched on for this account. */
  enabled: boolean;
  modules: string[];
};

export const TRIP_COLUMNS = "*";

export function isMissingRelation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  const message = "message" in error ? String((error as { message: unknown }).message) : "";
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST205" ||
    code === "PGRST204" ||
    (/live_|modules/.test(message) && /does not exist|schema cache|could not find/i.test(message))
  );
}

let warned = false;
export function logLive(what: string, error: unknown) {
  if (isMissingRelation(error)) {
    if (!warned) {
      warned = true;
      console.warn(`live module ${what} skipped - apply migration 0079`);
    }
    return;
  }
  const message =
    error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error);
  console.error(`live module ${what} failed:`, message);
}

/** Team members later: map userId -> owner workspace + role. Today: self, owner. */
function liveWorkspaceFor(userId: string): { ownerId: string; role: LiveRole } {
  return { ownerId: userId, role: "owner" };
}

export const requireLiveSession = cache(async (): Promise<LiveSession> => {
  const session = await requirePortalSession();
  const raw = (session.profile as unknown as { modules?: unknown }).modules;
  const available = Array.isArray(raw);
  const modules = available ? (raw as string[]) : ["toll"];
  const { ownerId, role } = liveWorkspaceFor(session.id);
  return { session, ownerId, role, available, enabled: modules.includes("live"), modules };
});

export function newToken(): string {
  return randomBytes(16).toString("base64url");
}

export function plausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

export function driverLink(token: string): string {
  return `${env.siteUrl}/d/${token}`;
}

export function trackLink(token: string): string {
  return `${env.siteUrl}/track/${token}`;
}

/** wa.me link opened on the OWNER's phone, so it costs nothing. */
export function waHref(phone: string | null | undefined, text: string): string {
  const d = indianMobileDigits(phone);
  return d ? `https://wa.me/91${d}?text=${encodeURIComponent(text)}` : `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function driverInviteText(trip: LiveTrip, ownerLabel: string, toText: string): string {
  const link = trip.driver_token ? driverLink(trip.driver_token) : "";
  const name = trip.driver_name?.trim();
  const truck = prettyVehicle(trip.vehicle_no) || "the truck";
  return [
    `${name ? `नमस्ते ${name},` : "नमस्ते,"} ${ownerLabel} - ट्रिप ${tripNo(trip.trip_seq)}, गाड़ी ${truck}, ${toText} तक। लिंक खोलें, "Start sharing" दबाएँ और पहुँचने पर "Reached / Delivered" दबाएँ।`,
    "",
    `${name ? `Hello ${name},` : "Hello,"} ${ownerLabel} - trip ${tripNo(trip.trip_seq)}, truck ${truck} to ${toText}. Open the link, tap "Start sharing", and tap Reached / Delivered at the end.`,
    "",
    link,
  ].join("\n");
}

export function customerShareText(trip: LiveTrip, ownerLabel: string): string {
  const link = trip.track_token ? trackLink(trip.track_token) : "";
  return [
    `${ownerLabel}: your consignment${trip.invoice_no ? ` (invoice ${trip.invoice_no})` : ""} is on truck ${prettyVehicle(trip.vehicle_no) || ""}.`,
    `Track it live: ${link}`,
  ].join("\n");
}

/* -------------------------------------------------------------------------- */
/* reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function loadPlaces(ownerId: string, opts: { includeArchived?: boolean } = {}): Promise<LivePlace[]> {
  let q = getSupabaseAdmin().from("live_places").select("*").eq("owner_id", ownerId).order("name");
  if (!opts.includeArchived) q = q.is("archived_at", null);
  const { data, error } = await q.limit(500);
  if (error) {
    logLive("places", error);
    return [];
  }
  return (data ?? []) as LivePlace[];
}

export async function loadVehicles(ownerId: string): Promise<LiveVehicle[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("live_vehicles")
    .select("*")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("number")
    .limit(500);
  if (error) {
    logLive("vehicles", error);
    return [];
  }
  return (data ?? []) as LiveVehicle[];
}

export async function loadDrivers(ownerId: string): Promise<LiveDriver[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("live_drivers")
    .select("*")
    .eq("owner_id", ownerId)
    .is("archived_at", null)
    .order("name")
    .limit(500);
  if (error) {
    logLive("drivers", error);
    return [];
  }
  return (data ?? []) as LiveDriver[];
}

export async function loadTrip(ownerId: string, id: string): Promise<LiveTrip | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("live_trips")
    .select(TRIP_COLUMNS)
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle<LiveTrip>();
  if (error) logLive("trip", error);
  return data ?? null;
}

export async function loadOpenTrips(ownerId: string): Promise<LiveTrip[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("live_trips")
    .select(TRIP_COLUMNS)
    .eq("owner_id", ownerId)
    .in("status", OPEN_STATUSES)
    .order("created_at", { ascending: false })
    .limit(300);
  if (error) {
    logLive("open trips", error);
    return [];
  }
  return (data ?? []) as LiveTrip[];
}

export type TripFilter = {
  status?: string | null;
  q?: string | null;
  from?: string | null; // ISO day start
  to?: string | null;
  place?: string | null;
  page?: number;
};

export const TRIPS_PAGE = 30;

export async function searchTrips(ownerId: string, f: TripFilter): Promise<{ rows: LiveTrip[]; more: boolean }> {
  let q = getSupabaseAdmin().from("live_trips").select(TRIP_COLUMNS).eq("owner_id", ownerId);
  if (f.status === "open") q = q.in("status", OPEN_STATUSES);
  else if (f.status && f.status !== "all") q = q.eq("status", f.status);
  if (f.from) q = q.gte("created_at", f.from);
  if (f.to) q = q.lt("created_at", f.to);
  if (f.place && /^[0-9a-f-]{36}$/i.test(f.place)) q = q.or(`from_place_id.eq.${f.place},to_place_id.eq.${f.place}`);
  const term = (f.q ?? "").trim();
  if (term) {
    const safe = term.replace(/[^A-Za-z0-9 ./-]/g, "").slice(0, 40);
    const veh = safe.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const digits = safe.replace(/\D/g, "");
    const ors = [
      `invoice_no.ilike.%${safe}%`,
      `lr_no.ilike.%${safe}%`,
      `consignee_name.ilike.%${safe}%`,
      `to_name.ilike.%${safe}%`,
      `to_city.ilike.%${safe}%`,
      `driver_name.ilike.%${safe}%`,
      `material.ilike.%${safe}%`,
    ];
    if (veh.length >= 3) ors.push(`vehicle_no.ilike.%${veh}%`);
    if (digits.length >= 4) ors.push(`eway_bill_no.ilike.%${digits}%`);
    const seq = /^t-?0*(\d+)$/i.exec(safe.replace(/\s/g, ""));
    if (seq) ors.push(`trip_seq.eq.${Number(seq[1])}`);
    if (safe) q = q.or(ors.join(","));
  }
  const page = Math.max(0, f.page ?? 0);
  const { data, error } = await q
    .order("created_at", { ascending: false })
    .range(page * TRIPS_PAGE, page * TRIPS_PAGE + TRIPS_PAGE);
  if (error) {
    logLive("trip search", error);
    return { rows: [], more: false };
  }
  const rows = (data ?? []) as LiveTrip[];
  return { rows: rows.slice(0, TRIPS_PAGE), more: rows.length > TRIPS_PAGE };
}

export async function loadTripEvents(tripId: string, limit = 80): Promise<TripEvent[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("live_trip_events")
    .select("id,trip_id,kind,title,detail,actor,lat,lng,created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    logLive("events", error);
    return [];
  }
  return (data ?? []) as TripEvent[];
}

export async function loadRecentEvents(ownerId: string, sinceIso: string, limit = 30) {
  const { data, error } = await getSupabaseAdmin()
    .from("live_trip_events")
    .select("id,trip_id,kind,title,detail,actor,lat,lng,created_at")
    .eq("owner_id", ownerId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) {
    logLive("recent events", error);
    return [] as TripEvent[];
  }
  return (data ?? []) as TripEvent[];
}

const num = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};

export function toPoint(row: Record<string, unknown>): Point {
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy_m: num(row.accuracy_m),
    speed_kmh: num(row.speed_kmh),
    heading: num(row.heading),
    recorded_at: String(row.recorded_at),
  };
}

export async function loadTrail(tripId: string, sinceMs = 3 * 60 * 60 * 1000, max = 400): Promise<Point[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("live_locations")
    .select("lat,lng,accuracy_m,speed_kmh,heading,recorded_at")
    .eq("trip_id", tripId)
    .gte("recorded_at", new Date(Date.now() - sinceMs).toISOString())
    .order("recorded_at", { ascending: false })
    .limit(max);
  if (error) {
    logLive("trail", error);
    return [];
  }
  return ((data ?? []) as Record<string, unknown>[]).map(toPoint);
}

/** What the owner is called on the driver/customer pages. */
export function ownerLabelOf(session: PortalSession): string {
  const p = session.profile;
  return (p.office || p.full_name || "Your dispatcher").trim().slice(0, 80);
}

export function placeMap(places: LivePlace[]): Map<string, LivePlace> {
  return new Map(places.map((p) => [p.id, p]));
}

/** Destination point for ETA: saved place first, then the trip's own lat/lng. */
export function destinationPoint(trip: LiveTrip, to: LivePlace | null | undefined): { lat: number; lng: number } | null {
  if (to && to.lat != null && to.lng != null) return { lat: to.lat, lng: to.lng };
  if (trip.to_lat != null && trip.to_lng != null) return { lat: trip.to_lat, lng: trip.to_lng };
  return null;
}
