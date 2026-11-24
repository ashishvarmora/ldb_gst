"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";

import { reportError } from "@/lib/errors";
import { done, fail, str } from "@/lib/forms";
import { assertPortalUser } from "@/lib/officer";
import { findPlace } from "@/lib/places";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { recordTruckActivity } from "@/lib/truck-activity";
import type { ActionResult } from "@/lib/types";

/*
 * Destination and trip links (owner, 24 Nov 2026) - see migration 0077.
 * Kept apart from actions.ts so the truck's tracking/alert actions stay as
 * they were. Nothing here costs credits or sends a message.
 */

/** How long a new trip link works. The table default says the same. */
const SHARE_DAYS = 7;

const NOT_READY = "This is not switched on yet. Please try again later.";

async function ownTruck(truckId: string, userId: string) {
  const { data } = await getSupabaseAdmin()
    .from("tracked_trucks")
    .select("id, truck_number")
    .eq("id", truckId)
    .eq("user_id", userId)
    .maybeSingle<{ id: string; truck_number: string }>();
  return data ?? null;
}

function refresh(truckId: string) {
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);
}

/** A missing column / table means 0077 is not applied yet. */
function notMigrated(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    error.code === "42P01" ||
    error.code === "PGRST204" ||
    error.code === "PGRST205" ||
    /destination_|truck_shares/.test(error.message ?? "")
  );
}

/**
 * Sets (or, with an empty box, clears) where the truck is heading. The name
 * must be one the picker offered: a town from src/lib/places.ts or a toll
 * plaza with a known position.
 */
export async function setTruckDestination(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Something went wrong. Refresh the page and try again.");
  const truck = await ownTruck(truckId, session.id);
  if (!truck) return fail("That truck is not on your list.");

  const typed = (str(fd, "destination") ?? "").slice(0, 120);

  let destination: { name: string; lat: number; lng: number } | null = null;
  if (typed) {
    const place = findPlace(typed);
    if (place) {
      destination = { name: place.name, lat: place.lat, lng: place.lng };
    } else {
      const { data: plaza } = await admin
        .from("toll_plazas")
        .select("name, lat, lng")
        .ilike("name", typed.replace(/[%_\\]/g, (c) => `\\${c}`))
        .not("lat", "is", null)
        .not("lng", "is", null)
        .limit(1)
        .maybeSingle<{ name: string; lat: number; lng: number }>();
      if (plaza) destination = { name: plaza.name, lat: plaza.lat, lng: plaza.lng };
    }
    if (!destination) {
      return fail(`"${typed}" is not in the list. Start typing and pick a town, port or toll plaza from the suggestions.`);
    }
  }

  const { error } = await admin
    .from("tracked_trucks")
    .update({
      destination_name: destination?.name ?? null,
      destination_lat: destination?.lat ?? null,
      destination_lng: destination?.lng ?? null,
      destination_set_at: destination ? new Date().toISOString() : null,
    })
    .eq("id", truck.id)
    .eq("user_id", session.id);

  if (error) {
    if (notMigrated(error)) return fail(NOT_READY);
    return fail(reportError("saving a truck destination", error, "Could not save the destination."));
  }

  await recordTruckActivity({
    userId: session.id,
    truckId: truck.id,
    truckNumber: truck.truck_number,
    kind: "settings_changed",
    detail: { changes: [destination ? `destination set to ${destination.name}` : "destination removed"] },
  });

  refresh(truck.id);
  return done(destination ? `Destination set to ${destination.name}.` : "Destination removed.");
}

/**
 * Makes the public trip link, or keeps the one that is already live - one
 * working link per truck is plenty, and tapping twice should not make two.
 */
export async function createTripShare(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Something went wrong. Refresh the page and try again.");
  const truck = await ownTruck(truckId, session.id);
  if (!truck) return fail("That truck is not on your list.");

  const now = new Date();
  const { data: live, error: readError } = await admin
    .from("truck_shares")
    .select("token")
    .eq("tracked_truck_id", truck.id)
    .eq("user_id", session.id)
    .is("revoked_at", null)
    .gt("expires_at", now.toISOString())
    .limit(1);

  if (readError) {
    if (notMigrated(readError)) return fail(NOT_READY);
    return fail(reportError("reading trip links", readError, "Could not make the link."));
  }
  if ((live ?? []).length > 0) {
    refresh(truck.id);
    return done("Link ready.");
  }

  const { error } = await admin.from("truck_shares").insert({
    token: randomBytes(12).toString("base64url"),
    tracked_truck_id: truck.id,
    user_id: session.id,
    expires_at: new Date(now.getTime() + SHARE_DAYS * 86_400_000).toISOString(),
  });

  if (error) {
    if (notMigrated(error)) return fail(NOT_READY);
    return fail(reportError("creating a trip link", error, "Could not make the link."));
  }

  await recordTruckActivity({
    userId: session.id,
    truckId: truck.id,
    truckNumber: truck.truck_number,
    kind: "settings_changed",
    detail: { changes: ["trip link shared"] },
  });

  refresh(truck.id);
  return done("Link ready.");
}

/** Stops every live link for this truck at once. */
export async function revokeTripShare(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Something went wrong. Refresh the page and try again.");
  const truck = await ownTruck(truckId, session.id);
  if (!truck) return fail("That truck is not on your list.");

  const { error } = await admin
    .from("truck_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tracked_truck_id", truck.id)
    .eq("user_id", session.id)
    .is("revoked_at", null);

  if (error) {
    if (notMigrated(error)) return fail(NOT_READY);
    return fail(reportError("revoking a trip link", error, "Could not stop the link."));
  }

  await recordTruckActivity({
    userId: session.id,
    truckId: truck.id,
    truckNumber: truck.truck_number,
    kind: "settings_changed",
    detail: { changes: ["trip link stopped"] },
  });

  refresh(truck.id);
  return done("Link stopped. Anyone who opens it now sees that it has ended.");
}
