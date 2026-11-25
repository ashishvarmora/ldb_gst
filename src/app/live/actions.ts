"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { extractDispatch, type DispatchExtract } from "@/lib/live-ai";
import { afterTripClosed, changeStatus, recordDriverEvent, recordEvent } from "@/lib/live/automation";
import { isMissingRelation, liveSchema82, logLive, newToken, safeReturn, withParam } from "@/lib/live/server";
import {
  NEXT_STATUSES,
  PLACE_KINDS,
  PURPOSES,
  STATUS_LABEL,
  TRIP_STATUSES,
  destinationText,
  fromLocalInput,
  normalizeEway,
  normalizeVehicleNo,
  parseLatLng,
  prettyVehicle,
  tripFieldEditable,
  tripNo,
  tripPhase,
  type BusinessType,
  type DriverKind,
  type LiveAssignment,
  type LiveDriver,
  type LiveTrip,
  type LiveVehicle,
  type PlaceKind,
  type PartyType,
  type TripDirection,
  type TripStatus,
  type VehicleOwnerType,
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

/* Trips-first (0082): createTrip() (name + direction) then updateTrip() (setup); trips no longer
   have their own driver link (the driver's link is used). */

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
  const kind = (str(fd, "kind", 20) ?? "customer") as PlaceKind;
  if (!PLACE_KINDS.includes(kind)) return { ok: false, error: "Pick a type." };

  const rawPhone = str(fd, "contact_phone", 20);
  const phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
  if (rawPhone && !phone) return { ok: false, error: PHONE_ERROR };

  const loc = parseLatLng(str(fd, "location", 500));
  if (str(fd, "location", 500) && !loc) {
    return { ok: false, error: "Location not understood. Paste 'lat, lng' or a full Google Maps link (not a short maps.app link)." };
  }
  const radius = Number(str(fd, "radius_m", 6) ?? 500);
  if (!Number.isFinite(radius) || radius < 50 || radius > 20000) return { ok: false, error: "Geofence radius must be 50 to 20,000 m." };
  const pincode = str(fd, "pincode", 6);
  if (pincode && !/^[1-9][0-9]{5}$/.test(pincode)) return { ok: false, error: "Pincode must be 6 digits." };
  const gstin = str(fd, "gstin", 15)?.toUpperCase() ?? null;
  if (gstin && gstin.length !== 15) return { ok: false, error: "GSTIN must be 15 characters." };

  const row = {
    owner_id: a.ownerId,
    kind,
    name,
    contact_name: str(fd, "contact_name", 80),
    contact_phone: phone,
    address: str(fd, "address", 300),
    city: str(fd, "city", 80),
    state: str(fd, "state", 60),
    pincode,
    gstin,
    lat: loc?.lat ?? null,
    lng: loc?.lng ?? null,
    radius_m: Math.round(radius),
    notes: str(fd, "notes", 500),
    updated_at: new Date().toISOString(),
  };
  const admin = getSupabaseAdmin();
  const res = id
    ? await admin.from("live_places").update(row).eq("id", id).eq("owner_id", a.ownerId).select("id").maybeSingle<{ id: string }>()
    : await admin.from("live_places").insert(row).select("id").maybeSingle<{ id: string }>();
  if (res.error) return dbError(res.error, "place");
  revalidatePath("/live", "layout");
  const back = safeReturn(str(fd, "return", 200));
  if (back && res.data?.id) redirect(withParam(back, "picked_place", res.data.id));
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
  return { ok: true, message: "Place removed. Old trips keep their history." };
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
/* 0081 helpers                                                                */
/* -------------------------------------------------------------------------- */

const OPEN = ["planned", "loading", "in_transit", "arrived"];

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

async function openTripOf(ownerId: string, driverId: string, exceptTripId?: string): Promise<LiveTrip | null> {
  let q = getSupabaseAdmin().from("live_trips").select("*").eq("owner_id", ownerId).eq("driver_id", driverId).in("status", OPEN);
  if (exceptTripId) q = q.neq("id", exceptTripId);
  const { data } = await q.limit(1).maybeSingle<LiveTrip>();
  return data ?? null;
}

const OWNER_TYPES: VehicleOwnerType[] = ["own", "dealer", "supplier", "transporter"];

function vehicleRowFrom(fd: FormData, prefix = ""): { ok: true; number: string; row: Record<string, unknown> } | { ok: false; error: string } {
  const number = normalizeVehicleNo(str(fd, `${prefix}number`, 20));
  if (!/^[A-Z0-9]{4,12}$/.test(number)) return { ok: false, error: "Enter the truck number, e.g. GJ36X1234." };
  const ot = str(fd, `${prefix}owner_type`, 12) as VehicleOwnerType | null;
  const owner_type = ot && OWNER_TYPES.includes(ot) ? ot : null;
  const cap = numOrNull(fd, `${prefix}capacity_kg`);
  if (cap === "bad") return { ok: false, error: "Capacity must be a number (kg)." };
  const row: Record<string, unknown> = {
    number,
    owner_type,
    ownership: owner_type === "own" ? "own" : "market",
    vehicle_type: str(fd, `${prefix}vehicle_type`, 40),
  };
  const transporter = str(fd, `${prefix}transporter`, 120);
  if (transporter !== null || fd.has(`${prefix}transporter`)) row.transporter = transporter;
  if (cap !== null || fd.has(`${prefix}capacity_kg`)) row.capacity_kg = cap != null ? Math.round(cap) : null;
  return { ok: true, number, row };
}

/** Find-or-create a truck by number (restores an archived one). */
async function upsertVehicleRow(ownerId: string, number: string, row: Record<string, unknown>): Promise<LiveVehicle | null> {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin.from("live_vehicles").select("*").eq("owner_id", ownerId).eq("number", number).maybeSingle<LiveVehicle>();
  if (existing) {
    const patch: Record<string, unknown> = { archived_at: null, updated_at: new Date().toISOString() };
    for (const [k, v] of Object.entries(row)) if (v != null) patch[k] = v;
    const { data } = await admin.from("live_vehicles").update(patch).eq("id", existing.id).select("*").maybeSingle<LiveVehicle>();
    return data ?? existing;
  }
  const { data, error } = await admin
    .from("live_vehicles")
    .insert({ owner_id: ownerId, ...row })
    .select("*")
    .maybeSingle<LiveVehicle>();
  if (error) logLive("vehicle insert", error);
  return data ?? null;
}

/**
 * One driver <-> one truck. Moving a truck that is with another driver needs
 * force (the form's "Move it to this driver" tick); without it the owner gets
 * a clear warning naming who has it. Every change is logged on both drivers
 * and, when the driver is on a trip, on the trip (truck changed mid-trip).
 */
async function setAssignment(
  ownerId: string,
  driver: LiveDriver,
  vehicle: LiveVehicle | null,
  opts: { force: boolean; userId: string },
): Promise<ActionResult> {
  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  const { data: mine } = await admin
    .from("live_assignments")
    .select("*")
    .eq("driver_id", driver.id)
    .is("ended_at", null)
    .maybeSingle<LiveAssignment>();
  if (vehicle && mine?.vehicle_id === vehicle.id) return { ok: true };

  let otherDriver: LiveDriver | null = null;
  if (vehicle) {
    const { data: theirs } = await admin
      .from("live_assignments")
      .select("*")
      .eq("vehicle_id", vehicle.id)
      .is("ended_at", null)
      .maybeSingle<LiveAssignment>();
    if (theirs && theirs.driver_id !== driver.id) {
      otherDriver = await ownDriver(ownerId, theirs.driver_id);
      if (!opts.force) {
        return {
          ok: false,
          error: `${prettyVehicle(vehicle.number)} is with ${otherDriver?.name ?? "another driver"} right now. Tick "Move this truck to ${driver.name}" to reassign it.`,
        };
      }
      await admin.from("live_assignments").update({ ended_at: nowIso, ended_reason: `moved to ${driver.name}`.slice(0, 80) }).eq("id", theirs.id);
      if (otherDriver) {
        await recordDriverEvent(otherDriver, {
          kind: "assign",
          title: `Truck ${prettyVehicle(vehicle.number)} moved to ${driver.name}`,
          actor: "owner",
          field: "truck",
          oldValue: vehicle.number,
          newValue: null,
          vehicleId: vehicle.id,
          actorUserId: opts.userId,
        });
      }
    }
  }

  let oldNumber: string | null = null;
  if (mine) {
    const old = await ownVehicle(ownerId, mine.vehicle_id);
    oldNumber = old?.number ?? null;
    await admin.from("live_assignments").update({ ended_at: nowIso, ended_reason: vehicle ? "truck changed" : "truck removed" }).eq("id", mine.id);
  }

  const trip = await openTripOf(ownerId, driver.id);
  if (vehicle) {
    const { error } = await admin
      .from("live_assignments")
      .insert({ owner_id: ownerId, driver_id: driver.id, vehicle_id: vehicle.id, trip_id: trip?.id ?? null, actor: "owner" });
    if (error) return dbError(error, "assign");
  }
  if (trip) {
    await admin
      .from("live_trips")
      .update({ vehicle_id: vehicle?.id ?? null, vehicle_no: vehicle?.number ?? null, updated_at: nowIso })
      .eq("id", trip.id);
  }
  await recordDriverEvent(
    driver,
    {
      kind: "assign",
      title: vehicle
        ? oldNumber
          ? `Truck changed ${prettyVehicle(oldNumber)} → ${prettyVehicle(vehicle.number)}`
          : `Truck ${prettyVehicle(vehicle.number)} assigned`
        : `Truck ${prettyVehicle(oldNumber)} removed`,
      actor: "owner",
      field: "truck",
      oldValue: oldNumber,
      newValue: vehicle?.number ?? null,
      vehicleId: vehicle?.id ?? null,
      actorUserId: opts.userId,
    },
    trip ? { ...trip, vehicle_id: vehicle?.id ?? null, vehicle_no: vehicle?.number ?? null } : null,
  );
  return { ok: true };
}

/** Sharing comes back on for a driver the owner is tracking again. */
async function reactivateSharing(driver: LiveDriver, userId: string, trip: LiveTrip | null) {
  const off = driver.share_status === "revoked" || driver.share_status === "expired" || Boolean(driver.share_expires_at);
  if (!off && driver.share_token) return;
  const patch: Record<string, unknown> = { share_expires_at: null, updated_at: new Date().toISOString() };
  if (!driver.share_token) patch.share_token = newToken();
  if (driver.share_status === "revoked" || driver.share_status === "expired") patch.share_status = "invited";
  await getSupabaseAdmin().from("live_drivers").update(patch).eq("id", driver.id);
  if (driver.share_status === "revoked" || driver.share_status === "expired") {
    await recordDriverEvent(driver, { kind: "share", title: "Sharing link switched back on (same link)", actor: "owner", actorUserId: userId }, trip);
  }
}

/* -------------------------------------------------------------------------- */
/* trucks (master)                                                             */
/* -------------------------------------------------------------------------- */

export async function saveVehicle(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  const v = vehicleRowFrom(fd);
  if (!v.ok) return v;
  const admin = getSupabaseAdmin();
  const row = { ...v.row, notes: str(fd, "notes", 300), updated_at: new Date().toISOString() };
  if (id) {
    const { error } = await admin.from("live_vehicles").update(row).eq("id", id).eq("owner_id", a.ownerId);
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, error: "That truck number is already in your list." };
      return dbError(error, "vehicle");
    }
  } else {
    const saved = await upsertVehicleRow(a.ownerId, v.number, row);
    if (!saved) return { ok: false, error: "Could not save. Please try again." };
    revalidatePath("/live", "layout");
    const back = safeReturn(str(fd, "return", 200));
    if (back) redirect(withParam(back, "picked_vehicle", saved.id));
  }
  revalidatePath("/live", "layout");
  return { ok: true, message: id ? "Truck updated." : "Truck saved." };
}

/** Soft delete: history stays; the truck is released from its driver. */
export async function archiveVehicle(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const vehicle = await ownVehicle(a.ownerId, uuidOrNull(fd, "id"));
  if (!vehicle) return { ok: false, error: "Truck not found." };
  const admin = getSupabaseAdmin();
  const { data: onTrip } = await admin
    .from("live_trips")
    .select("trip_seq")
    .eq("owner_id", a.ownerId)
    .eq("vehicle_id", vehicle.id)
    .in("status", OPEN)
    .limit(1)
    .maybeSingle<{ trip_seq: number }>();
  if (onTrip) return { ok: false, error: `This truck is on ${tripNo(onTrip.trip_seq)}. Close that trip or change its truck first.` };
  const { data: asg } = await admin.from("live_assignments").select("*").eq("vehicle_id", vehicle.id).is("ended_at", null).maybeSingle<LiveAssignment>();
  if (asg) {
    await admin.from("live_assignments").update({ ended_at: new Date().toISOString(), ended_reason: "truck archived" }).eq("id", asg.id);
    const d = await ownDriver(a.ownerId, asg.driver_id);
    if (d) {
      await recordDriverEvent(d, {
        kind: "assign",
        title: `Truck ${prettyVehicle(vehicle.number)} removed (archived)`,
        actor: "owner",
        field: "truck",
        oldValue: vehicle.number,
        vehicleId: vehicle.id,
        actorUserId: a.userId,
      });
    }
  }
  const { error } = await admin.from("live_vehicles").update({ archived_at: new Date().toISOString() }).eq("id", vehicle.id);
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

/* -------------------------------------------------------------------------- */
/* drivers (master + sharing)                                                  */
/* -------------------------------------------------------------------------- */

type DriverInput = { name: string; phone: string | null; kind: DriverKind; company: string | null };

function driverInput(fd: FormData, prefix = ""): { ok: true; v: DriverInput } | { ok: false; error: string } {
  const name = str(fd, `${prefix}name`, 80);
  if (!name) return { ok: false, error: "Enter the driver's name." };
  const rawPhone = str(fd, `${prefix}phone`, 20);
  const phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
  if (rawPhone && !phone) return { ok: false, error: `Driver mobile: ${PHONE_ERROR}` };
  const kind: DriverKind = str(fd, `${prefix}kind`, 10) === "one_time" ? "one_time" : "own";
  return { ok: true, v: { name, phone, kind, company: kind === "one_time" ? str(fd, `${prefix}company`, 120) : null } };
}

/**
 * New driver, or the existing one with the same mobile (duplicate mobiles are
 * not allowed per account; an archived one is restored). Returns which.
 */
async function findOrCreateDriver(ownerId: string, v: DriverInput): Promise<{ driver: LiveDriver; reused: boolean } | { error: string }> {
  const admin = getSupabaseAdmin();
  if (v.phone) {
    const { data: same } = await admin.from("live_drivers").select("*").eq("owner_id", ownerId).eq("phone", v.phone).maybeSingle<LiveDriver>();
    if (same) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (same.archived_at) {
        patch.archived_at = null;
        patch.name = v.name;
        patch.kind = v.kind;
        patch.company = v.company;
      }
      await admin.from("live_drivers").update(patch).eq("id", same.id);
      return { driver: { ...same, ...(patch as Partial<LiveDriver>) }, reused: true };
    }
  }
  const { data, error } = await admin
    .from("live_drivers")
    .insert({ owner_id: ownerId, name: v.name, phone: v.phone, kind: v.kind, company: v.company, share_token: newToken(), share_status: "invited" })
    .select("*")
    .maybeSingle<LiveDriver>();
  if (error || !data) {
    logLive("driver insert", error);
    return { error: isMissingRelation(error) ? "Live tracking is being set up (database update 0081 pending)." : "Could not save the driver." };
  }
  await recordDriverEvent(data, { kind: "driver", title: `Driver added (${v.kind === "own" ? "own" : "trip-only"})`, actor: "owner" });
  return { driver: data, reused: false };
}

export async function saveDriver(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  const input = driverInput(fd);
  if (!input.ok) return input;
  // 0082: masters hold our own drivers only (trip-only drivers are typed on incoming trips).
  let v: DriverInput = { ...input.v, kind: "own", company: null };
  const admin = getSupabaseAdmin();
  if (!id) {
    if (!v.phone) return { ok: false, error: "Enter the driver's mobile - his tracking link goes to it on WhatsApp." };
    const r = await findOrCreateDriver(a.ownerId, v);
    if ("error" in r) return { ok: false, error: r.error };
    if (r.reused && r.driver.kind !== "own") {
      await admin.from("live_drivers").update({ kind: "own", company: null, share_expires_at: null, name: v.name }).eq("id", r.driver.id);
    }
    revalidatePath("/live", "layout");
    const back = safeReturn(str(fd, "return", 200));
    if (back) redirect(withParam(back, "picked_driver", r.driver.id));
    return { ok: true, message: r.reused ? `This mobile is already saved as ${r.driver.name}. Using that driver.` : "Driver saved." };
  }
  const driver = await ownDriver(a.ownerId, id);
  if (!driver) return { ok: false, error: "Driver not found." };
  // Editing never changes the kind (a trip-only driver stays trip-only).
  v = { ...v, kind: driver.kind, company: driver.company };
  const patch: Record<string, unknown> = {
    name: v.name,
    phone: v.phone,
    kind: v.kind,
    company: v.company,
    license_no: str(fd, "license_no", 30),
    notes: str(fd, "notes", 300),
    updated_at: new Date().toISOString(),
  };
  // Own drivers never expire; a one-time driver's countdown starts when his trip closes.
  if (v.kind === "own") patch.share_expires_at = null;
  const { error } = await admin.from("live_drivers").update(patch).eq("id", driver.id).eq("owner_id", a.ownerId);
  if (error) {
    if ((error as { code?: string }).code === "23505") return { ok: false, error: "Another driver already has this mobile number." };
    return dbError(error, "driver");
  }
  const changes: [string, string | null, string | null][] = [
    ["name", driver.name, v.name],
    ["mobile", driver.phone, v.phone],
    ["kind", driver.kind, v.kind],
    ["company", driver.company, v.company],
  ];
  for (const [field, oldV, newV] of changes) {
    if ((oldV ?? "") !== (newV ?? "")) {
      await recordDriverEvent(driver, {
        kind: "edit",
        title: `${field[0].toUpperCase()}${field.slice(1)} changed`,
        field,
        oldValue: oldV,
        newValue: newV,
        actor: "owner",
        actorUserId: a.userId,
      });
    }
  }
  revalidatePath("/live", "layout");
  return { ok: true, message: "Driver updated." };
}

/** Soft delete: link stops, truck released, every trip and position stays. */
export async function archiveDriver(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const driver = await ownDriver(a.ownerId, uuidOrNull(fd, "id"));
  if (!driver) return { ok: false, error: "Driver not found." };
  const trip = await openTripOf(a.ownerId, driver.id);
  if (trip) return { ok: false, error: `${driver.name} is on ${tripNo(trip.trip_seq)}. Close it or change its driver first.` };
  const admin = getSupabaseAdmin();
  const nowIso = new Date().toISOString();
  await admin.from("live_assignments").update({ ended_at: nowIso, ended_reason: "driver archived" }).eq("driver_id", driver.id).is("ended_at", null);
  const { error } = await admin.from("live_drivers").update({ archived_at: nowIso, share_status: "revoked" }).eq("id", driver.id);
  if (error) return dbError(error, "archive driver");
  await recordDriverEvent(driver, { kind: "driver", title: "Driver archived (link stopped)", actor: "owner", actorUserId: a.userId });
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
  await recordDriverEvent(driver, { kind: "driver", title: "Driver restored", actor: "owner", actorUserId: a.userId });
  revalidatePath("/live", "layout");
  return { ok: true, message: "Driver restored. Send him the link again." };
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
  // Old per-trip links resolve to this driver; switch them off too.
  await admin.from("live_trips").update({ driver_token: null }).eq("driver_id", driver.id).not("driver_token", "is", null);
  const trip = await openTripOf(a.ownerId, driver.id);
  if (trip) await admin.from("live_trips").update({ share_status: "invited", share_last_seen_at: null }).eq("id", trip.id);
  await recordDriverEvent(driver, { kind: "share", title: "New link made (old link stopped)", actor: "owner", actorUserId: a.userId }, trip);
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
  const trip = await openTripOf(a.ownerId, driver.id);
  if (trip) await getSupabaseAdmin().from("live_trips").update({ share_status: "stopped" }).eq("id", trip.id);
  await recordDriverEvent(driver, { kind: "share", title: "You switched the link off", actor: "owner", actorUserId: a.userId }, trip);
  revalidatePath("/live", "layout");
  return { ok: true, message: "Link off. Nothing more is recorded." };
}

/** Same link back on (re-invite without a new link). */
export async function resumeDriverSharing(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const driver = await ownDriver(a.ownerId, uuidOrNull(fd, "driver_id"));
  if (!driver) return { ok: false, error: "Driver not found." };
  const trip = await openTripOf(a.ownerId, driver.id);
  await reactivateSharing({ ...driver, share_status: driver.share_status === "stopped" ? "revoked" : driver.share_status }, a.userId, trip);
  revalidatePath("/live", "layout");
  return { ok: true, message: "Link is on. Send it again on WhatsApp." };
}

export async function assignTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const driver = await ownDriver(a.ownerId, uuidOrNull(fd, "driver_id"));
  if (!driver) return { ok: false, error: "Driver not found." };
  let vehicle = await ownVehicle(a.ownerId, uuidOrNull(fd, "vehicle_id"));
  if (!vehicle && str(fd, "number", 20)) {
    const v = vehicleRowFrom(fd);
    if (!v.ok) return v;
    vehicle = await upsertVehicleRow(a.ownerId, v.number, v.row);
  }
  if (!vehicle) return { ok: false, error: "Pick a truck or type its number." };
  const r = await setAssignment(a.ownerId, driver, vehicle, { force: fd.get("force") === "on", userId: a.userId });
  if (!r.ok) return r;
  revalidatePath("/live", "layout");
  return { ok: true, message: `${prettyVehicle(vehicle.number)} is now with ${driver.name}.` };
}

export async function unassignTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const driver = await ownDriver(a.ownerId, uuidOrNull(fd, "driver_id"));
  if (!driver) return { ok: false, error: "Driver not found." };
  const r = await setAssignment(a.ownerId, driver, null, { force: true, userId: a.userId });
  if (!r.ok) return r;
  revalidatePath("/live", "layout");
  return { ok: true, message: "Truck removed from this driver." };
}

/* -------------------------------------------------------------------------- */
/* trip fields                                                                 */
/* -------------------------------------------------------------------------- */

type TripFields = Record<string, unknown>;

const PURPOSE_SET = new Set<string>(PURPOSES);
const PARTY_SET = new Set<string>(["dealer", "customer", "internal", "supplier", "other"]);
const COLS_82 = ["direction", "party_type", "party_name", "from_address", "to_address", "inline_driver"];

/** Before 0082 is applied the new columns do not exist: leave them out. */
async function strip82<T extends Record<string, unknown>>(row: T): Promise<T> {
  if (await liveSchema82()) return row;
  const out = { ...row };
  for (const k of COLS_82) delete out[k];
  return out;
}

/**
 * Trip details from the form (the "Trip details" section is on).
 *
 * OUTGOING (we send): From = one of our warehouses (required), To = who it
 *   goes to: a saved customer place, or a name (required) + exact location
 *   (map pick / address search / Google Maps link) + address.
 * INCOMING (we receive): supplier name (required) and his place, typed on the
 *   trip only (name, address, location); To = our warehouse (required).
 * Purpose is required. Everything else is optional.
 */
async function readTripFields(
  fd: FormData,
  ownerId: string,
  direction: TripDirection,
  requireCore = true,
): Promise<{ ok: true; row: TripFields } | { ok: false; error: string }> {
  const rawPurpose = str(fd, "purpose", 12);
  const purpose = rawPurpose && PURPOSE_SET.has(rawPurpose) ? rawPurpose : null;
  if (!purpose && requireCore) return { ok: false, error: "Trip: pick what the trip is for (dispatch, pickup...)." };
  const rawParty = str(fd, "party_type", 12);
  const party_type = (rawParty && PARTY_SET.has(rawParty) ? rawParty : null) as PartyType | null;

  const fromLocRaw = str(fd, "from_location", 500);
  const fromLoc = parseLatLng(fromLocRaw);
  if (fromLocRaw && !fromLoc) return { ok: false, error: "From location not understood. Pick it on the map, search the address, or paste a full Google Maps link." };
  const toLocRaw = str(fd, "to_location", 500);
  const toLoc = parseLatLng(toLocRaw);
  if (toLocRaw && !toLoc) return { ok: false, error: "Destination location not understood. Pick it on the map, search the address, or paste a full Google Maps link." };

  const admin = getSupabaseAdmin();
  let from_place_id: string | null = null;
  let from_name: string | null = null;
  let from_address: string | null = null;
  let party_name: string | null = null;
  let to_place_id = uuidOrNull(fd, "to_place_id");
  let to_name: string | null = null;
  let to_address: string | null = null;
  const to_city = str(fd, "to_city", 80);

  if (direction === "incoming") {
    party_name = str(fd, "party_name", 120);
    from_name = str(fd, "from_name", 120) ?? party_name;
    from_address = str(fd, "from_address", 300);
    if (requireCore && !party_name) return { ok: false, error: "Trip: enter who is sending (supplier / dealer name)." };
    if (requireCore && !to_place_id) return { ok: false, error: "Trip: pick your warehouse it is coming to." };
  } else {
    from_place_id = uuidOrNull(fd, "from_place_id");
    from_name = from_place_id ? null : str(fd, "from_name", 120);
    to_name = to_place_id ? null : str(fd, "to_name", 120);
    to_address = to_place_id ? null : str(fd, "to_address", 300);
    if (requireCore && !from_place_id && !from_name) return { ok: false, error: "Trip: pick the warehouse it leaves from." };
    if (requireCore && !to_place_id && !to_name) return { ok: false, error: "Trip: enter who it is going to (name)." };
  }

  const ids = [from_place_id, to_place_id].filter(Boolean) as string[];
  if (ids.length) {
    const { data } = await admin.from("live_places").select("id").eq("owner_id", ownerId).in("id", ids);
    const ok = new Set((data ?? []).map((r: { id: string }) => r.id));
    if (ids.some((i) => !ok.has(i))) return { ok: false, error: "That place is not in your list." };
  }
  // Outgoing: keep the customer for next time (a customer place, not a master).
  if (direction === "outgoing" && !to_place_id && to_name && fd.get("save_to_place") === "on") {
    const { data } = await admin
      .from("live_places")
      .insert({ owner_id: ownerId, kind: "customer", name: to_name, address: to_address, city: to_city, lat: toLoc?.lat ?? null, lng: toLoc?.lng ?? null, radius_m: 500 })
      .select("id")
      .maybeSingle<{ id: string }>();
    if (data?.id) to_place_id = data.id;
  }
  if (to_place_id) {
    const { data } = await admin.from("live_places").select("name").eq("id", to_place_id).maybeSingle<{ name: string }>();
    to_name = data?.name ?? null;
  }

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
      purpose,
      party_type,
      party_name,
      from_place_id,
      from_name,
      from_address,
      from_lat: direction === "incoming" ? (fromLoc?.lat ?? null) : null,
      from_lng: direction === "incoming" ? (fromLoc?.lng ?? null) : null,
      to_place_id,
      to_name,
      to_address,
      to_city,
      to_lat: to_place_id ? null : (toLoc?.lat ?? null),
      to_lng: to_place_id ? null : (toLoc?.lng ?? null),
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

/** Row column -> rule field name in TRIP_FIELDS_* (shared.ts). */
const RULE_FIELD: Record<string, string> = {
  from_place_id: "from",
  from_name: "from",
  from_address: "from",
  from_lat: "from",
  from_lng: "from",
  to_place_id: "to",
  to_name: "to",
  to_address: "to",
  to_city: "to",
  to_lat: "to",
  to_lng: "to",
};

const FIELD_LABEL: Record<string, string> = {
  purpose: "Purpose",
  party_type: "Party type",
  party_name: "Supplier",
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

/* -------------------------------------------------------------------------- */
/* create: direction + trip name first; everything else on the setup screen   */
/* -------------------------------------------------------------------------- */

const COPY_COLS = [
  "purpose", "from_place_id", "from_name", "from_lat", "from_lng", "to_place_id", "to_name", "to_city", "to_lat", "to_lng",
  "consignee_name", "consignee_phone", "transporter", "material", "quantity_unit", "party_type", "party_name", "from_address", "to_address",
] as const;

export async function createTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const admin = getSupabaseAdmin();
  const direction: TripDirection = str(fd, "direction", 10) === "incoming" ? "incoming" : "outgoing";
  const name = str(fd, "trip_name", 80);
  if (!name) return { ok: false, error: "Give the trip a name, e.g. Rajkot order 448." };
  if (direction === "incoming" && !(await liveSchema82())) {
    return { ok: false, error: "Receiving trips need a database update (migration 0082). Sending trips work now." };
  }

  const { data: prof } = await admin.from("live_profiles").select("default_place_id").eq("owner_id", a.ownerId).maybeSingle<{ default_place_id: string | null }>();
  const home = prof?.default_place_id ?? null;
  const copy = await ownTrip(a.ownerId, uuidOrNull(fd, "copy"));

  let row: Record<string, unknown> = {
    owner_id: a.ownerId,
    trip_name: name,
    status: "planned",
    driver_token: null,
    share_status: "invited",
    direction,
    purpose: direction === "incoming" ? "pickup" : "dispatch",
    party_type: direction === "incoming" ? "supplier" : "customer",
    from_place_id: direction === "outgoing" ? home : null,
    to_place_id: direction === "incoming" ? home : null,
  };
  if (copy && (copy.direction ?? "outgoing") === direction) {
    const src = copy as unknown as Record<string, unknown>;
    for (const c of COPY_COLS) if (src[c] !== undefined) row[c] = src[c];
  }
  if (row.to_place_id) {
    const { data } = await admin.from("live_places").select("name").eq("id", row.to_place_id as string).maybeSingle<{ name: string }>();
    row.to_name = data?.name ?? row.to_name ?? null;
  }
  row = await strip82(row);
  const { data: trip, error } = await admin.from("live_trips").insert(row).select("*").maybeSingle<LiveTrip>();
  if (error || !trip) return dbError(error, "create trip");
  await recordEvent(trip, {
    kind: "status",
    title: direction === "incoming" ? "Trip created (we are receiving)" : "Trip created (we are sending)",
    actor: "owner",
    actorUserId: a.userId,
  });
  revalidatePath("/live", "layout");
  redirect(`/live/trips/${trip.id}/edit?setup=1`);
}

/* -------------------------------------------------------------------------- */
/* trip setup / edit with phase rules + per-field audit                        */
/* -------------------------------------------------------------------------- */

export async function updateTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  if (tripPhase(trip.status) === "closed") return { ok: false, error: "A closed trip cannot be edited. Add a note, or reopen it first." };
  const direction: TripDirection = trip.direction === "incoming" ? "incoming" : "outgoing";
  const admin = getSupabaseAdmin();
  const started = tripPhase(trip.status) === "started";

  const patch: Record<string, unknown> = {};
  const changed = new Map<string, { old: string; new: string }>();

  // Trip details (only when the section is on; off = leave as it is).
  if (fd.get("details_on") === "on") {
    // An older trip (before 0081) may have no purpose; once started it stays so.
    const form = await readTripFields(fd, a.ownerId, direction, tripFieldEditable(trip.status, "purpose"));
    if (!form.ok) return form;
    const row = await strip82(form.row);
    for (const [col, val] of Object.entries(row)) {
      const before = (trip as unknown as Record<string, unknown>)[col];
      if (asText(before) === asText(val)) continue;
      const rule = RULE_FIELD[col] ?? col;
      if (!tripFieldEditable(trip.status, rule)) continue;
      patch[col] = val;
      const prev = changed.get(rule);
      changed.set(rule, {
        old: prev ? prev.old : rule === "to" ? destinationText(trip) : rule === "from" ? (trip.from_name ?? asText(trip.from_place_id)) : asText(before),
        new: rule === "to" ? asText(row.to_name ?? row.to_city) : rule === "from" ? asText(row.from_name ?? row.from_place_id) : asText(val),
      });
    }
  }

  // Driver. Outgoing: from the Drivers master. Incoming: typed on the trip only.
  let newDriver: LiveDriver | null = null;
  if (direction === "incoming") {
    const dn = str(fd, "in_driver_name", 80);
    const rawPhone = str(fd, "in_driver_phone", 20);
    const phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
    if (rawPhone && !phone) return { ok: false, error: `Driver mobile: ${PHONE_ERROR}` };
    if (phone && phone !== trip.driver_phone) {
      if (!dn) return { ok: false, error: "Enter the driver's name." };
      const company = (patch.party_name as string | undefined) ?? trip.party_name ?? null;
      const r = await findOrCreateDriver(a.ownerId, { name: dn, phone, kind: "one_time", company });
      if ("error" in r) return { ok: false, error: r.error };
      if (r.reused && r.driver.kind === "one_time" && r.driver.name !== dn) {
        await admin.from("live_drivers").update({ name: dn, company }).eq("id", r.driver.id);
        r.driver.name = dn;
      }
      newDriver = r.driver;
    } else if (dn && trip.driver_id && dn !== trip.driver_name) {
      await admin.from("live_drivers").update({ name: dn }).eq("id", trip.driver_id).eq("kind", "one_time");
      patch.driver_name = dn;
      changed.set("driver", { old: trip.driver_name ?? "", new: dn });
    }
    if (fd.has("in_truck_no")) {
      const tn = normalizeVehicleNo(str(fd, "in_truck_no", 20)) || null;
      if (tn && !/^[A-Z0-9]{4,12}$/.test(tn)) return { ok: false, error: "Truck number looks wrong, e.g. GJ36X1234." };
      if ((tn ?? "") !== (trip.vehicle_no ?? "")) {
        patch.vehicle_no = tn;
        patch.vehicle_id = null;
        changed.set("truck", { old: trip.vehicle_no ?? "", new: tn ?? "" });
      }
    }
  } else {
    const newDriverId = uuidOrNull(fd, "driver_id");
    if (newDriverId && newDriverId !== trip.driver_id) {
      newDriver = await ownDriver(a.ownerId, newDriverId);
      if (!newDriver || newDriver.archived_at) return { ok: false, error: "Pick a driver from your list." };
    }
  }

  if (newDriver && newDriver.id !== trip.driver_id) {
    const busy = await openTripOf(a.ownerId, newDriver.id, trip.id);
    if (busy) return { ok: false, error: `${newDriver.name} is already on ${tripNo(busy.trip_seq)}. Close it first.` };
    Object.assign(patch, {
      driver_id: newDriver.id,
      driver_name: newDriver.name,
      driver_phone: newDriver.phone,
      share_status: newDriver.share_status === "active" ? "active" : "invited",
      share_last_seen_at: newDriver.share_last_seen_at,
      share_consent_at: newDriver.share_consent_at,
      inline_driver: direction === "incoming",
    });
  } else {
    newDriver = null;
  }

  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    const { error } = await admin.from("live_trips").update(await strip82(patch)).eq("id", trip.id).eq("owner_id", a.ownerId);
    if (error) {
      if ((error as { code?: string }).code === "23505") return { ok: false, error: "That driver already has an open trip." };
      return dbError(error, "update trip");
    }
  }

  for (const [field, v] of changed) {
    await recordEvent(trip, {
      kind: "edit",
      title: `${FIELD_LABEL[field] ?? field} changed${started ? " during the trip" : ""}`,
      detail: `${v.old || "-"} → ${v.new || "-"}`,
      field,
      oldValue: v.old,
      newValue: v.new,
      actor: "owner",
      actorUserId: a.userId,
    });
  }

  if (newDriver) {
    const oldName = trip.driver_name ?? "";
    await recordEvent(
      { ...trip, driver_id: newDriver.id },
      {
        kind: "assign",
        title: oldName ? `Driver changed ${oldName} → ${newDriver.name}${started ? " during the trip" : ""}` : `Driver ${newDriver.name} added`,
        field: "driver",
        oldValue: oldName || null,
        newValue: newDriver.name,
        actor: "owner",
        actorUserId: a.userId,
      },
    );
    if (trip.driver_id) {
      const oldDriver = await ownDriver(a.ownerId, trip.driver_id);
      if (oldDriver) {
        await recordDriverEvent(oldDriver, { kind: "assign", title: `Taken off ${tripNo(trip.trip_seq)} (now ${newDriver.name})`, actor: "owner", actorUserId: a.userId });
        if (oldDriver.kind === "one_time") await afterTripClosed({ ...trip, driver_id: oldDriver.id });
      }
    }
    await reactivateSharing(newDriver, a.userId, null);
  }

  // Outgoing truck (from the Trucks master). Goes through the one-driver-one-truck rule.
  if (direction === "outgoing" && fd.has("vehicle_id")) {
    const effectiveDriver = newDriver ?? (trip.driver_id ? await ownDriver(a.ownerId, trip.driver_id) : null);
    const vehicleId = uuidOrNull(fd, "vehicle_id");
    const wantNone = fd.get("vehicle_id") === "none" || fd.get("vehicle_id") === "";
    if (wantNone ? trip.vehicle_id : vehicleId && vehicleId !== trip.vehicle_id) {
      const vehicle = wantNone ? null : await ownVehicle(a.ownerId, vehicleId);
      if (!wantNone && !vehicle) return { ok: false, error: "Pick a truck from your list." };
      if (effectiveDriver) {
        const r = await setAssignment(a.ownerId, effectiveDriver, vehicle, { force: fd.get("force") === "on", userId: a.userId });
        if (!r.ok) return r;
      } else {
        await admin.from("live_trips").update({ vehicle_id: vehicle?.id ?? null, vehicle_no: vehicle?.number ?? null }).eq("id", trip.id);
        await recordEvent(trip, {
          kind: "edit",
          title: "Truck changed",
          detail: `${prettyVehicle(trip.vehicle_no) || "-"} → ${prettyVehicle(vehicle?.number) || "-"}`,
          field: "truck",
          oldValue: trip.vehicle_no,
          newValue: vehicle?.number ?? null,
          actor: "owner",
          actorUserId: a.userId,
        });
      }
    }
  }

  if (newDriver) await admin.from("live_assignments").update({ trip_id: trip.id }).eq("driver_id", newDriver.id).is("ended_at", null);
  revalidatePath("/live", "layout");
  redirect(`/live/trips/${trip.id}${newDriver ? "?created=1" : ""}`);
}

/* -------------------------------------------------------------------------- */
/* trip status, notes, links                                                   */
/* -------------------------------------------------------------------------- */

export async function setTripStatus(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  const to = str(fd, "status", 20) as TripStatus;
  if (!TRIP_STATUSES.includes(to)) return { ok: false, error: "Unknown status." };
  if (!NEXT_STATUSES[trip.status].includes(to)) {
    return { ok: false, error: `A ${STATUS_LABEL[trip.status].toLowerCase()} trip cannot go to ${STATUS_LABEL[to].toLowerCase()}.` };
  }
  // Reopening must not give the driver two open trips.
  if (tripPhase(trip.status) === "closed" && trip.driver_id) {
    const busy = await openTripOf(a.ownerId, trip.driver_id, trip.id);
    if (busy) return { ok: false, error: `The driver is on ${tripNo(busy.trip_seq)} now. Close that first.` };
  }
  const note = str(fd, "note", 500);
  const ok = await changeStatus(trip, to, "owner", note ? `You: ${note}` : null);
  if (!ok) return { ok: false, error: "The trip changed meanwhile. Refresh and try again." };
  if (to === "delivered" && note) {
    await getSupabaseAdmin().from("live_trips").update({ pod_note: note }).eq("id", trip.id);
  }
  revalidatePath("/live", "layout");
  return { ok: true, message: `Marked ${STATUS_LABEL[to].toLowerCase()}.` };
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

/**
 * Only a planned trip that never moved can be deleted (a typo). Anything with
 * history is cancelled instead, so the record stays.
 */
export async function deleteTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  if (trip.status !== "planned" || trip.started_at || trip.last_point_at) {
    return { ok: false, error: "This trip has history. Cancel it instead - it stays in your records." };
  }
  const { error } = await getSupabaseAdmin().from("live_trips").delete().eq("id", trip.id).eq("owner_id", a.ownerId);
  if (error) return dbError(error, "delete trip");
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
  const { error } = await getSupabaseAdmin()
    .from("live_profiles")
    .upsert(
      {
        owner_id: a.ownerId,
        business_name: str(fd, "business_name", 120),
        gstin,
        contact_name: str(fd, "contact_name", 80),
        contact_phone,
        business_type: bt && BUSINESS_TYPES.includes(bt) ? bt : null,
        default_place_id: placeId,
        one_time_expire_hours: hours,
        notify_status: fd.get("notify_status") === "on",
        notify_alerts: fd.get("notify_alerts") === "on",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "owner_id" },
    );
  if (error) return dbError(error, "live profile");
  revalidatePath("/live", "layout");
  revalidatePath("/portal/profile", "layout");
  return { ok: true, message: "Saved." };
}
