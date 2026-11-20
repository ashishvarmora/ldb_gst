import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PausedReason } from "@/lib/types";

/**
 * Per-truck history (migration 0072): what the customer and the worker did to
 * a tracked truck. Crossings, alerts sent and charges are NOT copied here -
 * they already live in truck_events, alert_logs and credit_transactions, and
 * the truck page merges all four into one timeline.
 *
 * Every function here is safe to call before 0072 is applied: a write that
 * fails is logged and dropped, a read that fails returns an empty list. A
 * history line must never cost the customer the action it describes.
 */
export type TruckActivityKind =
  | "added"
  | "readded"
  | "alert_added"
  | "alert_edited"
  | "alert_removed"
  | "alert_on"
  | "alert_off"
  | "paused"
  | "live"
  | "auto_paused"
  | "manual_check"
  | "settings_changed"
  | "deleted";

export type TruckActivityDetail = {
  /** alert_*: the alert's catalogue name, and its cadence in words. */
  alert?: string;
  summary?: string;
  /** auto_paused: which stop fired; live: which pause it came back from. */
  reason?: PausedReason | null;
  /** auto_paused (inactive): the halt alert's pause window, in hours. */
  hours?: number;
  /** auto_paused (repeated_failures): failed checks in a row. */
  failures?: number;
  /** manual_check: what the toll network returned. */
  found?: number;
  newCrossings?: number;
  /** settings_changed: which settings, in words. */
  changes?: string[];
  /** deleted: whether it was being tracked when it was removed. */
  wasLive?: boolean;
};

export type TruckActivity = {
  id: number;
  user_id: string;
  tracked_truck_id: string | null;
  truck_number: string;
  kind: TruckActivityKind | string;
  detail: TruckActivityDetail;
  created_at: string;
};

export type TruckActivityInput = {
  userId: string;
  truckId: string | null;
  truckNumber: string;
  kind: TruckActivityKind;
  detail?: TruckActivityDetail;
  /** Defaults to now; the worker passes its sweep time so rows line up with the pause. */
  at?: string;
};

/* Said once per server instance, not once per write, while 0072 is missing. */
let warnedMissing = false;

/** Appends one or more rows. Never throws. */
export async function recordTruckActivity(
  input: TruckActivityInput | TruckActivityInput[],
  admin: SupabaseClient = getSupabaseAdmin(),
): Promise<void> {
  const rows = (Array.isArray(input) ? input : [input]).filter((row) => row.truckNumber);
  if (rows.length === 0) return;
  try {
    const { error } = await admin.from("truck_activity").insert(
      rows.map((row) => ({
        user_id: row.userId,
        tracked_truck_id: row.truckId,
        truck_number: row.truckNumber,
        kind: row.kind,
        detail: row.detail ?? {},
        ...(row.at ? { created_at: row.at } : {}),
      })),
    );
    if (error) logFailure("write", error);
  } catch (error) {
    logFailure("write", error);
  }
}

/** One truck's history, newest first. Empty on any failure. */
export async function loadTruckActivity(
  userId: string,
  truckNumber: string,
  limit = 40,
): Promise<TruckActivity[]> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("truck_activity")
      .select("id,user_id,tracked_truck_id,truck_number,kind,detail,created_at")
      .eq("user_id", userId)
      .eq("truck_number", truckNumber)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      logFailure("read", error);
      return [];
    }
    return (data ?? []) as TruckActivity[];
  } catch (error) {
    logFailure("read", error);
    return [];
  }
}

/** The account's removed trucks, newest first, for /portal/activity. */
export async function loadRemovedTrucks(userId: string, limit = 10): Promise<TruckActivity[]> {
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("truck_activity")
      .select("id,user_id,tracked_truck_id,truck_number,kind,detail,created_at")
      .eq("user_id", userId)
      .eq("kind", "deleted")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      logFailure("read", error);
      return [];
    }
    return (data ?? []) as TruckActivity[];
  } catch (error) {
    logFailure("read", error);
    return [];
  }
}

function logFailure(what: "read" | "write", error: unknown) {
  const message =
    typeof error === "object" && error && "message" in error
      ? String((error as { message: unknown }).message)
      : String(error);
  const code =
    typeof error === "object" && error && "code" in error
      ? String((error as { code: unknown }).code)
      : "";
  /* 42P01 from Postgres, PGRST205 from PostgREST: the table is not there yet. */
  const missing = code === "42P01" || code === "PGRST205" || /truck_activity/.test(message);
  if (missing) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn(`truck_activity ${what} skipped - apply migration 0072 (${message})`);
    }
    return;
  }
  console.error(`truck_activity ${what} failed:`, message);
}
