"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { extractDispatch, type DispatchExtract } from "@/lib/live-ai";
import { changeStatus, recordEvent } from "@/lib/live/automation";
import { isMissingRelation, liveSchema82, liveSchema83, liveSchema84, logLive, newToken, safeReturn, withParam } from "@/lib/live/server";
import {
  ALERT_KEYS,
  ALERT_META,
  SITE_TYPES,
  alertDefaults,
  fmtIst,
  type AlertKey,
  type AlertSettings,
  type TripAlertOverrides,
  PLACE_KINDS,
  PURPOSES,
  REASON_FIELDS,
  STATE_LABEL,
  TRIP_FIELDS_DYNAMIC,
  TRIP_STATES,
  fromLocalInput,
  normalizeEway,
  normalizeVehicleNo,
  parseLatLng,
  prettyVehicle,
  statusForState,
  tripDirection,
  tripNo,
  tripState,
  type BusinessType,
  type LiveDriver,
  type LiveTrip,
  type LiveVehicle,
  type PlaceKind,
  type TripDirection,
  type TripState,
} from "@/lib/live/shared";
import { normaliseIndianMobile, PHONE_ERROR } from "@/lib/phone";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";

/**
 * Server Actions for the Live tracking module (0079). Every one re-checks the
 * session and that the trip/place/vehicle/driver belongs to this workspace.
 */

type Actor = { userId: string; ownerId: string };

async function actor(requireEnabled = true): Promise<Actor | ActionResult> {
  const session = await getSessionUser();
  if (!session) return { ok: false, error: "Please sign in again." };
  if (session.profile.status !== "active") return { ok: false, error: "Account suspended." };
  const modules = (session.profile as unknown as { modules?: unknown }).modules;
  if (!Array.isArray(modules)) return { ok: false, error: "Live tracking is being set up (database update pending)." };
  if (requireEnabled && !modules.includes("live")) return { ok: false, error: "Switch on Live tracking first." };
  return { userId: session.id, ownerId: session.id };
}

/* v4 (0083): one trip form (createTrip / updateTrip), assignment only inside trips,
   masters with custom fields and hard delete. docs/LIVE-PLAN-v4.md. */

function isActor(a: Actor | ActionResult): a is Actor {
  return "ownerId" in a;
}

const str = (fd: FormData, k: string, max = 200): string | null => {
  const v = fd.get(k);
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
};

const numOrNull = (fd: FormData, k: string): number | null | "bad" => {
  const v = str(fd, k, 30);
  if (!v) return null;
  const n = Number(v.replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : "bad";
};

const uuidOrNull = (fd: FormData, k: string): string | null => {
  const v = str(fd, k, 40);
  return v && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
};

function dbError(error: unknown, what: string): ActionResult {
  logLive(what, error);
  return {
    ok: false,
    error: isMissingRelation(error)
      ? "Live tracking is being set up (database update pending)."
      : "Could not save. Please try again.",
  };
}

/* -------------------------------------------------------------------------- */
/* module switch                                                               */
/* -------------------------------------------------------------------------- */

export async function enableLiveModule(): Promise<ActionResult> {
  const a = await actor(false);
  if (!isActor(a)) return a;
  const admin = getSupabaseAdmin();
  const { data, error } = await admin.from("profiles").select("modules").eq("id", a.userId).maybeSingle<{ modules: string[] }>();
  if (error) return dbError(error, "enable");
  const modules = Array.from(new Set([...(data?.modules ?? ["toll"]), "live"]));
  const { error: upd } = await admin.from("profiles").update({ modules }).eq("id", a.userId);
  if (upd) return dbError(upd, "enable");
  revalidatePath("/live", "layout");
  revalidatePath("/apps");
  return { ok: true, message: "Live tracking is on." };
}

/** Form-friendly wrapper (ActionForm signature). */
export async function enableLiveModuleForm(_prev: ActionResult | null, _fd: FormData): Promise<ActionResult> {
  void _prev;
  void _fd;
  const r = await enableLiveModule();
  if (r.ok) redirect("/live");
  return r;
}

/* -------------------------------------------------------------------------- */
/* AI / rules: paste e-way bill or invoice text                               */
/* -------------------------------------------------------------------------- */

export async function parseDispatchText(
  text: string,
): Promise<{ ok: true; data: DispatchExtract; source: "ai" | "rules" } | { ok: false; error: string }> {
  const a = await actor();
  if (!isActor(a)) return { ok: false, error: a.ok ? "" : a.error };
  const clean = (typeof text === "string" ? text : "").slice(0, 8000);
  if (clean.trim().length < 8) return { ok: false, error: "Paste the e-way bill, invoice or LR text first." };
  try {
    const res = await extractDispatch(clean);
    if (!Object.keys(res.data).length) return { ok: false, error: "Could not find any details in that text." };
    return { ok: true, data: res.data, source: res.source };
  } catch (error) {
    console.error("parseDispatchText failed:", (error as Error).message);
    return { ok: false, error: "Could not read that text. Fill the form by hand." };
  }
}

/* -------------------------------------------------------------------------- */
/* places                                                                      */
/* -------------------------------------------------------------------------- */

export async function savePlace(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 120);
  if (!name) return { ok: false, error: "Give the place a name." };
  // v5: Type = a preset (Factory, Warehouse, Depot, Branch office, Customer site) or "Other" with own text.
  let kind = (str(fd, "kind", 20) ?? "warehouse") as PlaceKind;
  let siteType: string | null = null;
  const st = str(fd, "site_type", 40);
  if (st) {
    const preset = SITE_TYPES.find((t) => t.label === st);
    if (preset) {
      kind = preset.kind;
      siteType = preset.label;
    } else {
      kind = "other";
      siteType = str(fd, "site_type_custom", 40);
      if (!siteType) return { ok: false, error: "Type: write the type, e.g. Cold store." };
    }
  }
  if (!PLACE_KINDS.includes(kind)) return { ok: false, error: "Pick a type." };

  const rawPhone = str(fd, "contact_phone", 20);
  const phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
  if (rawPhone && !phone) return { ok: false, error: `Contact phone: ${PHONE_ERROR}` };

  const rawLoc = str(fd, "location", 500);
  const loc = parseLatLng(rawLoc);
  const locUrl = rawLoc && !loc && /^https:\/\/[^\s]{6,}$/i.test(rawLoc) ? rawLoc.slice(0, 500) : null;
  if (rawLoc && !loc && !locUrl) {
    return { ok: false, error: "Location not understood. Pick it on the map, paste 'lat, lng' or a Google Maps link." };
  }
  const radius = Number(str(fd, "radius_m", 6) ?? 500);
  if (!Number.isFinite(radius) || radius < 50 || radius > 20000) return { ok: false, error: "Geofence radius must be 50 to 20,000 m." };
  const pincode = str(fd, "pincode", 6);
  if (pincode && !/^[1-9][0-9]{5}$/.test(pincode)) return { ok: false, error: "Pincode must be 6 digits." };
  const gstin = str(fd, "gstin", 15)?.toUpperCase() ?? null;
  if (gstin && gstin.length !== 15) return { ok: false, error: "GSTIN must be 15 characters." };

  // v4: the form keeps only name, type, address, location, radius and custom fields;
  // older fields are written only when the form sends them (so an edit never wipes them).
  const optional: Record<string, unknown> = { contact_name: str(fd, "contact_name", 80), contact_phone: phone, city: str(fd, "city", 80), state: str(fd, "state", 60), pincode, gstin, notes: str(fd, "notes", 500) };
  const row: Record<string, unknown> = {
    owner_id: a.ownerId,
    kind,
    name,
    address: str(fd, "address", 300),
    lat: loc?.lat ?? null,
    lng: loc?.lng ?? null,
    radius_m: Math.round(radius),
    updated_at: new Date().toISOString(),
    ...(readCustomFields(fd) ? { custom_fields: readCustomFields(fd) } : {}),
  };
  for (const [k, v] of Object.entries(optional)) if (fd.has(k)) row[k] = v;
  if (await liveSchema84()) {
    if (st) row.site_type = siteType;
    if (fd.has("location")) row.maps_url = locUrl;
  }
  const admin = getSupabaseAdmin();
  const row83 = await strip83(row);
  const res = id
    ? await admin.from("live_places").update(row83).eq("id", id).eq("owner_id", a.ownerId).select("id").maybeSingle<{ id: string }>()
    : await admin.from("live_places").insert(row83).select("id").maybeSingle<{ id: string }>();
  if (res.error) return dbError(res.error, "place");
  revalidatePath("/live", "layout");
  const back = safeReturn(str(fd, "return", 200));
  if (back && res.data?.id) redirect(withParam(back, "picked_place", res.data.id));
  const after = safeReturn(str(fd, "after", 200));
  if (after) redirect(after);
  return { ok: true, message: id ? "Place updated." : "Place added." };
}

export async function archivePlace(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  if (!id) return { ok: false, error: "Place not found." };
  const { error } = await getSupabaseAdmin()
    .from("live_places")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", a.ownerId);
  if (error) return dbError(error, "archive place");
  revalidatePath("/live", "layout");
  return { ok: true, message: "Place archived. Old trips keep their history." };
}

/** Hard delete. Trips keep name, address and location (0083 snapshot trigger + set-null FK). */
export async function deletePlace(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  if (!id) return { ok: false, error: "Place not found." };
  const admin = getSupabaseAdmin();
  const { data: place } = await admin.from("live_places").select("id,name,address,lat,lng").eq("id", id).eq("owner_id", a.ownerId).maybeSingle<{ id: string; name: string; address: string | null; lat: number | null; lng: number | null }>();
  if (!place) return { ok: false, error: "Place not found." };
  const { data: busy } = await admin
    .from("live_trips")
    .select("trip_seq")
    .eq("owner_id", a.ownerId)
    .or(`from_place_id.eq.${id},to_place_id.eq.${id}`)
    .in("status", ["in_transit", "arrived"])
    .limit(1)
    .maybeSingle<{ trip_seq: number }>();
  if (busy) return { ok: false, error: `${place.name} is on ${tripNo(busy.trip_seq)}, which is Active. Finish that trip first.` };
  // Without 0083's trigger, copy the name onto its trips here.
  await admin.from("live_trips").update({ from_name: place.name, from_lat: place.lat, from_lng: place.lng }).eq("from_place_id", id).is("from_name", null);
  await admin.from("live_trips").update({ to_name: place.name, to_lat: place.lat, to_lng: place.lng }).eq("to_place_id", id).is("to_name", null);
  const { error } = await admin.from("live_places").delete().eq("id", id).eq("owner_id", a.ownerId);
  if (error) return dbError(error, "delete place");
  revalidatePath("/live", "layout");
  return { ok: true, message: `${place.name} deleted. Old trips still show it.` };
}

/**
 * Address -> lat/lng with OpenStreetMap Nominatim (free, ~1 request a second).
 * Only on the owner's tap. Returns the best Indian match.
 */
export async function geocodeAddress(query: string): Promise<{ ok: true; lat: number; lng: number; label: string } | { ok: false; error: string }> {
  const a = await actor();
  if (!isActor(a)) return { ok: false, error: a.ok ? "" : a.error };
  const q = (typeof query === "string" ? query : "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (q.length < 3) return { ok: false, error: "Type an address or city first." };
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Rahdari-Live/1.0 (+https://rahdari.in)", "Accept-Language": "en" },
      signal: AbortSignal.timeout(8000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, error: "Map search is busy. Try again in a minute." };
    const rows = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    const r = rows[0];
    if (!r) return { ok: false, error: "Not found on the map. Try a city name, or paste a Google Maps link." };
    return { ok: true, lat: Number(r.lat), lng: Number(r.lon), label: r.display_name };
  } catch {
    return { ok: false, error: "Map search did not answer. Try again." };
  }
}

/* -------------------------------------------------------------------------- */
/* v4 helpers                                                                  */
/* -------------------------------------------------------------------------- */

const ACTIVE = ["in_transit", "arrived"];
const COLS_83 = ["custom_fields", "temp_truck", "from_maps_url", "to_maps_url", "archived_at"];

/** Before 0083 is applied its columns do not exist: leave them out. */
async function strip83<T extends Record<string, unknown>>(row: T): Promise<T> {
  if (await liveSchema83()) return row;
  const out = { ...row };
  for (const k of COLS_83) delete out[k];
  return out;
}

/** "Add field" rows: cf_key[] / cf_val[] -> { key: value } (max 20, trimmed, empty keys dropped). */
function readCustomFields(fd: FormData): Record<string, string> | null {
  if (!fd.has("cf_present")) return null;
  const keys = fd.getAll("cf_key");
  const vals = fd.getAll("cf_val");
  const out: Record<string, string> = {};
  keys.slice(0, 20).forEach((k, i) => {
    const key = typeof k === "string" ? k.trim().slice(0, 40) : "";
    const v = vals[i];
    const val = typeof v === "string" ? v.trim().slice(0, 200) : "";
    if (key && val) out[key] = val;
  });
  return out;
}

async function ownDriver(ownerId: string, id: string | null): Promise<LiveDriver | null> {
  if (!id) return null;
  const { data } = await getSupabaseAdmin().from("live_drivers").select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle<LiveDriver>();
  return data ?? null;
}

async function ownVehicle(ownerId: string, id: string | null): Promise<LiveVehicle | null> {
  if (!id) return null;
  const { data } = await getSupabaseAdmin().from("live_vehicles").select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle<LiveVehicle>();
  return data ?? null;
}

async function ownTrip(ownerId: string, id: string | null): Promise<LiveTrip | null> {
  if (!id) return null;
  const { data } = await getSupabaseAdmin().from("live_trips").select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle<LiveTrip>();
  return data ?? null;
}

/** The trip this driver / truck is ACTIVE on (one at a time), other than `except`. */
async function activeTripOf(ownerId: string, col: "driver_id" | "vehicle_id" | "vehicle_no", value: string, except?: string): Promise<LiveTrip | null> {
  let q = getSupabaseAdmin().from("live_trips").select("*").eq("owner_id", ownerId).eq(col, value).in("status", ACTIVE);
  if (except) q = q.neq("id", except);
  const { data } = await q.limit(1).maybeSingle<LiveTrip>();
  return data ?? null;
}

/** Sharing comes back on for a master driver picked on a trip again. */
async function reactivateSharing(driver: LiveDriver, userId: string, trip: LiveTrip | null) {
  const off = driver.share_status === "revoked" || driver.share_status === "expired" || Boolean(driver.share_expires_at);
  if (!off && driver.share_token) return;
  const patch: Record<string, unknown> = { share_expires_at: null, updated_at: new Date().toISOString() };
  if (!driver.share_token) patch.share_token = newToken();
  if (driver.share_status === "revoked" || driver.share_status === "expired") patch.share_status = "invited";
  await getSupabaseAdmin().from("live_drivers").update(patch).eq("id", driver.id);
  if (trip && (driver.share_status === "revoked" || driver.share_status === "expired")) {
    await recordEvent(trip, { kind: "share", title: `${driver.name}'s link switched back on (same link)`, actor: "owner", actorUserId: userId });
  }
}

/** A temporary driver taken off his trip: his link stops now; the sweep removes him. */
async function retireTempDriver(driverId: string) {
  const nowIso = new Date().toISOString();
  await getSupabaseAdmin()
    .from("live_drivers")
    .update({ share_status: "expired", share_expires_at: nowIso, updated_at: nowIso })
    .eq("id", driverId)
    .eq("kind", "one_time");
}

/* -------------------------------------------------------------------------- */
/* trucks (master)                                                             */
/* -------------------------------------------------------------------------- */

function vehicleRowFrom(fd: FormData): { ok: true; number: string; row: Record<string, unknown> } | { ok: false; error: string } {
  const number = normalizeVehicleNo(str(fd, "number", 20));
  if (!/^[A-Z0-9]{4,12}$/.test(number)) return { ok: false, error: "Enter the truck number, e.g. GJ36X1234." };
  const owner_type = str(fd, "owner_type", 12) === "transporter" ? "transporter" : "own";
  const row: Record<string, unknown> = { number, owner_type, ownership: owner_type === "own" ? "own" : "market" };
  row.transporter = owner_type === "own" ? null : str(fd, "transporter", 120);
  // v5: vehicle type (preset or "Other" text) and capacity in tonnes (stored as kg).
  if (fd.has("vehicle_type")) {
    const vt = str(fd, "vehicle_type", 40);
    row.vehicle_type = vt === "__other" ? str(fd, "vehicle_type_custom", 40) : vt;
  }
  if (fd.has("capacity_t")) {
    const raw = str(fd, "capacity_t", 8);
    const t = raw ? Number(raw.replace(",", ".")) : null;
    if (t != null && (!Number.isFinite(t) || t <= 0 || t > 100)) return { ok: false, error: "Capacity: tonnes between 0.1 and 100." };
    row.capacity_kg = t != null ? Math.round(t * 1000) : null;
  }
  const cf = readCustomFields(fd);
  if (cf) row.custom_fields = cf;
  return { ok: true, number, row };
}

export async function saveVehicle(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  const v = vehicleRowFrom(fd);
  if (!v.ok) return v;
  const admin = getSupabaseAdmin();
  const row = await strip83({ ...v.row, updated_at: new Date().toISOString() });
  let savedId = id;
  if (id) {
    const { error } = await admin.from("live_vehicles").update(row).eq("id", id).eq("owner_id", a.ownerId);
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, error: "That truck number is already in your list." };
      return dbError(error, "vehicle");
    }
  } else {
    const { data: existing } = await admin.from("live_vehicles").select("id,archived_at").eq("owner_id", a.ownerId).eq("number", v.number).maybeSingle<{ id: string; archived_at: string | null }>();
    if (existing && !existing.archived_at) return { ok: false, error: "That truck number is already in your list." };
    const res = existing
      ? await admin.from("live_vehicles").update({ ...row, archived_at: null }).eq("id", existing.id).select("id").maybeSingle<{ id: string }>()
      : await admin.from("live_vehicles").insert({ owner_id: a.ownerId, ...row }).select("id").maybeSingle<{ id: string }>();
    if (res.error || !res.data) return dbError(res.error, "vehicle");
    savedId = res.data.id;
  }
  revalidatePath("/live", "layout");
  const back = safeReturn(str(fd, "return", 200));
  if (!id && back && savedId) redirect(withParam(back, "picked_vehicle", savedId));
  const after = safeReturn(str(fd, "after", 200));
  if (after) redirect(after);
  return { ok: true, message: id ? "Truck updated." : "Truck saved." };
}

async function onActiveTripMsg(ownerId: string, col: "driver_id" | "vehicle_id", id: string, what: string): Promise<string | null> {
  const t = await activeTripOf(ownerId, col, id);
  return t ? `${what} is on ${tripNo(t.trip_seq)}, which is Active. Change it on that trip first.` : null;
}

export async function archiveVehicle(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const vehicle = await ownVehicle(a.ownerId, uuidOrNull(fd, "id"));
  if (!vehicle) return { ok: false, error: "Truck not found." };
  const busy = await onActiveTripMsg(a.ownerId, "vehicle_id", vehicle.id, "This truck");
  if (busy) return { ok: false, error: busy };
  const { error } = await getSupabaseAdmin().from("live_vehicles").update({ archived_at: new Date().toISOString() }).eq("id", vehicle.id);
  if (error) return dbError(error, "archive vehicle");
  revalidatePath("/live", "layout");
  return { ok: true, message: "Truck archived. Its trips keep their history." };
}

export async function restoreVehicle(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const vehicle = await ownVehicle(a.ownerId, uuidOrNull(fd, "id"));
  if (!vehicle) return { ok: false, error: "Truck not found." };
  const { error } = await getSupabaseAdmin().from("live_vehicles").update({ archived_at: null }).eq("id", vehicle.id);
  if (error) return dbError(error, "restore vehicle");
  revalidatePath("/live", "layout");
  return { ok: true, message: "Truck restored." };
}

/** Hard delete. Trips keep the number (0083 snapshot trigger + set-null FK). */
export async function deleteVehicle(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const vehicle = await ownVehicle(a.ownerId, uuidOrNull(fd, "id"));
  if (!vehicle) return { ok: false, error: "Truck not found." };
  const busy = await onActiveTripMsg(a.ownerId, "vehicle_id", vehicle.id, "This truck");
  if (busy) return { ok: false, error: busy };
  const admin = getSupabaseAdmin();
  // Without 0083's trigger, copy the number onto its trips here.
  await admin.from("live_trips").update({ vehicle_no: vehicle.number }).eq("vehicle_id", vehicle.id).is("vehicle_no", null);
  const { error } = await admin.from("live_vehicles").delete().eq("id", vehicle.id).eq("owner_id", a.ownerId);
  if (error) return dbError(error, "delete vehicle");
  revalidatePath("/live", "layout");
  return { ok: true, message: `${prettyVehicle(vehicle.number)} deleted. Old trips still show its number.` };
}

/* -------------------------------------------------------------------------- */
/* drivers (master + link)                                                     */
/* -------------------------------------------------------------------------- */

export async function saveDriver(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 80);
  if (!name) return { ok: false, error: "Enter the driver's name." };
  const rawPhone = str(fd, "phone", 20);
  const phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
  if (rawPhone && !phone) return { ok: false, error: `Driver mobile: ${PHONE_ERROR}` };
  const cf = readCustomFields(fd);
  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();

  if (!id) {
    if (!phone) return { ok: false, error: "Enter the driver's mobile - his tracking link goes to it on WhatsApp." };
    const { data: same } = await admin.from("live_drivers").select("*").eq("owner_id", a.ownerId).eq("kind", "own").eq("phone", phone).maybeSingle<LiveDriver>();
    let driverId: string;
    let message = "Driver saved. His tracking link is ready.";
    if (same) {
      if (!same.archived_at) return { ok: false, error: `This mobile is already saved as ${same.name}.` };
      await admin.from("live_drivers").update(await strip83({ archived_at: null, name, share_status: "invited", share_expires_at: null, updated_at: nowIso, ...(cf ? { custom_fields: cf } : {}) })).eq("id", same.id);
      driverId = same.id;
      message = "This mobile was archived - driver restored with the same link.";
    } else {
      // The link is made now and reused on every trip he is picked for.
      const { data, error } = await admin
        .from("live_drivers")
        .insert(await strip83({ owner_id: a.ownerId, name, phone, kind: "own", share_token: newToken(), share_status: "invited", ...(cf ? { custom_fields: cf } : {}) }))
        .select("id")
        .maybeSingle<{ id: string }>();
      if (error || !data) {
        if ((error as { code?: string } | null)?.code === "23505") return { ok: false, error: "Another driver already has this mobile number." };
        return dbError(error, "driver insert");
      }
      driverId = data.id;
    }
    revalidatePath("/live", "layout");
    const back = safeReturn(str(fd, "return", 200));
    if (back) redirect(withParam(back, "picked_driver", driverId));
    const after = safeReturn(str(fd, "after", 200));
    if (after) redirect(after);
    return { ok: true, message };
  }

  const driver = await ownDriver(a.ownerId, id);
  if (!driver) return { ok: false, error: "Driver not found." };
  const patch = await strip83({ name, phone, updated_at: nowIso, ...(cf ? { custom_fields: cf } : {}) });
  const { error } = await admin.from("live_drivers").update(patch).eq("id", driver.id).eq("owner_id", a.ownerId);
  if (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false, error: "Another driver already has this mobile number." };
    return dbError(error, "driver");
  }
  revalidatePath("/live", "layout");
  const after = safeReturn(str(fd, "after", 200));
  if (after) redirect(after);
  return { ok: true, message: "Driver updated." };
}

/** Soft delete: link stops, every trip and position stays. */
export async function archiveDriver(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const driver = await ownDriver(a.ownerId, uuidOrNull(fd, "id"));
  if (!driver) return { ok: false, error: "Driver not found." };
  const busy = await onActiveTripMsg(a.ownerId, "driver_id", driver.id, driver.name);
  if (busy) return { ok: false, error: busy };
  const { error } = await getSupabaseAdmin().from("live_drivers").update({ archived_at: new Date().toISOString(), share_status: "revoked" }).eq("id", driver.id);
  if (error) return dbError(error, "archive driver");
  revalidatePath("/live", "layout");
  redirect("/live/masters/drivers");
}

export async function restoreDriver(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const driver = await ownDriver(a.ownerId, uuidOrNull(fd, "id"));
  if (!driver) return { ok: false, error: "Driver not found." };
  const { error } = await getSupabaseAdmin().from("live_drivers").update({ archived_at: null, share_status: "invited", share_expires_at: null }).eq("id", driver.id);
  if (error) return dbError(error, "restore driver");
  revalidatePath("/live", "layout");
  return { ok: true, message: "Driver restored. Send him the link again." };
}

/** Hard delete. Trips keep his name and mobile (0083 snapshot trigger + set-null FK). */
export async function deleteDriver(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const driver = await ownDriver(a.ownerId, uuidOrNull(fd, "id"));
  if (!driver) return { ok: false, error: "Driver not found." };
  const busy = await onActiveTripMsg(a.ownerId, "driver_id", driver.id, driver.name);
  if (busy) return { ok: false, error: busy };
  const admin = getSupabaseAdmin();
  await admin.from("live_trips").update({ driver_name: driver.name }).eq("driver_id", driver.id).is("driver_name", null);
  const { error } = await admin.from("live_drivers").delete().eq("id", driver.id).eq("owner_id", a.ownerId);
  if (error) return dbError(error, "delete driver");
  revalidatePath("/live", "layout");
  redirect("/live/masters/drivers");
}

/** New link: the old one (and any older trip links) stop at once. */
export async function newDriverLink(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const driver = await ownDriver(a.ownerId, uuidOrNull(fd, "driver_id"));
  if (!driver) return { ok: false, error: "Driver not found." };
  const admin = getSupabaseAdmin();
  const { error } = await admin
    .from("live_drivers")
    .update({ share_token: newToken(), share_status: "invited", share_last_seen_at: null, share_expires_at: null })
    .eq("id", driver.id);
  if (error) return dbError(error, "new link");
  await admin.from("live_trips").update({ driver_token: null }).eq("driver_id", driver.id).not("driver_token", "is", null);
  const trip = await activeTripOf(a.ownerId, "driver_id", driver.id);
  if (trip) {
    await admin.from("live_trips").update({ share_status: "invited", share_last_seen_at: null }).eq("id", trip.id);
    await recordEvent(trip, { kind: "share", title: `New link for ${driver.name} (old link stopped)`, actor: "owner", actorUserId: a.userId });
  }
  revalidatePath("/live", "layout");
  return { ok: true, message: "New link ready. Send it to the driver." };
}

/** You switch the driver's link off (he sees "link stopped"). */
export async function stopDriverSharing(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const driver = await ownDriver(a.ownerId, uuidOrNull(fd, "driver_id"));
  if (!driver) return { ok: false, error: "Driver not found." };
  const { error } = await getSupabaseAdmin().from("live_drivers").update({ share_status: "revoked" }).eq("id", driver.id);
  if (error) return dbError(error, "stop link");
  const trip = await activeTripOf(a.ownerId, "driver_id", driver.id);
  if (trip) {
    await getSupabaseAdmin().from("live_trips").update({ share_status: "stopped" }).eq("id", trip.id);
    await recordEvent(trip, { kind: "share", title: `You switched ${driver.name}'s link off`, actor: "owner", actorUserId: a.userId });
  }
  revalidatePath("/live", "layout");
  return { ok: true, message: "Link off. Nothing more is recorded." };
}

/** Same link back on (re-invite without a new link). */
export async function resumeDriverSharing(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const driver = await ownDriver(a.ownerId, uuidOrNull(fd, "driver_id"));
  if (!driver) return { ok: false, error: "Driver not found." };
  const trip = await activeTripOf(a.ownerId, "driver_id", driver.id);
  await reactivateSharing({ ...driver, share_status: driver.share_status === "stopped" ? "revoked" : driver.share_status }, a.userId, trip);
  revalidatePath("/live", "layout");
  return { ok: true, message: "Link is on. Send it again on WhatsApp." };
}

/* -------------------------------------------------------------------------- */
/* trips: one form for create and edit                                         */
/* -------------------------------------------------------------------------- */

const PURPOSE_SET = new Set<string>(PURPOSES);
const PARTY_SET = new Set<string>(["dealer", "customer", "internal", "supplier", "other"]);
const COLS_82 = ["direction", "party_type", "party_name", "from_address", "to_address", "inline_driver"];

async function strip82<T extends Record<string, unknown>>(row: T): Promise<T> {
  if (await liveSchema82()) return row;
  const out = { ...row };
  for (const k of COLS_82) delete out[k];
  return out;
}

type Loc = { lat: number | null; lng: number | null; url: string | null };

/** "lat, lng", a full Google Maps link (read), or any https maps link (kept as a link only). */
function readLoc(raw: string | null, label: string): { ok: true; v: Loc } | { ok: false; error: string } {
  if (!raw) return { ok: true, v: { lat: null, lng: null, url: null } };
  const p = parseLatLng(raw);
  const isUrl = /^https:\/\/[^\s]{6,}$/i.test(raw);
  if (!p && !isUrl) return { ok: false, error: `${label}: pick it on the map, or paste a Google Maps link.` };
  return { ok: true, v: { lat: p?.lat ?? null, lng: p?.lng ?? null, url: isUrl ? raw.slice(0, 500) : null } };
}

type End = { place_id: string | null; name: string | null; address: string | null; lat: number | null; lng: number | null; url: string | null; city: string | null };

/** From / To: a warehouse (master) or a custom location typed on the trip (never saved as a master). */
async function readEnd(fd: FormData, ownerId: string, side: "from" | "to"): Promise<{ ok: true; v: End } | { ok: false; error: string }> {
  const label = side === "from" ? "From" : "To";
  if (str(fd, `${side}_mode`, 10) === "custom") {
    const name = str(fd, `${side}_name`, 120);
    if (!name) return { ok: false, error: `${label}: enter the place name.` };
    const loc = readLoc(str(fd, `${side}_location`, 500), label);
    if (!loc.ok) return loc;
    return { ok: true, v: { place_id: null, name, address: str(fd, `${side}_address`, 300), lat: loc.v.lat, lng: loc.v.lng, url: loc.v.url, city: str(fd, `${side}_city`, 80) } };
  }
  const id = uuidOrNull(fd, `${side}_place_id`);
  if (!id) return { ok: true, v: { place_id: null, name: null, address: null, lat: null, lng: null, url: null, city: null } };
  const { data } = await getSupabaseAdmin().from("live_places").select("id,name,city").eq("id", id).eq("owner_id", ownerId).maybeSingle<{ id: string; name: string; city: string | null }>();
  if (!data) return { ok: false, error: `${label}: that warehouse is not in your list.` };
  return { ok: true, v: { place_id: data.id, name: data.name, address: null, lat: null, lng: null, url: null, city: data.city } };
}

function endColumns(side: "from" | "to", e: End): Record<string, unknown> {
  const c: Record<string, unknown> = {
    [`${side}_place_id`]: e.place_id,
    [`${side}_name`]: e.name,
    [`${side}_address`]: e.address,
    [`${side}_lat`]: e.lat,
    [`${side}_lng`]: e.lng,
    [`${side}_maps_url`]: e.url,
  };
  if (side === "to") c.to_city = e.city;
  return c;
}

function endText(trip: Partial<LiveTrip>, side: "from" | "to"): string {
  const t = trip as Record<string, unknown>;
  return asText(t[`${side}_name`]) || (side === "to" ? asText(trip.to_city) : "") || "-";
}

/** Goods, documents, times, contact (the "More" accordion). */
function readMore(fd: FormData): { ok: true; row: Record<string, unknown> } | { ok: false; error: string } {
  const rawPurpose = str(fd, "purpose", 12);
  const rawParty = str(fd, "party_type", 12);
  const rawConsPhone = str(fd, "consignee_phone", 20);
  const consignee_phone = rawConsPhone ? normaliseIndianMobile(rawConsPhone) : null;
  if (rawConsPhone && !consignee_phone) return { ok: false, error: `Contact mobile: ${PHONE_ERROR}` };
  const ewayRaw = str(fd, "eway_bill_no", 20);
  const eway_bill_no = ewayRaw ? normalizeEway(ewayRaw) : null;
  if (ewayRaw && !eway_bill_no) return { ok: false, error: "E-way bill number must be 12 digits." };
  const nums: Record<string, number | null> = {};
  for (const k of ["quantity", "weight_kg", "invoice_value_inr", "freight_inr"]) {
    const v = numOrNull(fd, k);
    if (v === "bad") return { ok: false, error: `${k.replace(/_inr|_kg/, "").replace("_", " ")} must be a number.` };
    nums[k] = v;
  }
  return {
    ok: true,
    row: {
      purpose: rawPurpose && PURPOSE_SET.has(rawPurpose) ? rawPurpose : null,
      party_type: rawParty && PARTY_SET.has(rawParty) ? rawParty : null,
      party_name: str(fd, "party_name", 120),
      consignee_name: str(fd, "consignee_name", 120),
      consignee_phone,
      transporter: str(fd, "transporter", 120),
      material: str(fd, "material", 160),
      quantity: nums.quantity,
      quantity_unit: str(fd, "quantity_unit", 20),
      weight_kg: nums.weight_kg,
      invoice_no: str(fd, "invoice_no", 40),
      invoice_value_inr: nums.invoice_value_inr,
      eway_bill_no,
      eway_valid_until: fromLocalInput(str(fd, "eway_valid_until", 30)),
      lr_no: str(fd, "lr_no", 40),
      freight_inr: nums.freight_inr,
      planned_dispatch_at: fromLocalInput(str(fd, "planned_dispatch_at", 30)),
      promised_delivery_at: fromLocalInput(str(fd, "promised_delivery_at", 30)),
      notes: str(fd, "notes", 1000),
    },
  };
}

type DriverPick = { kind: "none" } | { kind: "master"; driver: LiveDriver } | { kind: "temp"; name: string; phone: string | null };

async function readDriverPick(fd: FormData, ownerId: string): Promise<{ ok: true; v: DriverPick } | { ok: false; error: string }> {
  const mode = str(fd, "driver_mode", 10);
  if (mode === "custom") {
    const name = str(fd, "tmp_driver_name", 80);
    const rawPhone = str(fd, "tmp_driver_phone", 20);
    if (!name && !rawPhone) return { ok: true, v: { kind: "none" } };
    if (!name) return { ok: false, error: "Driver: enter the name." };
    const phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
    if (rawPhone && !phone) return { ok: false, error: `Driver mobile: ${PHONE_ERROR}` };
    return { ok: true, v: { kind: "temp", name, phone } };
  }
  const id = uuidOrNull(fd, "driver_id");
  if (!id) return { ok: true, v: { kind: "none" } };
  const driver = await ownDriver(ownerId, id);
  if (!driver || driver.archived_at || driver.kind !== "own") return { ok: false, error: "Driver: pick one from your list." };
  return { ok: true, v: { kind: "master", driver } };
}

type TruckPick = { kind: "none" } | { kind: "master"; vehicle: LiveVehicle } | { kind: "temp"; number: string };

async function readTruckPick(fd: FormData, ownerId: string): Promise<{ ok: true; v: TruckPick } | { ok: false; error: string }> {
  const mode = str(fd, "truck_mode", 10);
  if (mode === "none") return { ok: true, v: { kind: "none" } };
  if (mode === "custom") {
    const n = normalizeVehicleNo(str(fd, "tmp_truck_no", 20));
    if (!n) return { ok: true, v: { kind: "none" } };
    if (!/^[A-Z0-9]{4,12}$/.test(n)) return { ok: false, error: "Truck number looks wrong, e.g. GJ36X1234." };
    return { ok: true, v: { kind: "temp", number: n } };
  }
  const id = uuidOrNull(fd, "vehicle_id");
  if (!id) return { ok: true, v: { kind: "none" } };
  const vehicle = await ownVehicle(ownerId, id);
  if (!vehicle || vehicle.archived_at) return { ok: false, error: "Truck: pick one from your list." };
  return { ok: true, v: { kind: "master", vehicle } };
}

async function createTempDriver(ownerId: string, name: string, phone: string | null, company: string | null): Promise<LiveDriver | { error: string }> {
  const { data, error } = await getSupabaseAdmin()
    .from("live_drivers")
    .insert({ owner_id: ownerId, name, phone, kind: "one_time", company, share_token: newToken(), share_status: "invited" })
    .select("*")
    .maybeSingle<LiveDriver>();
  if (error || !data) {
    logLive("temp driver", error);
    if ((error as { code?: string } | null)?.code === "23505") {
      return { error: "This mobile is already used by another driver. Apply database update 0083, or pick him from Masters." };
    }
    return { error: "Could not save the driver." };
  }
  return data;
}

const FIELD_LABEL: Record<string, string> = {
  purpose: "Purpose",
  party_type: "Party type",
  party_name: "Supplier / party",
  from: "From",
  to: "Destination",
  truck: "Truck",
  driver: "Driver",
  material: "Material",
  quantity: "Quantity",
  quantity_unit: "Unit",
  weight_kg: "Weight",
  invoice_no: "Invoice",
  invoice_value_inr: "Invoice value",
  lr_no: "LR",
  transporter: "Transporter",
  freight_inr: "Freight",
  planned_dispatch_at: "Planned start",
  promised_delivery_at: "Expected arrival",
  eway_bill_no: "E-way bill",
  eway_valid_until: "E-way validity",
  consignee_name: "Contact",
  consignee_phone: "Contact mobile",
  notes: "Notes",
};

const asText = (v: unknown): string => (v == null ? "" : String(v));

/**
 * Create (no trip yet) or edit. Rules (docs/LIVE-PLAN-v4.md §4):
 *   Planned  - everything, no reason needed.
 *   Active   - driver, truck, destination WITH a reason; arrival, e-way bill,
 *              contact and notes freely. Nothing else.
 *   Done / Cancelled - nothing (reopen first).
 */
async function saveTripForm(a: Actor, fd: FormData, trip: LiveTrip | null): Promise<ActionResult> {
  const admin = getSupabaseAdmin();
  const has82 = await liveSchema82();
  const direction: TripDirection = trip ? tripDirection(trip) : str(fd, "direction", 10) === "incoming" ? "incoming" : "outgoing";
  if (!trip && direction === "incoming" && !has82) return { ok: false, error: "Receiving trips need database update 0082." };
  const state = trip ? tripState(trip) : "planned";
  if (state === "done" || state === "cancelled") return { ok: false, error: "A closed trip cannot be edited. Reopen it first." };
  const active = state === "active";
  const can = (f: string) => !active || (TRIP_FIELDS_DYNAMIC as readonly string[]).includes(f) || f === "truck";

  const name = trip ? trip.trip_name : str(fd, "trip_name", 80);
  if (!name) return { ok: false, error: "Give the trip a name, e.g. Rajkot order 448." };

  const dp = await readDriverPick(fd, a.ownerId);
  if (!dp.ok) return dp;
  const tp = await readTruckPick(fd, a.ownerId);
  if (!tp.ok) return tp;
  const from = active ? null : await readEnd(fd, a.ownerId, "from");
  if (from && !from.ok) return from;
  const to = await readEnd(fd, a.ownerId, "to");
  if (!to.ok) return to;
  const more = readMore(fd);
  if (!more.ok) return more;
  const reason = str(fd, "reason", 300);

  const patch: Record<string, unknown> = {};
  const changed: { field: string; old: string; new: string }[] = [];
  const before = (trip ?? {}) as Record<string, unknown>;

  // From / To
  if (from?.ok) {
    const cols = endColumns("from", from.v);
    if (Object.entries(cols).some(([k, v]) => asText(before[k]) !== asText(v))) {
      Object.assign(patch, cols);
      if (trip) changed.push({ field: "from", old: endText(trip, "from"), new: from.v.name ?? "-" });
    }
  }
  {
    const cols = endColumns("to", to.v);
    if (Object.entries(cols).some(([k, v]) => asText(before[k]) !== asText(v))) {
      Object.assign(patch, cols);
      if (trip) changed.push({ field: "to", old: endText(trip, "to"), new: to.v.name ?? "-" });
    }
  }

  // More
  for (const [col, val] of Object.entries(more.row)) {
    if (!can(col)) continue;
    if (asText(before[col]) === asText(val)) continue;
    patch[col] = val;
    if (trip) changed.push({ field: col, old: asText(before[col]), new: asText(val) });
  }

  // Truck
  const wantVehId = tp.v.kind === "master" ? tp.v.vehicle.id : null;
  const wantVehNo = tp.v.kind === "master" ? tp.v.vehicle.number : tp.v.kind === "temp" ? tp.v.number : null;
  if ((trip?.vehicle_id ?? null) !== wantVehId || (trip?.vehicle_no ?? null) !== wantVehNo) {
    Object.assign(patch, { vehicle_id: wantVehId, vehicle_no: wantVehNo, temp_truck: tp.v.kind === "temp" });
    if (trip) changed.push({ field: "truck", old: prettyVehicle(trip.vehicle_no) || "-", new: prettyVehicle(wantVehNo) || "-" });
    if (active && wantVehNo) {
      const busy = wantVehId ? await activeTripOf(a.ownerId, "vehicle_id", wantVehId, trip?.id) : await activeTripOf(a.ownerId, "vehicle_no", wantVehNo, trip?.id);
      if (busy) return { ok: false, error: `${prettyVehicle(wantVehNo)} is on ${tripNo(busy.trip_seq)}, which is Active.` };
    }
  }

  // Driver - validate everything first; nothing is written until all checks pass.
  let newDriver: LiveDriver | null = null;
  let driverCleared = false;
  let tempToMake: { name: string; phone: string | null } | null = null;
  let renameTemp: string | null = null;
  const oldDriverId = trip?.driver_id ?? null;
  if (dp.v.kind === "master") {
    if (dp.v.driver.id !== oldDriverId) {
      newDriver = dp.v.driver;
      if (trip) changed.push({ field: "driver", old: trip.driver_name ?? "-", new: newDriver.name });
    }
  } else if (dp.v.kind === "temp") {
    const sameTemp = trip?.inline_driver && oldDriverId && (trip.driver_phone ?? null) === dp.v.phone;
    if (sameTemp) {
      if (dp.v.name !== trip!.driver_name) {
        renameTemp = dp.v.name;
        changed.push({ field: "driver", old: trip!.driver_name ?? "-", new: dp.v.name });
      }
    } else {
      tempToMake = { name: dp.v.name, phone: dp.v.phone };
      if (trip) changed.push({ field: "driver", old: trip.driver_name ?? "-", new: `${dp.v.name} (temporary)` });
    }
  } else if (oldDriverId || trip?.driver_name) {
    driverCleared = true;
    changed.push({ field: "driver", old: trip?.driver_name ?? "-", new: "-" });
  }
  if (active && driverCleared) return { ok: false, error: "An Active trip needs a driver. Pick the new driver instead." };
  if (active && newDriver) {
    const busy = await activeTripOf(a.ownerId, "driver_id", newDriver.id, trip?.id);
    if (busy) return { ok: false, error: `${newDriver.name} is on ${tripNo(busy.trip_seq)}, which is Active.` };
  }

  // Active: driver / truck / destination need a reason.
  const needsReason = active && changed.some((c) => (REASON_FIELDS as readonly string[]).includes(c.field));
  if (needsReason && !reason) return { ok: false, error: "This trip is Active. Write the reason for changing the driver, truck or destination." };

  if (renameTemp && oldDriverId) {
    await admin.from("live_drivers").update({ name: renameTemp }).eq("id", oldDriverId).eq("kind", "one_time");
    patch.driver_name = renameTemp;
  }
  if (tempToMake) {
    const made = await createTempDriver(a.ownerId, tempToMake.name, tempToMake.phone, direction === "incoming" ? (more.row.party_name as string | null) : null);
    if ("error" in made) return { ok: false, error: made.error };
    newDriver = made;
  }
  if (newDriver) {
    Object.assign(patch, {
      driver_id: newDriver.id,
      driver_name: newDriver.name,
      driver_phone: newDriver.phone,
      inline_driver: newDriver.kind === "one_time",
      share_status: newDriver.share_status === "active" ? "active" : "invited",
      share_last_seen_at: newDriver.share_last_seen_at,
      share_consent_at: newDriver.share_consent_at,
    });
  } else if (driverCleared) {
    Object.assign(patch, { driver_id: null, driver_name: null, driver_phone: null, inline_driver: false, share_status: "invited" });
  }

  // Save
  let saved: LiveTrip | null = trip;
  if (!trip) {
    const row = await strip83(
      await strip82({
        owner_id: a.ownerId,
        trip_name: name,
        status: "planned",
        driver_token: null,
        share_status: patch.share_status ?? "invited",
        direction,
        ...patch,
        purpose: patch.purpose ?? (direction === "incoming" ? "pickup" : "dispatch"),
        party_type: patch.party_type ?? (direction === "incoming" ? "supplier" : "customer"),
      }),
    );
    const { data, error } = await admin.from("live_trips").insert(row).select("*").maybeSingle<LiveTrip>();
    if (error || !data) {
      if (newDriver?.kind === "one_time") await admin.from("live_drivers").delete().eq("id", newDriver.id).eq("kind", "one_time");
      return dbError(error, "create trip");
    }
    saved = data;
    await recordEvent(saved, {
      kind: "status",
      title: direction === "incoming" ? "Trip created - Planned (we are receiving)" : "Trip created - Planned (we are sending)",
      actor: "owner",
      actorUserId: a.userId,
    });
    if (newDriver) {
      await recordEvent(saved, { kind: "assign", title: `Driver ${newDriver.name}${newDriver.kind === "one_time" ? " (temporary)" : ""}`, field: "driver", newValue: newDriver.name, actor: "owner", actorUserId: a.userId });
    }
    if (wantVehNo) {
      await recordEvent(saved, { kind: "assign", title: `Truck ${prettyVehicle(wantVehNo)}${tp.v.kind === "temp" ? " (temporary)" : ""}`, field: "truck", newValue: wantVehNo, actor: "owner", actorUserId: a.userId });
    }
  } else if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const { error } = await admin.from("live_trips").update(await strip83(await strip82(patch))).eq("id", trip.id).eq("owner_id", a.ownerId);
    if (error) {
      if (tempToMake && newDriver) await admin.from("live_drivers").delete().eq("id", newDriver.id).eq("kind", "one_time");
      if ((error as { code?: string }).code === "23505") return { ok: false, error: "That driver is already on an Active trip." };
      return dbError(error, "update trip");
    }
    for (const c of changed) {
      const assign = c.field === "driver" || c.field === "truck";
      await recordEvent(
        { ...trip, driver_id: newDriver?.id ?? (driverCleared ? null : trip.driver_id), vehicle_id: wantVehId },
        {
          kind: assign ? "assign" : "edit",
          title: `${FIELD_LABEL[c.field] ?? c.field} changed${active ? " during the trip" : ""}`,
          detail: `${c.old || "-"} → ${c.new || "-"}${active && reason && (REASON_FIELDS as readonly string[]).includes(c.field) ? ` · Reason: ${reason}` : ""}`,
          field: c.field,
          oldValue: c.old,
          newValue: c.new,
          reason: (REASON_FIELDS as readonly string[]).includes(c.field) ? reason : null,
          actor: "owner",
          actorUserId: a.userId,
          // v5: "Driver changed" alert (in-app; you made it, so no push).
          ...(active && c.field === "driver" ? { notify: true, alert: "driver_changed" as const, push: false } : {}),
        },
      );
    }
    // The old driver's sharing for this trip stops: a temporary one at once, a master one simply no longer reports here.
    if ((newDriver || driverCleared) && oldDriverId && trip.inline_driver) await retireTempDriver(oldDriverId);
  }
  if (newDriver?.kind === "own") await reactivateSharing(newDriver, a.userId, saved);

  revalidatePath("/live", "layout");
  redirect(`/live/trips/${saved!.id}${!trip ? "?created=1" : newDriver ? "?sent=1" : ""}`);
}

export async function createTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  return saveTripForm(a, fd, null);
}

export async function updateTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  return saveTripForm(a, fd, trip);
}

/* -------------------------------------------------------------------------- */
/* trip state, notes, links, archive, delete                                  */
/* -------------------------------------------------------------------------- */

/** Planned / Active / Done / Cancelled, any direction, always logged. */
export async function setTripState(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  const to = str(fd, "state", 12) as TripState;
  if (!TRIP_STATES.includes(to)) return { ok: false, error: "Unknown status." };
  if (tripState(trip) === to) return { ok: true, message: `Already ${STATE_LABEL[to].toLowerCase()}.` };
  if (to === "active") {
    if (!trip.driver_id) return { ok: false, error: "Add a driver first - tracking follows his phone." };
    const busy = await activeTripOf(a.ownerId, "driver_id", trip.driver_id, trip.id);
    if (busy) return { ok: false, error: `${trip.driver_name ?? "The driver"} is on ${tripNo(busy.trip_seq)}, which is Active. Finish that first.` };
    if (trip.vehicle_no) {
      const t2 = trip.vehicle_id ? await activeTripOf(a.ownerId, "vehicle_id", trip.vehicle_id, trip.id) : await activeTripOf(a.ownerId, "vehicle_no", trip.vehicle_no, trip.id);
      if (t2) return { ok: false, error: `${prettyVehicle(trip.vehicle_no)} is on ${tripNo(t2.trip_seq)}, which is Active.` };
    }
  }
  const note = str(fd, "note", 500);
  const ok = await changeStatus(trip, statusForState(to, trip), "owner", note ? `You: ${note}` : null);
  if (!ok) {
    // v5: say what actually happened instead of a generic "changed meanwhile".
    const now = await ownTrip(a.ownerId, trip.id);
    if (now && tripState(now) === to) {
      revalidatePath("/live", "layout");
      return { ok: true, message: `Trip is ${STATE_LABEL[to].toLowerCase()}.` };
    }
    if (now && now.status !== trip.status) return { ok: false, error: `The trip is now ${STATE_LABEL[tripState(now)]} (changed by the driver or automatically). Check and try again.` };
    return { ok: false, error: "Could not save the status. Please try again." };
  }
  if (to === "done" && note) await getSupabaseAdmin().from("live_trips").update({ pod_note: note }).eq("id", trip.id);
  revalidatePath("/live", "layout");
  return { ok: true, message: `Trip is ${STATE_LABEL[to].toLowerCase()}.` };
}

/** v5: the actual start time (started_at), corrected by the owner with a reason. */
export async function setActualStart(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  if (tripState(trip) === "planned") return { ok: false, error: "The trip has not started yet. Start it first." };
  const at = fromLocalInput(str(fd, "started_at", 30));
  if (!at) return { ok: false, error: "Enter the actual start date and time." };
  if (Date.parse(at) > Date.now() + 5 * 60_000) return { ok: false, error: "Actual start cannot be in the future." };
  const reason = str(fd, "reason", 300);
  if (!reason) return { ok: false, error: "Write the reason for changing the actual start." };
  const { error } = await getSupabaseAdmin().from("live_trips").update({ started_at: at, updated_at: new Date().toISOString() }).eq("id", trip.id).eq("owner_id", a.ownerId);
  if (error) return dbError(error, "actual start");
  await recordEvent(trip, {
    kind: "edit",
    title: "Actual start changed",
    detail: `${fmtIst(trip.started_at)} → ${fmtIst(at)} · Reason: ${reason}`,
    field: "started_at",
    oldValue: trip.started_at,
    newValue: at,
    reason,
    actor: "owner",
    actorUserId: a.userId,
  });
  revalidatePath(`/live/trips/${trip.id}`);
  return { ok: true, message: "Actual start saved." };
}

/** v5 (0084): this trip's alert switches (defaults come from Live profile > Alerts). */
export async function saveTripAlerts(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  if (!(await liveSchema84())) return { ok: false, error: "Trip alerts need database update 0084." };
  const prof = await getSupabaseAdmin().from("live_profiles").select("alert_settings").eq("owner_id", a.ownerId).maybeSingle<{ alert_settings: AlertSettings | null }>();
  const defs = alertDefaults(prof.data?.alert_settings);
  const off: AlertKey[] = [];
  const on: AlertKey[] = [];
  for (const k of ALERT_KEYS) {
    const want = fd.get(`a_${k}`) === "on";
    if (want !== defs[k].on) (want ? on : off).push(k);
  }
  const lateRaw = Number(str(fd, "late_min", 4) ?? 0);
  const late_min = Number.isInteger(lateRaw) && lateRaw >= 5 && lateRaw <= 1440 && lateRaw !== defs.late.min ? lateRaw : undefined;
  const overrides: TripAlertOverrides = { ...(off.length ? { off } : {}), ...(on.length ? { on } : {}), ...(late_min ? { late_min } : {}) };
  const { error } = await getSupabaseAdmin().from("live_trips").update({ alert_overrides: overrides }).eq("id", trip.id).eq("owner_id", a.ownerId);
  if (error) return dbError(error, "trip alerts");
  await recordEvent(trip, { kind: "edit", title: "Trip alerts changed", detail: [off.length ? `Off: ${off.map((k) => ALERT_META[k].label).join(", ")}` : null, on.length ? `On: ${on.map((k) => ALERT_META[k].label).join(", ")}` : null, late_min ? `Late after ${late_min} min` : null].filter(Boolean).join(" · ") || "Back to defaults", actor: "owner", actorUserId: a.userId });
  revalidatePath(`/live/trips/${trip.id}`);
  return { ok: true, message: "Trip alerts saved." };
}

/** v5 (0084): default alerts for every trip. */
export async function saveAlertSettings(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  if (!(await liveSchema84())) return { ok: false, error: "Alert settings need database update 0084." };
  const settings: AlertSettings = {};
  for (const k of ALERT_KEYS) {
    const meta = ALERT_META[k];
    const s: { on: boolean; min?: number } = { on: fd.get(`a_${k}`) === "on" };
    if (meta.min) {
      const n = Number(str(fd, `m_${k}`, 4) ?? meta.min.def);
      if (Number.isInteger(n) && n > 0 && n <= (meta.min.unit === "h" ? 48 : 1440)) s.min = n;
    }
    settings[k] = s;
  }
  const { error } = await getSupabaseAdmin()
    .from("live_profiles")
    .upsert({ owner_id: a.ownerId, alert_settings: settings, updated_at: new Date().toISOString() }, { onConflict: "owner_id" });
  if (error) return dbError(error, "alert settings");
  revalidatePath("/live", "layout");
  return { ok: true, message: "Alerts saved. They apply to every trip." };
}

export async function addTripNote(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  const note = str(fd, "note", 500);
  if (!note) return { ok: false, error: "Type a note first." };
  await recordEvent(trip, { kind: "note", title: note.slice(0, 200), detail: note.length > 200 ? note : null, actor: "owner", actorUserId: a.userId });
  revalidatePath(`/live/trips/${trip.id}`);
  return { ok: true, message: "Note added." };
}

export async function setCustomerLink(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  const on = fd.get("on") === "1";
  const { error } = await getSupabaseAdmin().from("live_trips").update({ track_token: on ? newToken() : null }).eq("id", trip.id);
  if (error) return dbError(error, "customer link");
  await recordEvent(trip, { kind: "share", title: on ? "Customer tracking link made" : "Customer tracking link switched off", actor: "owner", actorUserId: a.userId });
  revalidatePath(`/live/trips/${trip.id}`);
  return { ok: true, message: on ? "Customer link ready." : "Customer link off." };
}

/** Hide a trip from the lists (or bring it back). Not while Active. */
export async function archiveTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  if (!(await liveSchema83())) return { ok: false, error: "Archiving needs database update 0083." };
  const on = fd.get("on") !== "0";
  if (on && tripState(trip) === "active") return { ok: false, error: "Finish or cancel the trip before archiving it." };
  const { error } = await getSupabaseAdmin().from("live_trips").update({ archived_at: on ? new Date().toISOString() : null }).eq("id", trip.id);
  if (error) return dbError(error, "archive trip");
  await recordEvent(trip, { kind: "note", title: on ? "Trip archived" : "Trip restored from archive", actor: "owner", actorUserId: a.userId });
  revalidatePath("/live", "layout");
  return { ok: true, message: on ? "Trip archived. It no longer shows in lists." : "Trip restored." };
}

/** Delete for good (with its activity and positions). Not while Active. */
export async function deleteTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  if (tripState(trip) === "active") return { ok: false, error: "This trip is Active. Mark it done or cancelled first." };
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("live_trips").delete().eq("id", trip.id).eq("owner_id", a.ownerId);
  if (error) return dbError(error, "delete trip");
  if (trip.driver_id && trip.inline_driver) {
    const { data: other } = await admin.from("live_trips").select("id").eq("driver_id", trip.driver_id).limit(1);
    if (!other?.length) await admin.from("live_drivers").delete().eq("id", trip.driver_id).eq("kind", "one_time");
  }
  revalidatePath("/live", "layout");
  redirect("/live/trips");
}

/* -------------------------------------------------------------------------- */
/* Live profile                                                                */
/* -------------------------------------------------------------------------- */

const BUSINESS_TYPES: BusinessType[] = ["manufacturer", "trader", "distributor", "transporter", "other"];

export async function saveLiveProfile(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const gstin = str(fd, "gstin", 15)?.toUpperCase() ?? null;
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) return { ok: false, error: "GSTIN must be 15 characters, e.g. 24ABCDE1234F1Z5." };
  const rawPhone = str(fd, "contact_phone", 20);
  const contact_phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
  if (rawPhone && !contact_phone) return { ok: false, error: PHONE_ERROR };
  const bt = str(fd, "business_type", 20) as BusinessType | null;
  const hours = Number(str(fd, "one_time_expire_hours", 3) ?? 1);
  if (!Number.isInteger(hours) || hours < 1 || hours > 72) return { ok: false, error: "Auto-stop must be 1 to 72 hours." };
  const placeId = uuidOrNull(fd, "default_place_id");
  if (placeId) {
    const { data } = await getSupabaseAdmin().from("live_places").select("id").eq("id", placeId).eq("owner_id", a.ownerId).maybeSingle();
    if (!data) return { ok: false, error: "That warehouse is not in your list." };
  }
  const row: Record<string, unknown> = {
    owner_id: a.ownerId,
    business_name: str(fd, "business_name", 120),
    gstin,
    contact_name: str(fd, "contact_name", 80),
    contact_phone,
    business_type: bt && BUSINESS_TYPES.includes(bt) ? bt : null,
    default_place_id: placeId,
    one_time_expire_hours: hours,
    updated_at: new Date().toISOString(),
  };
  // Older switches: written only when the form carries them (v5 moved alerts to their own page).
  if (fd.has("notify_present")) {
    row.notify_status = fd.get("notify_status") === "on";
    row.notify_alerts = fd.get("notify_alerts") === "on";
  }
  if (fd.has("track_present") && (await liveSchema84())) {
    row.track_show_driver = fd.get("track_show_driver") === "on";
    row.track_call_driver = fd.get("track_call_driver") === "on";
  }
  const { error } = await getSupabaseAdmin().from("live_profiles").upsert(row, { onConflict: "owner_id" });
  if (error) return dbError(error, "live profile");
  revalidatePath("/live", "layout");
  return { ok: true, message: "Saved." };
}
