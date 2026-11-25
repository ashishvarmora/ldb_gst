"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/lib/auth";
import { extractDispatch, type DispatchExtract } from "@/lib/live-ai";
import { changeStatus, recordEvent } from "@/lib/live/automation";
import { isMissingRelation, logLive, newToken } from "@/lib/live/server";
import {
  NEXT_STATUSES,
  PLACE_KINDS,
  STATUS_LABEL,
  TRIP_STATUSES,
  fromLocalInput,
  normalizeEway,
  normalizeVehicleNo,
  parseLatLng,
  type LiveTrip,
  type PlaceKind,
  type TripStatus,
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
    ? await admin.from("live_places").update(row).eq("id", id).eq("owner_id", a.ownerId)
    : await admin.from("live_places").insert(row);
  if (res.error) return dbError(res.error, "place");
  revalidatePath("/live", "layout");
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
/* vehicles and drivers                                                        */
/* -------------------------------------------------------------------------- */

export async function saveVehicle(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  const number = normalizeVehicleNo(str(fd, "number", 20));
  if (!/^[A-Z0-9]{4,12}$/.test(number)) return { ok: false, error: "Enter the vehicle number, e.g. GJ36X1234." };
  const ownership = str(fd, "ownership", 10) === "own" ? "own" : "market";
  const cap = numOrNull(fd, "capacity_kg");
  if (cap === "bad") return { ok: false, error: "Capacity must be a number (kg)." };
  const row = {
    owner_id: a.ownerId,
    number,
    ownership,
    vehicle_type: str(fd, "vehicle_type", 40),
    transporter: str(fd, "transporter", 120),
    capacity_kg: cap != null ? Math.round(cap) : null,
    notes: str(fd, "notes", 300),
    archived_at: null,
    updated_at: new Date().toISOString(),
  };
  const admin = getSupabaseAdmin();
  const res = id
    ? await admin.from("live_vehicles").update(row).eq("id", id).eq("owner_id", a.ownerId)
    : await admin.from("live_vehicles").upsert(row, { onConflict: "owner_id,number" });
  if (res.error) {
    if ((res.error as { code?: string }).code === "23505") return { ok: false, error: "That vehicle is already in your list." };
    return dbError(res.error, "vehicle");
  }
  revalidatePath("/live", "layout");
  return { ok: true, message: id ? "Vehicle updated." : "Vehicle added." };
}

export async function archiveVehicle(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  if (!id) return { ok: false, error: "Vehicle not found." };
  const { error } = await getSupabaseAdmin()
    .from("live_vehicles")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", a.ownerId);
  if (error) return dbError(error, "archive vehicle");
  revalidatePath("/live", "layout");
  return { ok: true, message: "Vehicle removed." };
}

export async function saveDriver(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  const name = str(fd, "name", 80);
  if (!name) return { ok: false, error: "Enter the driver's name." };
  const rawPhone = str(fd, "phone", 20);
  const phone = rawPhone ? normaliseIndianMobile(rawPhone) : null;
  if (rawPhone && !phone) return { ok: false, error: PHONE_ERROR };
  const row = {
    owner_id: a.ownerId,
    name,
    phone,
    license_no: str(fd, "license_no", 30),
    notes: str(fd, "notes", 300),
    archived_at: null,
    updated_at: new Date().toISOString(),
  };
  const admin = getSupabaseAdmin();
  const res = id
    ? await admin.from("live_drivers").update(row).eq("id", id).eq("owner_id", a.ownerId)
    : await admin.from("live_drivers").insert(row);
  if (res.error) {
    if ((res.error as { code?: string }).code === "23505") return { ok: false, error: "A driver with this mobile is already saved." };
    return dbError(res.error, "driver");
  }
  revalidatePath("/live", "layout");
  return { ok: true, message: id ? "Driver updated." : "Driver added." };
}

export async function archiveDriver(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const id = uuidOrNull(fd, "id");
  if (!id) return { ok: false, error: "Driver not found." };
  const { error } = await getSupabaseAdmin()
    .from("live_drivers")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_id", a.ownerId);
  if (error) return dbError(error, "archive driver");
  revalidatePath("/live", "layout");
  return { ok: true, message: "Driver removed." };
}

/* -------------------------------------------------------------------------- */
/* trips                                                                       */
/* -------------------------------------------------------------------------- */

async function ownTrip(ownerId: string, id: string | null): Promise<LiveTrip | null> {
  if (!id) return null;
  const { data } = await getSupabaseAdmin().from("live_trips").select("*").eq("id", id).eq("owner_id", ownerId).maybeSingle<LiveTrip>();
  return data ?? null;
}

/** Find-or-create the vehicle by number; returns its id. */
async function upsertVehicle(ownerId: string, number: string, ownership: string | null, transporter: string | null) {
  const admin = getSupabaseAdmin();
  const { data: existing } = await admin
    .from("live_vehicles")
    .select("id,transporter,ownership,archived_at")
    .eq("owner_id", ownerId)
    .eq("number", number)
    .maybeSingle<{ id: string; transporter: string | null; ownership: string; archived_at: string | null }>();
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (existing.archived_at) patch.archived_at = null;
    if (transporter && !existing.transporter) patch.transporter = transporter;
    if (ownership && ownership !== existing.ownership) patch.ownership = ownership;
    if (Object.keys(patch).length) await admin.from("live_vehicles").update(patch).eq("id", existing.id);
    return existing.id;
  }
  const { data } = await admin
    .from("live_vehicles")
    .insert({ owner_id: ownerId, number, ownership: ownership === "own" ? "own" : "market", transporter })
    .select("id")
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

/** Find-or-create the driver by mobile (or by exact name when no mobile). */
async function upsertDriver(ownerId: string, name: string | null, phone: string | null) {
  if (!name && !phone) return null;
  const admin = getSupabaseAdmin();
  let q = admin.from("live_drivers").select("id,name,archived_at").eq("owner_id", ownerId);
  q = phone ? q.eq("phone", phone) : q.ilike("name", name!).is("phone", null);
  const { data: existing } = await q.limit(1).maybeSingle<{ id: string; name: string; archived_at: string | null }>();
  if (existing) {
    const patch: Record<string, unknown> = {};
    if (existing.archived_at) patch.archived_at = null;
    if (name && name !== existing.name) patch.name = name;
    if (Object.keys(patch).length) await admin.from("live_drivers").update(patch).eq("id", existing.id);
    return existing.id;
  }
  const { data } = await admin
    .from("live_drivers")
    .insert({ owner_id: ownerId, name: name ?? "Driver", phone })
    .select("id")
    .maybeSingle<{ id: string }>();
  return data?.id ?? null;
}

type TripFields = Record<string, unknown>;

/** Reads and validates the trip form. Shared by create and edit. */
async function readTripForm(fd: FormData, ownerId: string): Promise<{ ok: true; row: TripFields } | { ok: false; error: string }> {
  const vehicle_no = normalizeVehicleNo(str(fd, "vehicle_no", 20));
  if (!/^[A-Z0-9]{4,12}$/.test(vehicle_no)) return { ok: false, error: "Enter the vehicle number, e.g. GJ36X1234." };

  const from_place_id = uuidOrNull(fd, "from_place_id");
  let to_place_id = uuidOrNull(fd, "to_place_id");
  let to_name = str(fd, "to_name", 120);
  const to_city = str(fd, "to_city", 80);
  const toLocRaw = str(fd, "to_location", 500);
  const toLoc = parseLatLng(toLocRaw);
  if (toLocRaw && !toLoc) return { ok: false, error: "Destination location not understood. Paste 'lat, lng' or a full Google Maps link." };
  if (!to_place_id && !to_name && !to_city) return { ok: false, error: "Where is it going? Pick a customer or type the destination." };

  const admin = getSupabaseAdmin();
  const ids = [from_place_id, to_place_id].filter(Boolean) as string[];
  if (ids.length) {
    const { data } = await admin.from("live_places").select("id").eq("owner_id", ownerId).in("id", ids);
    const ok = new Set((data ?? []).map((r: { id: string }) => r.id));
    if (ids.some((i) => !ok.has(i))) return { ok: false, error: "That place is not in your list." };
  }

  // "Save as customer": a typed destination becomes a place for next time.
  if (!to_place_id && to_name && fd.get("save_to_place") === "on") {
    const { data } = await admin
      .from("live_places")
      .insert({
        owner_id: ownerId,
        kind: "customer",
        name: to_name,
        city: to_city,
        lat: toLoc?.lat ?? null,
        lng: toLoc?.lng ?? null,
        radius_m: 500,
      })
      .select("id")
      .maybeSingle<{ id: string }>();
    if (data?.id) to_place_id = data.id;
  }
  if (to_place_id && !to_name) {
    const { data } = await admin.from("live_places").select("name").eq("id", to_place_id).maybeSingle<{ name: string }>();
    to_name = data?.name ?? null;
  }

  const rawDriverPhone = str(fd, "driver_phone", 20);
  const driver_phone = rawDriverPhone ? normaliseIndianMobile(rawDriverPhone) : null;
  if (rawDriverPhone && !driver_phone) return { ok: false, error: `Driver mobile: ${PHONE_ERROR}` };
  const rawConsPhone = str(fd, "consignee_phone", 20);
  const consignee_phone = rawConsPhone ? normaliseIndianMobile(rawConsPhone) : null;
  if (rawConsPhone && !consignee_phone) return { ok: false, error: `Customer mobile: ${PHONE_ERROR}` };

  const ewayRaw = str(fd, "eway_bill_no", 20);
  const eway_bill_no = ewayRaw ? normalizeEway(ewayRaw) : null;
  if (ewayRaw && !eway_bill_no) return { ok: false, error: "E-way bill number must be 12 digits." };

  const nums: Record<string, number | null> = {};
  for (const k of ["quantity", "weight_kg", "invoice_value_inr", "freight_inr"]) {
    const v = numOrNull(fd, k);
    if (v === "bad") return { ok: false, error: `${k.replace(/_inr|_kg/, "").replace("_", " ")} must be a number.` };
    nums[k] = v;
  }

  const driver_name = str(fd, "driver_name", 80);
  const transporter = str(fd, "transporter", 120);
  const vehicle_id = await upsertVehicle(ownerId, vehicle_no, str(fd, "vehicle_ownership", 10), transporter);
  const driver_id = await upsertDriver(ownerId, driver_name, driver_phone);

  return {
    ok: true,
    row: {
      from_place_id,
      to_place_id,
      to_name,
      to_city,
      to_lat: toLoc?.lat ?? null,
      to_lng: toLoc?.lng ?? null,
      consignee_name: str(fd, "consignee_name", 120),
      consignee_phone,
      vehicle_id,
      vehicle_no,
      driver_id,
      driver_name,
      driver_phone,
      transporter,
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

export async function createTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const form = await readTripForm(fd, a.ownerId);
  if (!form.ok) return form;
  const startNow = fd.get("start_now") === "on";
  const nowIso = new Date().toISOString();
  const { data, error } = await getSupabaseAdmin()
    .from("live_trips")
    .insert({
      ...form.row,
      owner_id: a.ownerId,
      status: startNow ? "in_transit" : "planned",
      started_at: startNow ? nowIso : null,
      driver_token: newToken(),
      share_status: "invited",
    })
    .select("*")
    .maybeSingle<LiveTrip>();
  if (error || !data) return dbError(error, "create trip");
  await recordEvent(data, {
    kind: "status",
    title: startNow ? "Trip created and dispatched" : "Trip created",
    actor: "owner",
  });
  revalidatePath("/live", "layout");
  redirect(`/live/trips/${data.id}?created=1`);
}

export async function updateTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  const form = await readTripForm(fd, a.ownerId);
  if (!form.ok) return form;
  const { error } = await getSupabaseAdmin()
    .from("live_trips")
    .update({ ...form.row, updated_at: new Date().toISOString() })
    .eq("id", trip.id)
    .eq("owner_id", a.ownerId);
  if (error) return dbError(error, "update trip");
  await recordEvent(trip, { kind: "edit", title: "Trip details edited", actor: "owner" });
  revalidatePath("/live", "layout");
  redirect(`/live/trips/${trip.id}`);
}

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
  await recordEvent(trip, { kind: "note", title: note.slice(0, 200), detail: note.length > 200 ? note : null, actor: "owner" });
  revalidatePath(`/live/trips/${trip.id}`);
  return { ok: true, message: "Note added." };
}

/** New driver link (old one stops working at once). */
export async function resetDriverLink(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  const { error } = await getSupabaseAdmin()
    .from("live_trips")
    .update({ driver_token: newToken(), share_status: "invited", share_last_seen_at: null })
    .eq("id", trip.id);
  if (error) return dbError(error, "reset link");
  await recordEvent(trip, { kind: "share", title: "New driver link made (old link stopped)", actor: "owner" });
  revalidatePath(`/live/trips/${trip.id}`);
  return { ok: true, message: "New link ready. Send it to the driver." };
}

export async function stopDriverLink(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  const { error } = await getSupabaseAdmin().from("live_trips").update({ share_status: "revoked" }).eq("id", trip.id);
  if (error) return dbError(error, "stop link");
  await recordEvent(trip, { kind: "share", title: "You stopped the driver link", actor: "owner" });
  revalidatePath(`/live/trips/${trip.id}`);
  return { ok: true, message: "Driver link stopped." };
}

export async function setCustomerLink(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  const on = fd.get("on") === "1";
  const { error } = await getSupabaseAdmin()
    .from("live_trips")
    .update({ track_token: on ? newToken() : null })
    .eq("id", trip.id);
  if (error) return dbError(error, "customer link");
  await recordEvent(trip, { kind: "share", title: on ? "Customer tracking link made" : "Customer tracking link switched off", actor: "owner" });
  revalidatePath(`/live/trips/${trip.id}`);
  return { ok: true, message: on ? "Customer link ready." : "Customer link off." };
}

export async function deleteTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  const { error } = await getSupabaseAdmin().from("live_trips").delete().eq("id", trip.id).eq("owner_id", a.ownerId);
  if (error) return dbError(error, "delete trip");
  revalidatePath("/live", "layout");
  redirect("/live/trips");
}

/** "Same again": a new planned trip copying route, customer and material. */
export async function duplicateTrip(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const a = await actor();
  if (!isActor(a)) return a;
  const trip = await ownTrip(a.ownerId, uuidOrNull(fd, "id"));
  if (!trip) return { ok: false, error: "Trip not found." };
  const { data, error } = await getSupabaseAdmin()
    .from("live_trips")
    .insert({
      owner_id: a.ownerId,
      from_place_id: trip.from_place_id,
      to_place_id: trip.to_place_id,
      to_name: trip.to_name,
      to_city: trip.to_city,
      to_lat: trip.to_lat,
      to_lng: trip.to_lng,
      consignee_name: trip.consignee_name,
      consignee_phone: trip.consignee_phone,
      transporter: trip.transporter,
      material: trip.material,
      quantity_unit: trip.quantity_unit,
      status: "planned",
      driver_token: newToken(),
      share_status: "invited",
    })
    .select("*")
    .maybeSingle<LiveTrip>();
  if (error || !data) return dbError(error, "duplicate trip");
  await recordEvent(data, { kind: "status", title: "Trip created (copied)", actor: "owner" });
  revalidatePath("/live", "layout");
  redirect(`/live/trips/${data.id}/edit?copied=1`);
}
