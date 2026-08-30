"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { intervalWords } from "@/lib/alerts";
import { bool, done, fail, int, looksLikeTruckNumber, normalizeTruck, str } from "@/lib/forms";
import { runManualLookup } from "@/lib/manual-search";
import { assertPortalUser, loadOverview, truckSlotsLeft } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, TrackedTruck } from "@/lib/types";

async function resolveFloor(userId: string): Promise<number> {
  const admin = getSupabaseAdmin();
  const [overview, settings] = await Promise.all([loadOverview(userId), loadSettings(admin)]);
  return Math.max(overview?.min_polling_interval_minutes ?? 60, settings.globalPollingFloor);
}

export async function addTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const raw = str(fd, "truck_number");
  if (!raw) return fail("Enter a truck number.");

  const truckNumber = normalizeTruck(raw);
  if (!looksLikeTruckNumber(truckNumber)) {
    return fail(`"${truckNumber}" does not look like a registration number. Example: GJ02AT8546`);
  }

  const overview = await loadOverview(session.id);
  if (!overview) return fail("Could not read your account. Sign in again.");
  if (!overview.plan_id) {
    return fail("No plan is assigned to your account yet. Ask your administrator to assign one.");
  }

  const { data: existing } = await admin
    .from("tracked_trucks")
    .select("id, is_active")
    .eq("user_id", session.id)
    .eq("truck_number", truckNumber)
    .maybeSingle();

  if (existing?.is_active) {
    return fail(`${truckNumber} is already under tracking.`);
  }

  if (truckSlotsLeft(overview) <= 0) {
    return fail(
      `Your plan allows ${overview.truck_limit} tracked truck${overview.truck_limit === 1 ? "" : "s"}. Pause or remove one first, or ask your administrator for more.`,
    );
  }

  const floor = await resolveFloor(session.id);
  const requested = int(fd, "polling_interval_minutes", { min: 1, max: 1440 }) ?? floor;
  const interval = Math.max(requested, floor);

  const payload = {
    user_id: session.id,
    truck_number: truckNumber,
    label: str(fd, "label"),
    polling_interval_minutes: interval,
    is_watchlist: bool(fd, "is_watchlist"),
    is_active: true,
  };

  // Re-activating a paused truck keeps its history instead of duplicating it.
  const { error } = existing
    ? await admin.from("tracked_trucks").update(payload).eq("id", existing.id)
    : await admin.from("tracked_trucks").insert(payload);

  if (error) return fail(error.message);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");

  return done(
    interval > requested
      ? `${truckNumber} added. Your plan's fastest interval is ${floor} min, so it will be checked every ${interval} min.`
      : `${truckNumber} added. First check happens on the next tracking run.`,
  );
}

export async function updateTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Missing truck id.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("*")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle<TrackedTruck>();

  if (!truck) return fail("That truck is not on your list.");

  const floor = await resolveFloor(session.id);
  const requested = int(fd, "polling_interval_minutes", { min: 1, max: 1440 });
  const interval = requested === null ? truck.polling_interval_minutes : Math.max(requested, floor);

  const activating = bool(fd, "is_active");
  if (activating && !truck.is_active) {
    const overview = await loadOverview(session.id);
    if (overview && truckSlotsLeft(overview) <= 0) {
      return fail(
        `Resuming this truck would exceed your limit of ${overview.truck_limit}. Pause another one first.`,
      );
    }
  }

  const { error } = await admin
    .from("tracked_trucks")
    .update({
      label: str(fd, "label"),
      polling_interval_minutes: interval,
      is_watchlist: bool(fd, "is_watchlist"),
      is_active: activating,
    })
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done(
    requested !== null && interval > requested
      ? `Saved. Your plan's fastest interval is ${floor} min, so ${interval} min was used.`
      : "Saved.",
  );
}

/** The two built-in alerts, switched on and timed for one truck at a time. */
export async function updateTruckAlerts(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Missing truck id.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("*")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle<TrackedTruck>();

  if (!truck) return fail("That truck is not on your list.");

  const overview = await loadOverview(session.id);
  if (!overview) return fail("Could not read your account. Sign in again.");
  if (!overview.alerts_enabled) {
    return fail("Alerts are not enabled on your plan. Ask your administrator.");
  }

  const floor = overview.min_alert_interval_minutes;
  const locationRequested = int(fd, "location_alert_minutes", { min: 1, max: 10080 });
  const movementRequested = int(fd, "movement_alert_minutes", { min: 1, max: 10080 });
  const locationMinutes =
    locationRequested === null ? truck.location_alert_minutes : Math.max(locationRequested, floor);
  const movementMinutes =
    movementRequested === null ? truck.movement_alert_minutes : Math.max(movementRequested, floor);

  const locationOn = bool(fd, "location_alert_enabled");
  const movementOn = bool(fd, "movement_alert_enabled");

  // Switching the change alert on takes the truck's current plaza as the
  // baseline, so it does not immediately fire an alert for a move the officer
  // already knows about.
  const seedBaseline = movementOn && !truck.movement_alert_enabled;

  const { error } = await admin
    .from("tracked_trucks")
    .update({
      location_alert_enabled: locationOn,
      location_alert_minutes: locationMinutes,
      movement_alert_enabled: movementOn,
      movement_alert_minutes: movementMinutes,
      ...(seedBaseline
        ? { movement_alert_last_location: truck.last_location, movement_alert_last_at: null }
        : {}),
    })
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  const on: string[] = [];
  if (locationOn) on.push(`Location every ${intervalWords(locationMinutes)}`);
  if (movementOn) on.push(`Changes every ${intervalWords(movementMinutes)}`);
  const summary = on.length === 0 ? "Alerts saved. Both are off." : `Alerts saved. ${on.join(". ")}.`;

  const raised =
    (locationRequested !== null && locationMinutes > locationRequested) ||
    (movementRequested !== null && movementMinutes > movementRequested);

  return done(
    raised
      ? `${summary} Your plan's fastest alert interval is ${floor} min, so that was used.`
      : summary,
  );
}

export async function setTruckPaused(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  const active = fd.get("is_active") === "true";
  if (!truckId) return fail("Missing truck id.");

  if (active) {
    const overview = await loadOverview(session.id);
    if (overview && truckSlotsLeft(overview) <= 0) {
      return fail(
        `Resuming would exceed your limit of ${overview.truck_limit} tracked trucks. Pause another one first.`,
      );
    }
  }

  const { error } = await admin
    .from("tracked_trucks")
    .update({ is_active: active })
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);
  return done(active ? "Tracking resumed." : "Tracking paused. No quota is used while paused.");
}

export async function toggleWatchlist(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  const watchlist = fd.get("is_watchlist") === "true";
  if (!truckId) return fail("Missing truck id.");

  const { error } = await admin
    .from("tracked_trucks")
    .update({ is_watchlist: watchlist })
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);
  return done(watchlist ? "Added to watchlist." : "Removed from watchlist.");
}

/** Officer-initiated re-check. Spends a manual credit, same as a search. */
export async function checkTruckNow(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Missing truck id.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("truck_number")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle();

  if (!truck) return fail("That truck is not on your list.");

  const result = await runManualLookup({ userId: session.id, truckNumber: truck.truck_number });
  if (!result.ok) return fail(result.error);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done(
    result.newCount > 0
      ? `${result.newCount} new crossing${result.newCount === 1 ? "" : "s"} found.`
      : `No new crossings. The portal is showing ${result.found} recent crossing${result.found === 1 ? "" : "s"}.`,
  );
}

export async function removeTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  const keepHistory = bool(fd, "keep_history");
  if (!truckId) return fail("Missing truck id.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("truck_number")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle();

  if (!truck) return fail("That truck is not on your list.");

  const { error } = await admin
    .from("tracked_trucks")
    .delete()
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  if (!keepHistory) {
    await admin
      .from("truck_events")
      .delete()
      .eq("user_id", session.id)
      .eq("truck_number", truck.truck_number);
  }

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  redirect("/portal/trucks");
}
