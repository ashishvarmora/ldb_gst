import "server-only";

import type { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Saved trucks (0066): a customer's own list of up to SAVED_LIMIT numbers to
 * check by hand. Not tracking - nothing here runs on its own, nothing needs a
 * plan, and every check is an ordinary manual search.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

export const SAVED_LIMIT = 25;

export type SavedTruck = {
  truck_number: string;
  label: string | null;
  created_at: string;
  last_checked_at: string | null;
  last_ok: boolean | null;
  last_found: number | null;
  last_new: number | null;
  last_error: string | null;
  last_plaza: string | null;
  last_event_at: string | null;
  last_direction: string | null;
};

export async function loadSavedTrucks(admin: Admin, userId: string): Promise<SavedTruck[]> {
  const { data, error } = await admin
    .from("saved_trucks")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(SAVED_LIMIT);
  if (error) {
    console.error("saved trucks: read failed", error.message);
    return [];
  }
  return (data ?? []) as SavedTruck[];
}

export async function countSavedTrucks(admin: Admin, userId: string): Promise<number> {
  const { count } = await admin
    .from("saved_trucks")
    .select("truck_number", { count: "exact", head: true })
    .eq("user_id", userId);
  return count ?? 0;
}

export async function isTruckSaved(admin: Admin, userId: string, truckNumber: string): Promise<boolean> {
  const { data } = await admin
    .from("saved_trucks")
    .select("truck_number")
    .eq("user_id", userId)
    .eq("truck_number", truckNumber)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Called by every manual lookup, from the search box, "Check again" or the
 * saved list itself: if the number is saved, its row remembers the outcome so
 * the list can show it without another query. A no-op when it is not saved.
 */
export async function recordSavedLookup(
  admin: Admin,
  userId: string,
  truckNumber: string,
  outcome:
    | {
        ok: true;
        found: number;
        newCount: number;
        newest: { locName: string | null; eventTime: string | null; direction: string | null } | null;
      }
    | { ok: false; error: string },
): Promise<void> {
  const patch = outcome.ok
    ? {
        last_checked_at: new Date().toISOString(),
        last_ok: true,
        last_found: outcome.found,
        last_new: outcome.newCount,
        last_error: null,
        // Keep the previous "last seen" when this check found nothing new to say.
        ...(outcome.newest
          ? {
              last_plaza: outcome.newest.locName,
              last_event_at: outcome.newest.eventTime,
              last_direction: outcome.newest.direction,
            }
          : {}),
      }
    : {
        last_checked_at: new Date().toISOString(),
        last_ok: false,
        last_error: outcome.error.slice(0, 200),
      };

  const { error } = await admin
    .from("saved_trucks")
    .update(patch)
    .eq("user_id", userId)
    .eq("truck_number", truckNumber);
  if (error) console.error("saved trucks: could not record a lookup", error.message);
}
