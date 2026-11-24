import "server-only";

import { randomBytes } from "node:crypto";

import { env } from "@/lib/env";
import { indianMobileDigits, normaliseIndianMobile } from "@/lib/phone";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  LIVE_WINDOW_MS,
  inIndia,
  type DriverStatus,
  type LiveDriverView,
  type LiveLocationView,
  type LivePoint,
  type LiveState,
} from "@/lib/live-location-shared";

/**
 * Live location from the driver's phone (migration 0078).
 *
 * The owner invites a driver from the truck page; the driver opens
 * /d/<token> on his phone and the page posts GPS fixes to
 * /api/driver/<token>/location. Free for now - no credits are spent.
 *
 * Every function here is safe to call before 0078 is applied: reads come back
 * "not available", writes come back with a plain message. Nothing throws into
 * the truck page.
 */

type DriverRow = {
  id: string;
  tracked_truck_id: string;
  user_id: string;
  driver_name: string | null;
  driver_phone: string | null;
  owner_label: string | null;
  token: string;
  status: DriverStatus;
  consent_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  revoked_at: string | null;
};

const DRIVER_COLUMNS =
  "id,tracked_truck_id,user_id,driver_name,driver_phone,owner_label,token,status,consent_at,last_seen_at,created_at,revoked_at";

const POINT_COLUMNS = "lat,lng,accuracy_m,speed_kmh,heading,recorded_at";

/** How far back the owner's trail goes, and how many points it carries. */
const TRAIL_MS = 2 * 60 * 60 * 1000;
const TRAIL_MAX = 240;

/** Most points one POST may carry (an offline queue being flushed). */
export const MAX_POINTS_PER_POST = 120;

/** One request per token per this many ms; the page reports every ~30 s. */
const MIN_POST_GAP_MS = 8_000;

/** Positions are kept this long. */
const KEEP_DAYS = 30;

/* -------------------------------------------------------------------------- */
/* small helpers                                                               */
/* -------------------------------------------------------------------------- */

export function newDriverToken(): string {
  return randomBytes(16).toString("base64url");
}

/** Tokens are base64url, 22 chars when we make them; anything else is not ours. */
export function plausibleToken(token: string): boolean {
  return /^[A-Za-z0-9_-]{16,64}$/.test(token);
}

export function driverLink(token: string): string {
  return `${env.siteUrl}/d/${token}`;
}

/** +91 98xxx xx210 */
export function maskPhone(stored: string | null | undefined): string | null {
  const d = indianMobileDigits(stored);
  if (!d) return null;
  return `+91 ${d.slice(0, 2)}xxx xx${d.slice(7)}`;
}

function inviteText(args: {
  driverName: string | null;
  ownerLabel: string;
  truckNumber: string;
  link: string;
}): string {
  const hi = args.driverName ? `नमस्ते ${args.driverName},` : "नमस्ते,";
  const en = args.driverName ? `Hello ${args.driverName},` : "Hello,";
  return [
    `${hi} ${args.ownerLabel} ने ट्रक ${args.truckNumber} की लाइव लोकेशन शेयर करने के लिए यह लिंक भेजा है। लिंक खोलें और "Start sharing" दबाएँ। आप कभी भी बंद कर सकते हैं।`,
    "",
    `${en} ${args.ownerLabel} asks you to share the live location of truck ${args.truckNumber}. Open the link and tap "Start sharing". You can stop anytime.`,
    "",
    args.link,
  ].join("\n");
}

function waHref(phone: string | null, text: string): string | null {
  const d = indianMobileDigits(phone);
  if (!d) return null;
  return `https://wa.me/91${d}?text=${encodeURIComponent(text)}`;
}

function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? String((error as { code: unknown }).code) : "";
  const message = "message" in error ? String((error as { message: unknown }).message) : "";
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    /truck_drivers|truck_locations/.test(message) && /does not exist|schema cache/.test(message)
  );
}

let warnedMissing = false;
function logFailure(what: string, error: unknown) {
  if (isMissingTable(error)) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn(`live location ${what} skipped - apply migration 0078`);
    }
    return;
  }
  const message =
    error && typeof error === "object" && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  console.error(`live location ${what} failed:`, message);
}

const n = (v: unknown): number | null => {
  const x = typeof v === "string" ? Number(v) : v;
  return typeof x === "number" && Number.isFinite(x) ? x : null;
};

function toPoint(row: Record<string, unknown>): LivePoint {
  return {
    lat: Number(row.lat),
    lng: Number(row.lng),
    accuracy_m: n(row.accuracy_m),
    speed_kmh: n(row.speed_kmh),
    heading: n(row.heading),
    recorded_at: String(row.recorded_at),
  };
}

/* -------------------------------------------------------------------------- */
/* owner side                                                                  */
/* -------------------------------------------------------------------------- */

type OwnTruck = { id: string; truck_number: string };

/** The truck, only if it belongs to this account. */
async function loadOwnTruck(userId: string, truckId: string): Promise<OwnTruck | null> {
  if (!/^[0-9a-f-]{36}$/i.test(truckId)) return null;
  const { data } = await getSupabaseAdmin()
    .from("tracked_trucks")
    .select("id,truck_number")
    .eq("id", truckId)
    .eq("user_id", userId)
    .maybeSingle<OwnTruck>();
  return data ?? null;
}

function stateOf(driver: DriverRow | null, now: number): LiveState {
  if (!driver || driver.status === "revoked") return "none";
  if (driver.status === "invited") return "invited";
  if (driver.status === "stopped") return "stopped";
  const seen = driver.last_seen_at ? new Date(driver.last_seen_at).getTime() : 0;
  return now - seen <= LIVE_WINDOW_MS ? "live" : "recent";
}

function driverView(row: DriverRow, truckNumber: string): LiveDriverView {
  const link = driverLink(row.token);
  return {
    id: row.id,
    driver_name: row.driver_name,
    phone_masked: maskPhone(row.driver_phone),
    owner_label: row.owner_label,
    status: row.status,
    consent_at: row.consent_at,
    last_seen_at: row.last_seen_at,
    created_at: row.created_at,
    link,
    wa_href: waHref(
      row.driver_phone,
      inviteText({
        driverName: row.driver_name,
        ownerLabel: row.owner_label || "Your truck owner",
        truckNumber,
        link,
      }),
    ),
  };
}

/**
 * Everything the owner card shows for one truck. Returns null when the truck is
 * not this account's (the route answers 404).
 */
export async function loadLiveLocation(
  userId: string,
  truckId: string,
): Promise<LiveLocationView | null> {
  const truck = await loadOwnTruck(userId, truckId);
  if (!truck) return null;

  const now = Date.now();
  const empty: LiveLocationView = {
    available: true,
    state: "none",
    driver: null,
    latest: null,
    trail: [],
    now: new Date(now).toISOString(),
  };

  const admin = getSupabaseAdmin();
  const [driverRes, pointsRes] = await Promise.all([
    admin
      .from("truck_drivers")
      .select(DRIVER_COLUMNS)
      .eq("tracked_truck_id", truck.id)
      .eq("user_id", userId)
      .neq("status", "revoked")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<DriverRow>(),
    admin
      .from("truck_locations")
      .select(POINT_COLUMNS)
      .eq("tracked_truck_id", truck.id)
      .eq("user_id", userId)
      .order("recorded_at", { ascending: false })
      .limit(TRAIL_MAX),
  ]);

  if (driverRes.error) {
    logFailure("read", driverRes.error);
    return { ...empty, available: !isMissingTable(driverRes.error) };
  }
  if (pointsRes.error) logFailure("read", pointsRes.error);

  const driver = driverRes.data ?? null;
  const points = ((pointsRes.data ?? []) as Record<string, unknown>[]).map(toPoint);
  const latest = points[0] ?? null;
  const cutoff = now - TRAIL_MS;
  const trail = points.filter((p) => new Date(p.recorded_at).getTime() >= cutoff);

  return {
    ...empty,
    state: stateOf(driver, now),
    driver: driver ? driverView(driver, truck.truck_number) : null,
    latest,
    trail,
  };
}

export type InviteResult = { ok: true } | { ok: false, error: string };

/**
 * Creates a fresh link for the truck, revoking any earlier one. The phone is
 * optional only in the sense that "Copy link" works without it; when given it
 * must be an Indian mobile.
 */
export async function inviteDriver(
  userId: string,
  truckId: string,
  input: { driverName?: string | null; phone?: string | null; ownerLabel?: string | null },
): Promise<InviteResult> {
  const truck = await loadOwnTruck(userId, truckId);
  if (!truck) return { ok: false, error: "Truck not found." };

  const rawPhone = (input.phone ?? "").trim();
  const phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
  if (rawPhone && !phone) {
    return { ok: false, error: "Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9." };
  }
  const driverName = (input.driverName ?? "").trim().slice(0, 80) || null;
  const ownerLabel = (input.ownerLabel ?? "").trim().slice(0, 80) || null;

  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  // Old link first: the unique index allows one open link per truck.
  const revoke = await admin
    .from("truck_drivers")
    .update({ status: "revoked", revoked_at: nowIso })
    .eq("tracked_truck_id", truck.id)
    .eq("user_id", userId)
    .neq("status", "revoked");
  if (revoke.error) {
    logFailure("invite", revoke.error);
    return {
      ok: false,
      error: isMissingTable(revoke.error)
        ? "Live location is not switched on yet (database update pending)."
        : "Could not create the link. Please try again.",
    };
  }

  const insert = await admin.from("truck_drivers").insert({
    tracked_truck_id: truck.id,
    user_id: userId,
    driver_name: driverName,
    driver_phone: phone,
    owner_label: ownerLabel,
    token: newDriverToken(),
    status: "invited",
  });
  if (insert.error) {
    logFailure("invite", insert.error);
    return { ok: false, error: "Could not create the link. Please try again." };
  }
  return { ok: true };
}

/** Stops sharing for good: the driver's link stops working at once. */
export async function revokeDriver(userId: string, truckId: string): Promise<InviteResult> {
  const truck = await loadOwnTruck(userId, truckId);
  if (!truck) return { ok: false, error: "Truck not found." };
  const { error } = await getSupabaseAdmin()
    .from("truck_drivers")
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("tracked_truck_id", truck.id)
    .eq("user_id", userId)
    .neq("status", "revoked");
  if (error) {
    logFailure("revoke", error);
    return { ok: false, error: "Could not stop sharing. Please try again." };
  }
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* driver side (public, token is the credential)                               */
/* -------------------------------------------------------------------------- */

export type DriverPageData =
  | { kind: "ok"; truckNumber: string; ownerLabel: string; driverName: string | null; status: DriverStatus }
  | { kind: "revoked" }
  | { kind: "invalid" };

/**
 * What /d/<token> shows. Deliberately carries no owner data beyond the label
 * the owner typed (or a generic fallback), and never the driver's own number.
 */
export async function loadDriverPage(token: string): Promise<DriverPageData> {
  if (!plausibleToken(token)) return { kind: "invalid" };
  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("truck_drivers")
    .select("id,tracked_truck_id,driver_name,owner_label,status")
    .eq("token", token)
    .maybeSingle<Pick<DriverRow, "id" | "tracked_truck_id" | "driver_name" | "owner_label" | "status">>();
  if (error) {
    logFailure("driver page", error);
    return { kind: "invalid" };
  }
  if (!data) return { kind: "invalid" };
  if (data.status === "revoked") return { kind: "revoked" };

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("truck_number")
    .eq("id", data.tracked_truck_id)
    .maybeSingle<{ truck_number: string }>();
  if (!truck) return { kind: "revoked" };

  return {
    kind: "ok",
    truckNumber: truck.truck_number,
    ownerLabel: data.owner_label || "the truck owner",
    driverName: data.driver_name,
    status: data.status,
  };
}

export type IncomingPoint = {
  lat?: unknown;
  lng?: unknown;
  accuracy?: unknown;
  speed?: unknown; // m/s, as the Geolocation API reports it
  heading?: unknown;
  t?: unknown; // epoch ms, device clock
};

export type DriverPostResult =
  | { status: 200; body: { ok: true; accepted: number; dropped: number; sharing: boolean } }
  | { status: 400 | 404 | 410 | 429 | 503; body: { ok: false; error: string; retryAfter?: number } };

/**
 * One report from the driver's page: zero or more fixes (zero is a heartbeat),
 * plus whether sharing is on. `stop: true` marks the link stopped.
 *
 * The throttle is a conditional update on last_seen_at, so two instances
 * racing on one token cannot both pass: only the one whose update matched a
 * row gets to insert.
 */
export async function recordDriverReport(
  token: string,
  report: { points: IncomingPoint[]; consent?: boolean; stop?: boolean },
): Promise<DriverPostResult> {
  if (!plausibleToken(token)) return { status: 404, body: { ok: false, error: "Link not valid." } };

  const admin = getSupabaseAdmin();
  const { data: driver, error } = await admin
    .from("truck_drivers")
    .select("id,tracked_truck_id,user_id,status,consent_at,last_seen_at")
    .eq("token", token)
    .maybeSingle<Pick<DriverRow, "id" | "tracked_truck_id" | "user_id" | "status" | "consent_at" | "last_seen_at">>();
  if (error) {
    logFailure("report", error);
    return { status: 503, body: { ok: false, error: "Service unavailable. Will retry." } };
  }
  if (!driver) return { status: 404, body: { ok: false, error: "Link not valid." } };
  if (driver.status === "revoked") {
    return { status: 410, body: { ok: false, error: "The owner has stopped this link." } };
  }

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("id")
    .eq("id", driver.tracked_truck_id)
    .eq("user_id", driver.user_id)
    .maybeSingle<{ id: string }>();
  if (!truck) return { status: 410, body: { ok: false, error: "This truck is no longer tracked." } };

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  if (report.stop) {
    await admin
      .from("truck_drivers")
      .update({ status: "stopped", last_seen_at: nowIso })
      .eq("id", driver.id)
      .neq("status", "revoked");
    return { status: 200, body: { ok: true, accepted: 0, dropped: 0, sharing: false } };
  }

  // Sharing needs consent once; the Start button sends it.
  if (!driver.consent_at && !report.consent) {
    return { status: 400, body: { ok: false, error: "Tap Start sharing first." } };
  }

  // Throttle + mark seen in one statement.
  const cutoff = new Date(now - MIN_POST_GAP_MS).toISOString();
  const patch: Record<string, unknown> = { last_seen_at: nowIso, status: "active" };
  if (!driver.consent_at) patch.consent_at = nowIso;
  const { data: claimed, error: claimError } = await admin
    .from("truck_drivers")
    .update(patch)
    .eq("id", driver.id)
    .neq("status", "revoked")
    .or(`last_seen_at.is.null,last_seen_at.lt.${cutoff},status.neq.active`)
    .select("id");
  if (claimError) {
    logFailure("report", claimError);
    return { status: 503, body: { ok: false, error: "Service unavailable. Will retry." } };
  }
  if (!claimed || claimed.length === 0) {
    return { status: 429, body: { ok: false, error: "Too fast.", retryAfter: Math.ceil(MIN_POST_GAP_MS / 1000) } };
  }

  // Validate and clamp the fixes.
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
    // A fix worse than 3 km is a cell-tower guess; it would mislead more than help.
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
      tracked_truck_id: driver.tracked_truck_id,
      driver_id: driver.id,
      user_id: driver.user_id,
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
      accuracy_m: accuracy !== null ? Math.round(accuracy) : null,
      // Above 160 km/h on a truck is a GPS glitch, not a reading.
      speed_kmh: speedKmh !== null && speedKmh <= 160 ? Math.round(speedKmh * 10) / 10 : null,
      heading: heading !== null && heading >= 0 && heading < 360 ? Math.round(heading) : null,
      recorded_at: new Date(t).toISOString(),
      received_at: nowIso,
      source: "phone",
    });
  }
  dropped += Math.max(0, report.points.length - MAX_POINTS_PER_POST);

  if (rows.length > 0) {
    const { error: insertError } = await admin.from("truck_locations").insert(rows);
    if (insertError) {
      logFailure("insert", insertError);
      return { status: 503, body: { ok: false, error: "Could not save. Will retry." } };
    }
  }

  // Retention, a little at a time: about one report in fifty sweeps this truck.
  if (Math.random() < 0.02) {
    const { error: purgeError } = await admin
      .from("truck_locations")
      .delete()
      .eq("tracked_truck_id", driver.tracked_truck_id)
      .lt("received_at", new Date(now - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString());
    if (purgeError) logFailure("purge", purgeError);
  }

  return { status: 200, body: { ok: true, accepted: rows.length, dropped, sharing: true } };
}
