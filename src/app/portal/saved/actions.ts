"use server";

import { revalidatePath } from "next/cache";

import { looksLikeTruckNumber, normalizeTruck } from "@/lib/forms";
import { runManualLookup } from "@/lib/manual-search";
import { assertPortalUser } from "@/lib/officer";
import { rateLimit, rateLimitMessage } from "@/lib/ratelimit";
import { SAVED_LIMIT, type SavedTruck } from "@/lib/saved-trucks";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Saved trucks (0066). Called straight from client components with plain
 * arguments - a star, a remove button, a "Check now" - so each returns a small
 * result the button can show without a page reload.
 */

export type SavedResult = { ok: true; message?: string } | { ok: false; error: string };

function refresh() {
  revalidatePath("/portal/saved");
  revalidatePath("/portal/search");
  revalidatePath("/portal", "layout");
}

/** Saves the number, or removes it when already saved. */
export async function toggleSavedTruck(rawNumber: string): Promise<SavedResult & { saved?: boolean }> {
  const session = await assertPortalUser();
  const truckNumber = normalizeTruck(rawNumber ?? "");
  if (!looksLikeTruckNumber(truckNumber)) return { ok: false, error: "That is not a truck number." };

  const admin = getSupabaseAdmin();
  const { data: removed } = await admin
    .from("saved_trucks")
    .delete()
    .eq("user_id", session.id)
    .eq("truck_number", truckNumber)
    .select("truck_number");

  if ((removed ?? []).length > 0) {
    refresh();
    return { ok: true, saved: false, message: `${truckNumber} removed from Saved trucks.` };
  }

  /*
   * Saved straight after a search is the common case, so the row starts with
   * what that search already found rather than "Not checked yet".
   */
  const [{ data: lastLog }, { data: newest }] = await Promise.all([
    admin
      .from("search_logs")
      .select("created_at, ok, events_found, new_events, error")
      .eq("user_id", session.id)
      .eq("truck_number", truckNumber)
      .eq("source", "manual")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ created_at: string; ok: boolean; events_found: number; new_events: number; error: string | null }>(),
    admin
      .from("truck_events")
      .select("loc_name, event_time, direction")
      .eq("user_id", session.id)
      .eq("truck_number", truckNumber)
      .order("event_time", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle<{ loc_name: string | null; event_time: string | null; direction: string | null }>(),
  ]);

  const { error } = await admin.from("saved_trucks").insert({
    user_id: session.id,
    truck_number: truckNumber,
    ...(lastLog
      ? {
          last_checked_at: lastLog.created_at,
          last_ok: lastLog.ok,
          last_found: lastLog.events_found,
          last_new: lastLog.new_events,
          last_error: lastLog.error,
        }
      : {}),
    ...(newest
      ? { last_plaza: newest.loc_name, last_event_at: newest.event_time, last_direction: newest.direction }
      : {}),
  });
  if (error) {
    if (/saved_trucks_full/.test(error.message)) {
      return {
        ok: false,
        error: `Saved trucks is full (${SAVED_LIMIT}). Remove one you no longer need, then save this one.`,
      };
    }
    console.error("save truck failed:", error.message);
    return { ok: false, error: "Could not save that truck just now. Please try again." };
  }
  refresh();
  return { ok: true, saved: true, message: `${truckNumber} saved.` };
}

export async function removeSavedTruck(rawNumber: string): Promise<SavedResult> {
  const session = await assertPortalUser();
  const truckNumber = normalizeTruck(rawNumber ?? "");
  const { error } = await getSupabaseAdmin()
    .from("saved_trucks")
    .delete()
    .eq("user_id", session.id)
    .eq("truck_number", truckNumber);
  if (error) return { ok: false, error: "Could not remove it just now. Please try again." };
  refresh();
  return { ok: true, message: `${truckNumber} removed.` };
}

export async function renameSavedTruck(rawNumber: string, label: string): Promise<SavedResult> {
  const session = await assertPortalUser();
  const truckNumber = normalizeTruck(rawNumber ?? "");
  const clean = (label ?? "").trim().slice(0, 40);
  const { error } = await getSupabaseAdmin()
    .from("saved_trucks")
    .update({ label: clean || null })
    .eq("user_id", session.id)
    .eq("truck_number", truckNumber);
  if (error) return { ok: false, error: "Could not rename it just now." };
  refresh();
  return { ok: true, message: clean ? `Named “${clean}”.` : "Name removed." };
}

/**
 * "Check now" from the saved list: an ordinary manual search (1 credit,
 * refunded on failure), answered in place. Returns the updated row so the list
 * changes without a reload.
 */
export async function checkSavedTruck(
  rawNumber: string,
): Promise<(SavedResult & { row?: SavedTruck }) | { ok: false; error: string }> {
  const session = await assertPortalUser();
  const truckNumber = normalizeTruck(rawNumber ?? "");
  if (!looksLikeTruckNumber(truckNumber)) return { ok: false, error: "That is not a truck number." };

  const throttle = await rateLimit("search:user", session.id);
  if (!throttle.allowed) return { ok: false, error: rateLimitMessage(throttle, "searches at once") };

  const result = await runManualLookup({ userId: session.id, truckNumber });

  const { data: row } = await getSupabaseAdmin()
    .from("saved_trucks")
    .select("*")
    .eq("user_id", session.id)
    .eq("truck_number", truckNumber)
    .maybeSingle<SavedTruck>();

  revalidatePath("/portal", "layout");
  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    row: row ?? undefined,
    message:
      result.found === 0
        ? "No crossings on record."
        : result.newCount > 0
          ? `${result.newCount} new crossing${result.newCount === 1 ? "" : "s"}.`
          : "No new crossing since last time.",
  };
}
