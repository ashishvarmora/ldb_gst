import "server-only";

import { env } from "@/lib/env";
import { sendPushToUser } from "@/lib/push";
import { sendTelegramMessage } from "@/lib/telegram";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { destinationPoint, isMissingRelation, loadTrail, logLive } from "@/lib/live/server";
import {
  DELAY_GRACE_MS,
  EWAY_WARN_MS,
  NO_SIGNAL_MS,
  OPEN_STATUSES,
  STATUS_LABEL,
  STOPPAGE_MS,
  STOPPAGE_RADIUS_M,
  etaFrom,
  fmtIst,
  metersBetween,
  prettyVehicle,
  recentAvgKmph,
  roadKm,
  tripNo,
  type LivePlace,
  type LiveTrip,
  type Point,
  type TripStatus,
} from "@/lib/live/shared";

/**
 * Live module automation (0079). Rule-based, no AI, no cost.
 *
 * Runs (a) after every driver location report, in `after()` so the phone gets
 * its answer at once, and (b) from the existing cron tick for the time-based
 * rules nobody's phone would trigger (no signal, e-way bill expiry).
 *
 * Every rule writes a live_trip_events row with a dedupe_key; the unique index
 * (trip_id, dedupe_key) is what makes "tell the owner once" hold even when two
 * reports race. Only a row that actually got inserted sends a notification.
 *
 * Channels: app push (sendPushToUser) and Telegram when the account set it up.
 * Never WhatsApp - that one costs money per message.
 */

const admin = () => getSupabaseAdmin();

type EventInput = {
  kind: string;
  title: string;
  detail?: string | null;
  actor?: "owner" | "driver" | "system";
  lat?: number | null;
  lng?: number | null;
  dedupeKey?: string | null;
  notify?: boolean;
  /* 0081: audit trail */
  driverId?: string | null;
  vehicleId?: string | null;
  field?: string | null;
  oldValue?: string | null;
  newValue?: string | null;
  actorUserId?: string | null;
};

type EventTrip = Pick<LiveTrip, "id" | "owner_id" | "trip_seq" | "vehicle_no"> & {
  driver_id?: string | null;
  vehicle_id?: string | null;
};

/** Notification switches on the Live profile (0081). Missing row = both on. */
async function wantsNotify(ownerId: string, kind: string): Promise<boolean> {
  const { data, error } = await admin()
    .from("live_profiles")
    .select("notify_status,notify_alerts")
    .eq("owner_id", ownerId)
    .maybeSingle<{ notify_status: boolean; notify_alerts: boolean }>();
  if (error || !data) return true;
  return kind === "status" ? data.notify_status : data.notify_alerts;
}

const clip = (v: string | null | undefined, n: number) => (v == null ? null : String(v).slice(0, n));

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Push + Telegram to the workspace owner. Never throws. */
export async function notifyOwner(ownerId: string, payload: { title: string; body: string; url: string; tag: string }) {
  try {
    const [push, tg] = await Promise.all([
      sendPushToUser(ownerId, payload),
      admin()
        .from("telegram_configs")
        .select("chat_id, bot_token, is_enabled")
        .eq("user_id", ownerId)
        .maybeSingle<{ chat_id: string | null; bot_token: string | null; is_enabled: boolean }>(),
    ]);
    if (tg.data?.is_enabled && tg.data.chat_id) {
      await sendTelegramMessage({
        chatId: tg.data.chat_id,
        botToken: tg.data.bot_token,
        text: [`<b>${escapeHtml(payload.title)}</b>`, escapeHtml(payload.body), "", `${env.siteUrl}${payload.url}`].join("\n"),
      });
    }
    return push.ok;
  } catch (error) {
    console.error("live notify failed:", (error as Error).message);
    return false;
  }
}

/** Inserts an event; returns false when the dedupe key was already used. */
export async function recordEvent(trip: EventTrip, e: EventInput): Promise<boolean> {
  const row: Record<string, unknown> = {
    trip_id: trip.id,
    owner_id: trip.owner_id,
    kind: e.kind,
    title: e.title.slice(0, 200),
    detail: e.detail ? e.detail.slice(0, 1000) : null,
    actor: e.actor ?? "system",
    lat: e.lat ?? null,
    lng: e.lng ?? null,
    dedupe_key: e.dedupeKey ?? null,
    notified: Boolean(e.notify),
  };
  // 0081 columns only when there is something to put in them, so a trip event
  // still saves on a database without 0081.
  const driverId = e.driverId !== undefined ? e.driverId : (trip.driver_id ?? null);
  const vehicleId = e.vehicleId !== undefined ? e.vehicleId : (trip.vehicle_id ?? null);
  if (driverId) row.driver_id = driverId;
  if (vehicleId) row.vehicle_id = vehicleId;
  if (e.field) {
    row.field = e.field.slice(0, 40);
    row.old_value = clip(e.oldValue, 300);
    row.new_value = clip(e.newValue, 300);
  }
  if (e.actorUserId) row.actor_user_id = e.actorUserId;
  let { error } = await admin().from("live_trip_events").insert(row);
  if (error && isMissingRelation(error)) {
    // Database without 0081 yet: save the plain 0079 row.
    for (const k of ["driver_id", "vehicle_id", "field", "old_value", "new_value", "actor_user_id"]) delete row[k];
    ({ error } = await admin().from("live_trip_events").insert(row));
  }
  if (error) {
    if ((error as { code?: string }).code === "23505") return false;
    logLive("event", error);
    return false;
  }
  if (e.notify && (await wantsNotify(trip.owner_id, e.kind))) {
    const truck = prettyVehicle(trip.vehicle_no);
    await notifyOwner(trip.owner_id, {
      title: `${tripNo(trip.trip_seq)}${truck ? ` · ${truck}` : ""}: ${e.title}`,
      body: e.detail ?? e.title,
      url: `/live/trips/${trip.id}`,
      tag: `live-${trip.id}-${e.kind}`,
    });
  }
  return true;
}

/**
 * A driver-level activity row (sharing started/stopped, location gap, truck
 * assigned...). trip is set when the driver is on one, so the trip log shows it too.
 */
export async function recordDriverEvent(
  driver: { id: string; owner_id: string; name?: string | null },
  e: EventInput,
  trip?: EventTrip | null,
): Promise<boolean> {
  if (trip) return recordEvent(trip, { ...e, driverId: driver.id });
  const { error } = await admin()
    .from("live_trip_events")
    .insert({
      trip_id: null,
      owner_id: driver.owner_id,
      driver_id: driver.id,
      vehicle_id: e.vehicleId ?? null,
      kind: e.kind,
      title: e.title.slice(0, 200),
      detail: e.detail ? e.detail.slice(0, 1000) : null,
      actor: e.actor ?? "system",
      lat: e.lat ?? null,
      lng: e.lng ?? null,
      dedupe_key: e.dedupeKey ?? null,
      field: e.field ?? null,
      old_value: clip(e.oldValue, 300),
      new_value: clip(e.newValue, 300),
      actor_user_id: e.actorUserId ?? null,
      notified: false,
    });
  if (error) {
    if ((error as { code?: string }).code === "23505") return false;
    logLive("driver event", error);
    return false;
  }
  return true;
}

/**
 * A trip just closed (delivered / cancelled). A ONE-TIME driver's sharing
 * ends N hours later (Live profile, default 1) and his truck is released.
 * An own driver keeps sharing until he stops it himself.
 */
export async function afterTripClosed(trip: LiveTrip): Promise<void> {
  if (!trip.driver_id) return;
  const db = admin();
  const { data: driver, error } = await db
    .from("live_drivers")
    .select("id,owner_id,kind")
    .eq("id", trip.driver_id)
    .maybeSingle<{ id: string; owner_id: string; kind: string }>();
  if (error || !driver || driver.kind !== "one_time") return;
  const { data: prof } = await db
    .from("live_profiles")
    .select("one_time_expire_hours")
    .eq("owner_id", trip.owner_id)
    .maybeSingle<{ one_time_expire_hours: number }>();
  const hours = Math.min(72, Math.max(1, prof?.one_time_expire_hours ?? 1));
  const until = new Date(Date.now() + hours * 3_600_000).toISOString();
  await db.from("live_drivers").update({ share_expires_at: until, updated_at: new Date().toISOString() }).eq("id", driver.id);
  await db
    .from("live_assignments")
    .update({ ended_at: new Date().toISOString(), ended_reason: "trip closed (trip-only driver)", actor: "system" })
    .eq("driver_id", driver.id)
    .is("ended_at", null);
  await recordDriverEvent(driver, {
    kind: "share",
    title: `Sharing will end at ${fmtIst(until)} (trip-only driver, trip ${tripNo(trip.trip_seq)} closed)`,
    actor: "system",
  });
}

/** A closed trip was reopened: a one-time driver's countdown is cancelled. */
async function afterTripReopened(trip: LiveTrip): Promise<void> {
  if (!trip.driver_id) return;
  await admin()
    .from("live_drivers")
    .update({ share_expires_at: null })
    .eq("id", trip.driver_id)
    .eq("kind", "one_time")
    .neq("share_status", "expired");
}

/** Timestamps that go with each status. */
export function statusPatch(status: TripStatus, nowIso: string, trip?: Pick<LiveTrip, "started_at">): Record<string, unknown> {
  const p: Record<string, unknown> = { status, status_at: nowIso, updated_at: nowIso };
  if (status === "in_transit" && !trip?.started_at) p.started_at = nowIso;
  if (status === "arrived") p.arrived_at = nowIso;
  if (status === "delivered") p.delivered_at = nowIso;
  if (status === "cancelled") p.cancelled_at = nowIso;
  if (status === "planned") {
    p.cancelled_at = null;
  }
  return p;
}

/**
 * Moves a trip to a status (any actor), records the event and - for the ones
 * the owner cares about when they did not do it themselves - notifies.
 * Conditional on the current status, so two racing callers cannot both move it.
 */
export async function changeStatus(
  trip: LiveTrip,
  to: TripStatus,
  actor: "owner" | "driver" | "system",
  detail?: string | null,
  at?: { lat: number; lng: number } | null,
): Promise<boolean> {
  if (trip.status === to) return true;
  const nowIso = new Date().toISOString();
  const { data, error } = await admin()
    .from("live_trips")
    .update(statusPatch(to, nowIso, trip))
    .eq("id", trip.id)
    .eq("status", trip.status)
    .select("id");
  if (error) {
    logLive("status", error);
    return false;
  }
  if (!data || data.length === 0) return false;
  const who = actor === "driver" ? "Driver" : actor === "system" ? "Auto" : "You";
  await recordEvent(trip, {
    kind: "status",
    title: `${STATUS_LABEL[to]}${actor === "owner" ? "" : ` (${who.toLowerCase()})`}`,
    detail: detail ?? `${who} marked the trip ${STATUS_LABEL[to].toLowerCase()}.`,
    actor,
    lat: at?.lat ?? null,
    lng: at?.lng ?? null,
    notify: actor !== "owner" && ["in_transit", "arrived", "delivered"].includes(to),
  });
  const wasClosed = trip.status === "delivered" || trip.status === "cancelled";
  trip.status = to;
  if (to === "delivered" || to === "cancelled") await afterTripClosed(trip);
  else if (wasClosed) await afterTripReopened(trip);
  return true;
}

/* -------------------------------------------------------------------------- */
/* the rules                                                                   */
/* -------------------------------------------------------------------------- */

function inside(p: { lat: number; lng: number }, place: LivePlace | null | undefined, extraM = 0): boolean {
  if (!place || place.lat == null || place.lng == null) return false;
  return metersBetween(p, { lat: place.lat, lng: place.lng }) <= place.radius_m + extraM;
}

/**
 * Evaluates one open trip. `points` newest first (the recent trail). Updates
 * the cached position/ETA and records whatever events the rules produce.
 */
export async function evaluateTrip(trip: LiveTrip, places: Map<string, LivePlace>, points: Point[], now = Date.now()) {
  if (!OPEN_STATUSES.includes(trip.status)) return;
  // 0082: a receiving trip's origin is typed on the trip (no saved place) - use it as a 500 m geofence.
  const from =
    (trip.from_place_id ? places.get(trip.from_place_id) : null) ??
    (trip.from_lat != null && trip.from_lng != null
      ? ({ id: `trip-${trip.id}`, name: trip.from_name || trip.party_name || "pickup point", lat: trip.from_lat, lng: trip.from_lng, radius_m: 500 } as LivePlace)
      : null);
  const to = trip.to_place_id ? places.get(trip.to_place_id) : null;
  const latest = points[0] ?? null;
  const nowIso = new Date(now).toISOString();
  const patch: Record<string, unknown> = {};

  if (latest) {
    const here = { lat: latest.lat, lng: latest.lng };
    patch.last_lat = latest.lat;
    patch.last_lng = latest.lng;
    patch.last_speed_kmh = latest.speed_kmh;
    patch.last_point_at = latest.recorded_at;

    // 1. Geofence at the origin: inside -> loading (if planned); left after being inside -> in transit.
    if (from && (trip.status === "planned" || trip.status === "loading")) {
      if (inside(here, from)) {
        if (!trip.seen_at_origin_at) {
          patch.seen_at_origin_at = nowIso;
          trip.seen_at_origin_at = nowIso;
          await recordEvent(trip, {
            kind: "geofence_enter",
            title: `Reached ${from.name}`,
            detail: "Truck is at the loading point.",
            lat: here.lat,
            lng: here.lng,
            dedupeKey: `enter-from:${from.id}`,
          });
          if (trip.status === "planned") await changeStatus(trip, "loading", "system", `Truck reached ${from.name} - loading.`, here);
        }
      } else if (trip.seen_at_origin_at && !inside(here, from, 200)) {
        await recordEvent(trip, {
          kind: "geofence_exit",
          title: `Left ${from.name}`,
          lat: here.lat,
          lng: here.lng,
          dedupeKey: `exit-from:${from.id}`,
        });
        await changeStatus(trip, "in_transit", "system", `Truck left ${from.name} - trip started.`, here);
      }
    }

    // 2. Geofence at the destination -> arrived.
    if (to && ["planned", "loading", "in_transit"].includes(trip.status) && inside(here, to)) {
      await recordEvent(trip, {
        kind: "geofence_enter",
        title: `Reached ${to.name}`,
        lat: here.lat,
        lng: here.lng,
        dedupeKey: `enter-to:${to.id}`,
      });
      await changeStatus(trip, "arrived", "system", `Truck reached ${to.name}.`, here);
    }

    // 3. Distance left and ETA.
    const dest = destinationPoint(trip, to);
    if (dest) {
      const km = roadKm(here, dest);
      const eta = etaFrom(km, recentAvgKmph(points, now), now);
      patch.distance_left_km = Math.round(km * 10) / 10;
      patch.eta_at = trip.status === "arrived" ? null : eta.toISOString();

      // 4. Delay risk: ETA later than the promise.
      if (trip.status === "in_transit" && trip.promised_delivery_at) {
        const promised = new Date(trip.promised_delivery_at).getTime();
        if (eta.getTime() > promised + DELAY_GRACE_MS) {
          await recordEvent(trip, {
            kind: "delay",
            title: "Likely late",
            detail: `About ${Math.round(km)} km left; expected ${fmtIst(eta.toISOString())}, promised ${fmtIst(trip.promised_delivery_at)}.`,
            lat: here.lat,
            lng: here.lng,
            dedupeKey: `delay:${trip.promised_delivery_at}`,
            notify: true,
          });
        }
      }
    }

    // 5. Stoppage: standing within 300 m for 30+ min, not at a known place.
    if (trip.status === "in_transit" && now - new Date(latest.recorded_at).getTime() < NO_SIGNAL_MS) {
      let anchor = latest;
      for (const p of points) {
        if (metersBetween(p, latest) > STOPPAGE_RADIUS_M) break;
        anchor = p;
      }
      const stoodMs = new Date(latest.recorded_at).getTime() - new Date(anchor.recorded_at).getTime();
      const atKnownPlace = [...places.values()].some((pl) => inside(here, pl));
      if (stoodMs >= STOPPAGE_MS && !atKnownPlace) {
        await recordEvent(trip, {
          kind: "stoppage",
          title: `Stopped for ${Math.round(stoodMs / 60000)} min`,
          detail: `Standing since ${fmtIst(anchor.recorded_at)}, not at any saved place.`,
          lat: here.lat,
          lng: here.lng,
          dedupeKey: `stop:${anchor.recorded_at.slice(0, 16)}`,
          notify: true,
        });
      }
    }
  }

  await timeRules(trip, now);

  if (Object.keys(patch).length) {
    patch.updated_at = nowIso;
    const { error } = await admin().from("live_trips").update(patch).eq("id", trip.id);
    if (error) logLive("trip cache", error);
  }
}

/** Rules that need only the clock: e-way bill, no signal. */
async function timeRules(trip: LiveTrip, now: number) {
  const moving = trip.status === "loading" || trip.status === "in_transit";
  if (moving && trip.eway_valid_until) {
    const left = new Date(trip.eway_valid_until).getTime() - now;
    if (left <= 0) {
      await recordEvent(trip, {
        kind: "eway_expired",
        title: "E-way bill expired",
        detail: `Valid till ${fmtIst(trip.eway_valid_until)}. Extend it on the e-way bill portal before the truck is stopped.`,
        dedupeKey: `ewayx:${trip.eway_valid_until}`,
        notify: true,
      });
    } else if (left <= EWAY_WARN_MS) {
      await recordEvent(trip, {
        kind: "eway_expiring",
        title: `E-way bill expires in ${Math.max(1, Math.round(left / 3_600_000))} h`,
        detail: `Valid till ${fmtIst(trip.eway_valid_until)}${trip.distance_left_km != null ? `, about ${Math.round(trip.distance_left_km)} km still to go` : ""}. Extend it if needed.`,
        dedupeKey: `eway6:${trip.eway_valid_until}`,
        notify: true,
      });
    }
  }

  if (trip.status === "in_transit" && trip.share_status === "active") {
    const last = new Date(trip.share_last_seen_at ?? trip.last_point_at ?? 0).getTime();
    if (last > 0 && now - last > NO_SIGNAL_MS) {
      const key = (trip.share_last_seen_at ?? trip.last_point_at ?? "").slice(0, 16);
      await recordEvent(trip, {
        kind: "no_signal",
        title: "No location for 30+ min",
        detail: `Last heard ${fmtIst(trip.share_last_seen_at ?? trip.last_point_at)}. The driver's page may be closed or the phone has no network. Call the driver.`,
        dedupeKey: `nosig:${key}`,
        notify: true,
      });
    }
  }
}

/**
 * Called after a driver report. Loads what the rules need and evaluates.
 */
export async function evaluateAfterReport(tripId: string) {
  try {
    const { data: trip } = await admin().from("live_trips").select("*").eq("id", tripId).maybeSingle<LiveTrip>();
    if (!trip || !OPEN_STATUSES.includes(trip.status)) return;
    const [{ data: places }, points] = await Promise.all([
      admin().from("live_places").select("*").eq("owner_id", trip.owner_id).is("archived_at", null).limit(500),
      loadTrail(trip.id, 3 * 60 * 60 * 1000, 400),
    ]);
    const map = new Map(((places ?? []) as LivePlace[]).map((p) => [p.id, p]));
    await evaluateTrip(trip, map, points);
  } catch (error) {
    console.error("live evaluate failed:", (error as Error).message);
  }
}

/**
 * The cron tick: time-only rules for every open trip on the platform. Light -
 * one read of open trips, no positions. Never throws.
 */
export async function runLiveSweep(): Promise<{ trips: number } | { skipped: string }> {
  try {
    const { data, error } = await admin()
      .from("live_trips")
      .select("*")
      .in("status", ["loading", "in_transit"])
      .limit(2000);
    if (error) {
      logLive("sweep", error);
      return { skipped: "unavailable" };
    }
    const trips = (data ?? []) as LiveTrip[];
    const now = Date.now();
    for (const trip of trips) await timeRules(trip, now);
    await driverSweep(now);
    return { trips: trips.length };
  } catch (error) {
    console.error("live sweep failed:", (error as Error).message);
    return { skipped: "error" };
  }
}

/**
 * 0081 driver rules, from the cron tick:
 *   - one-time drivers whose share_expires_at passed -> "expired" (link stops);
 *   - a driver sharing with no position for 30+ min gets ONE "no signal" row
 *     in his activity (phone off / no network / page closed). The trip rule
 *     above is the one that notifies.
 */
async function driverSweep(now: number) {
  const db = admin();
  const nowIso = new Date(now).toISOString();
  const { data: expired, error } = await db
    .from("live_drivers")
    .update({ share_status: "expired", updated_at: nowIso })
    .lt("share_expires_at", nowIso)
    .in("share_status", ["invited", "active", "stopped"])
    .select("id,owner_id");
  if (error) {
    logLive("driver expiry", error);
    return;
  }
  for (const d of (expired ?? []) as { id: string; owner_id: string }[]) {
    await recordDriverEvent(d, { kind: "share", title: "Sharing ended (trip-only driver, trip done)", actor: "system" });
  }

  const cutoff = new Date(now - NO_SIGNAL_MS).toISOString();
  const { data: quiet } = await db
    .from("live_drivers")
    .select("id,owner_id,share_last_seen_at")
    .eq("share_status", "active")
    .is("archived_at", null)
    .lt("share_last_seen_at", cutoff)
    .gt("share_last_seen_at", new Date(now - 24 * 3_600_000).toISOString())
    .limit(2000);
  for (const d of (quiet ?? []) as { id: string; owner_id: string; share_last_seen_at: string }[]) {
    await recordDriverEvent(d, {
      kind: "no_signal",
      title: "No location for 30+ min",
      detail: `Last heard ${fmtIst(d.share_last_seen_at)}. Phone off, no network, or the page was closed.`,
      dedupeKey: `nosig:${d.share_last_seen_at.slice(0, 16)}`,
    });
  }
}
