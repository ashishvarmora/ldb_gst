import "server-only";

import { inIndia } from "@/lib/live-location-shared";
import {
  MAX_POINTS_PER_POST,
  loadDriverPage as loadLegacyDriverPage,
  recordDriverReport as recordLegacyReport,
  type DriverPostResult,
  type IncomingPoint,
} from "@/lib/live-location";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { changeStatus, recordEvent } from "@/lib/live/automation";
import { isMissingRelation, logLive, plausibleToken } from "@/lib/live/server";
import { prettyVehicle, tripNo, type LiveTrip, type TripStatus } from "@/lib/live/shared";

/**
 * The driver's phone link /d/<token>, for both generations of link:
 *
 *   - a live trip (0079): live_trips.driver_token. Positions go to
 *     live_locations, the driver gets trip info and status buttons.
 *   - an old truck-page link (0078) that was not carried over (e.g. created
 *     before 0079 was applied, or 0079 not applied yet): handled exactly as
 *     before by src/lib/live-location.ts.
 *
 * 0079 copies every open 0078 link into a trip with the same token, so after
 * the migration the first branch serves them.
 */

const MIN_POST_GAP_MS = 8_000;

export type DriverTripInfo = {
  tripNo: string;
  status: TripStatus;
  fromName: string | null;
  toName: string | null;
  toCity: string | null;
  consignee: string | null;
  material: string | null;
  invoiceNo: string | null;
  ewayValidUntil: string | null;
  destLat: number | null;
  destLng: number | null;
};

export type DriverView =
  | {
      kind: "ok";
      truckNumber: string;
      ownerLabel: string;
      driverName: string | null;
      sharing: boolean;
      trip: DriverTripInfo | null;
      closed: boolean;
    }
  | { kind: "revoked" }
  | { kind: "invalid" };

async function tripByToken(token: string): Promise<{ trip: LiveTrip | null; missing: boolean }> {
  const { data, error } = await getSupabaseAdmin()
    .from("live_trips")
    .select("*")
    .eq("driver_token", token)
    .maybeSingle<LiveTrip>();
  if (error) {
    logLive("driver token", error);
    return { trip: null, missing: isMissingRelation(error) };
  }
  return { trip: data ?? null, missing: false };
}

export async function loadDriverView(token: string): Promise<DriverView> {
  if (!plausibleToken(token)) return { kind: "invalid" };
  const { trip } = await tripByToken(token);

  if (!trip) {
    const legacy = await loadLegacyDriverPage(token);
    if (legacy.kind !== "ok") return legacy;
    return {
      kind: "ok",
      truckNumber: legacy.truckNumber,
      ownerLabel: legacy.ownerLabel,
      driverName: legacy.driverName,
      sharing: legacy.status === "active",
      trip: null,
      closed: false,
    };
  }

  if (trip.share_status === "revoked") return { kind: "revoked" };

  const admin = getSupabaseAdmin();
  const ids = [trip.from_place_id, trip.to_place_id].filter(Boolean) as string[];
  const [{ data: places }, { data: owner }] = await Promise.all([
    ids.length
      ? admin.from("live_places").select("id,name,city,lat,lng").in("id", ids)
      : Promise.resolve({ data: [] as { id: string; name: string; city: string | null; lat: number | null; lng: number | null }[] }),
    admin.from("profiles").select("office,full_name").eq("id", trip.owner_id).maybeSingle<{ office: string | null; full_name: string | null }>(),
  ]);
  const byId = new Map((places ?? []).map((p) => [p.id, p]));
  const from = trip.from_place_id ? byId.get(trip.from_place_id) : undefined;
  const to = trip.to_place_id ? byId.get(trip.to_place_id) : undefined;

  return {
    kind: "ok",
    truckNumber: prettyVehicle(trip.vehicle_no) || "Truck",
    ownerLabel: (owner?.office || owner?.full_name || "the dispatcher").trim(),
    driverName: trip.driver_name,
    sharing: trip.share_status === "active",
    closed: trip.status === "delivered" || trip.status === "cancelled",
    trip: {
      tripNo: tripNo(trip.trip_seq),
      status: trip.status,
      fromName: from?.name ?? null,
      toName: to?.name ?? trip.to_name ?? null,
      toCity: to?.city ?? trip.to_city ?? null,
      consignee: trip.consignee_name,
      material: trip.material,
      invoiceNo: trip.invoice_no,
      ewayValidUntil: trip.eway_valid_until,
      destLat: to?.lat ?? trip.to_lat ?? null,
      destLng: to?.lng ?? trip.to_lng ?? null,
    },
  };
}

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};

/**
 * One report from the driver's page. Returns the HTTP result and, for a live
 * trip that accepted points, its id so the route can run the automation after
 * answering.
 */
export async function recordReport(
  token: string,
  report: { points: IncomingPoint[]; consent?: boolean; stop?: boolean },
): Promise<{ result: DriverPostResult; tripId: string | null }> {
  if (!plausibleToken(token)) return { result: { status: 404, body: { ok: false, error: "Link not valid." } }, tripId: null };

  const { trip, missing } = await tripByToken(token);
  if (!trip) {
    // Not a live trip (or 0079 not applied): the 0078 path, unchanged.
    void missing;
    return { result: await recordLegacyReport(token, report), tripId: null };
  }

  const admin = getSupabaseAdmin();
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (trip.share_status === "revoked") {
    return { result: { status: 410, body: { ok: false, error: "This link has been stopped by the dispatcher." } }, tripId: null };
  }
  if (trip.status === "delivered" || trip.status === "cancelled") {
    return {
      result: { status: 410, body: { ok: false, error: trip.status === "delivered" ? "Trip delivered. Thank you!" : "Trip cancelled." } },
      tripId: null,
    };
  }

  if (report.stop) {
    await admin.from("live_trips").update({ share_status: "stopped", share_last_seen_at: nowIso }).eq("id", trip.id).neq("share_status", "revoked");
    await recordEvent(trip, { kind: "share", title: "Driver stopped sharing", actor: "driver" });
    return { result: { status: 200, body: { ok: true, accepted: 0, dropped: 0, sharing: false } }, tripId: null };
  }

  if (!trip.share_consent_at && !report.consent) {
    return { result: { status: 400, body: { ok: false, error: "Tap Start sharing first." } }, tripId: null };
  }

  const cutoff = new Date(now - MIN_POST_GAP_MS).toISOString();
  const patch: Record<string, unknown> = { share_last_seen_at: nowIso, share_status: "active" };
  if (!trip.share_consent_at) patch.share_consent_at = nowIso;
  const { data: claimed, error: claimError } = await admin
    .from("live_trips")
    .update(patch)
    .eq("id", trip.id)
    .neq("share_status", "revoked")
    .or(`share_last_seen_at.is.null,share_last_seen_at.lt.${cutoff},share_status.neq.active`)
    .select("id");
  if (claimError) {
    logLive("report", claimError);
    return { result: { status: 503, body: { ok: false, error: "Service unavailable. Will retry." } }, tripId: null };
  }
  if (!claimed || claimed.length === 0) {
    return {
      result: { status: 429, body: { ok: false, error: "Too fast.", retryAfter: Math.ceil(MIN_POST_GAP_MS / 1000) } },
      tripId: null,
    };
  }
  if (trip.share_status !== "active") {
    await recordEvent(trip, {
      kind: "share",
      title: trip.share_consent_at ? "Driver resumed sharing" : "Driver started sharing location",
      actor: "driver",
    });
    if (!trip.share_consent_at && trip.driver_id) {
      await admin.from("live_drivers").update({ consent_at: nowIso }).eq("id", trip.driver_id).is("consent_at", null);
    }
  }

  const oldest = now - 24 * 60 * 60 * 1000;
  const rows: Record<string, unknown>[] = [];
  let dropped = 0;
  for (const p of report.points.slice(0, MAX_POINTS_PER_POST)) {
    const lat = n(p.lat);
    const lng = n(p.lng);
    const accuracy = n(p.accuracy);
    if (lat === null || lng === null || !inIndia(lat, lng)) {
      dropped++;
      continue;
    }
    if (accuracy !== null && (accuracy < 0 || accuracy > 3000)) {
      dropped++;
      continue;
    }
    let t = n(p.t) ?? now;
    if (t > now) t = now;
    if (t < oldest) {
      dropped++;
      continue;
    }
    const speedMs = n(p.speed);
    const speedKmh = speedMs !== null && speedMs >= 0 ? speedMs * 3.6 : null;
    const heading = n(p.heading);
    rows.push({
      trip_id: trip.id,
      owner_id: trip.owner_id,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      accuracy_m: accuracy !== null ? Math.round(accuracy) : null,
      speed_kmh: speedKmh !== null && speedKmh <= 160 ? Math.round(speedKmh * 10) / 10 : null,
      heading: heading !== null && heading >= 0 && heading < 360 ? Math.round(heading) : null,
      recorded_at: new Date(t).toISOString(),
      received_at: nowIso,
      source: "phone",
    });
  }
  dropped += Math.max(0, report.points.length - MAX_POINTS_PER_POST);

  if (rows.length > 0) {
    const { error } = await admin.from("live_locations").insert(rows);
    if (error) {
      logLive("insert", error);
      return { result: { status: 503, body: { ok: false, error: "Could not save. Will retry." } }, tripId: null };
    }
  }

  if (Math.random() < 0.01) {
    const { error } = await admin.rpc("purge_live_locations", { p_keep_days: 30 });
    if (error) logLive("purge", error);
  }

  return {
    result: { status: 200, body: { ok: true, accepted: rows.length, dropped, sharing: true } },
    tripId: rows.length > 0 ? trip.id : null,
  };
}

export type DriverAction = "started" | "reached" | "delivered";

/** The driver's big buttons. Only moves forward; never reopens a trip. */
export async function driverStatus(
  token: string,
  action: DriverAction,
  at: { lat: number; lng: number } | null,
  note?: string | null,
): Promise<{ ok: true; status: TripStatus } | { ok: false; error: string; status?: number }> {
  if (!plausibleToken(token)) return { ok: false, error: "Link not valid.", status: 404 };
  const { trip } = await tripByToken(token);
  if (!trip) return { ok: false, error: "This link has no trip.", status: 404 };
  if (trip.share_status === "revoked") return { ok: false, error: "This link has been stopped.", status: 410 };
  if (trip.status === "delivered" || trip.status === "cancelled") return { ok: true, status: trip.status };

  const target: TripStatus = action === "started" ? "in_transit" : action === "reached" ? "arrived" : "delivered";
  const order: TripStatus[] = ["planned", "loading", "in_transit", "arrived", "delivered"];
  if (order.indexOf(target) <= order.indexOf(trip.status)) return { ok: true, status: trip.status };

  const where = at && inIndia(at.lat, at.lng) ? at : null;
  const cleanNote = (note ?? "").trim().slice(0, 300) || null;
  const moved = await changeStatus(
    trip,
    target,
    "driver",
    cleanNote ? `Driver: ${cleanNote}` : null,
    where,
  );
  if (!moved) return { ok: false, error: "Could not update. Try again.", status: 503 };
  if (target === "delivered" && cleanNote) {
    await getSupabaseAdmin().from("live_trips").update({ pod_note: cleanNote }).eq("id", trip.id).is("pod_note", null);
  }
  return { ok: true, status: target };
}
