import { CREDIT_ACTIONS, creditRefusalMessage, spendCredits } from "@/lib/credits";
import { fetchTruckEvents } from "@/lib/ldb";
import { fmtDateTime } from "@/lib/format";
import { blockedReason, loadOverview } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { syncToSheet } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { GoogleSheetConfig } from "@/lib/types";

export type LookupResult =
  | { ok: true; found: number; newCount: number; responseMs: number }
  | { ok: false; error: string; creditSpent: boolean };

/**
 * One officer-initiated LDB lookup: quota, upstream call, event storage, call
 * log, sheet mirror. Shared by the search box and the "check now" button on a
 * tracked truck, so both spend a credit in exactly the same way.
 */
export async function runManualLookup({
  userId,
  truckNumber,
}: {
  userId: string;
  truckNumber: string;
}): Promise<LookupResult> {
  const admin = getSupabaseAdmin();

  const overview = await loadOverview(userId);
  if (!overview) {
    return { ok: false, error: "Could not read your account. Sign in again.", creditSpent: false };
  }

  const blocked = blockedReason(overview);
  if (blocked) return { ok: false, error: blocked, creditSpent: false };

  // spend_credits is the single source of truth, so two tabs cannot slip an
  // extra search through between the check and the call.
  const verdict = await spendCredits({
    admin,
    userId,
    action: CREDIT_ACTIONS.manualSearch,
    truckNumber,
  });

  if (!verdict.allowed) {
    return { ok: false, error: creditRefusalMessage(verdict), creditSpent: false };
  }

  const settings = await loadSettings(admin);
  const result = await fetchTruckEvents(truckNumber, settings.ldbApiUrl);

  const { data: tracked } = await admin
    .from("tracked_trucks")
    .select("id")
    .eq("user_id", userId)
    .eq("truck_number", truckNumber)
    .maybeSingle();

  if (!result.ok) {
    await admin.from("search_logs").insert({
      user_id: userId,
      truck_number: truckNumber,
      source: "manual",
      ok: false,
      http_status: result.httpStatus,
      response_ms: result.ms,
      events_found: 0,
      new_events: 0,
      error: result.error,
    });
    return {
      ok: false,
      creditSpent: true,
      error: `${result.error} The search credit was still used, because the request did reach the portal.`,
    };
  }

  let newCount = 0;
  if (result.events.length > 0) {
    const { data: inserted, error: insertError } = await admin
      .from("truck_events")
      .upsert(
        result.events.map((event) => ({
          user_id: userId,
          tracked_truck_id: tracked?.id ?? null,
          truck_number: truckNumber,
          seq_no: event.seqNo,
          event_time: event.eventTime,
          event_time_raw: event.eventTimeRaw,
          loc_name: event.locName,
          lat: event.lat,
          lng: event.lng,
          direction: event.direction,
          event_name: event.eventName,
        })),
        { onConflict: "user_id,seq_no", ignoreDuplicates: true },
      )
      .select("seq_no");

    if (insertError) {
      return { ok: false, creditSpent: true, error: `Could not store the results: ${insertError.message}` };
    }
    newCount = inserted?.length ?? 0;
  }

  await admin.from("search_logs").insert({
    user_id: userId,
    truck_number: truckNumber,
    source: "manual",
    ok: true,
    http_status: result.httpStatus,
    response_ms: result.ms,
    events_found: result.events.length,
    new_events: newCount,
    error: null,
  });

  // Keep a tracked truck's card from looking stale right after a manual check.
  //
  // last_polled_at is stamped even when the portal returned nothing, because it
  // answers "when did we last look", not "when did we last find something".
  // Without this a truck checked by hand kept reporting "never checked" until
  // the worker happened to reach it.
  if (tracked) {
    const newest = result.events.length > 0 ? result.events[0] : null;
    await admin
      .from("tracked_trucks")
      .update({
        last_polled_at: new Date().toISOString(),
        ...(newest
          ? {
              last_event_at: newest.eventTime,
              last_location: newest.locName,
              last_direction: newest.direction,
            }
          : {}),
      })
      .eq("id", tracked.id);
  }

  await admin.rpc("touch_last_active", { p_user: userId });

  // The sheet is the long-term copy of where trucks have been, for after
  // retention trims the database. It holds crossings and nothing else, so a
  // search that turned up nothing new writes nothing.
  if (overview.google_sheet_enabled && newCount > 0) {
    const { data: sheet } = await admin
      .from("google_sheet_configs")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle<GoogleSheetConfig>();

    if (sheet?.is_enabled && sheet.spreadsheet_id) {
      const loggedAt = fmtDateTime(new Date());
      const sync = await syncToSheet(sheet.spreadsheet_id, {
        events: result.events.map((event) => [
          event.eventTime ? fmtDateTime(event.eventTime) : (event.eventTimeRaw ?? ""),
          truckNumber,
          event.locName ?? "",
          event.lat ?? "",
          event.lng ?? "",
          event.direction ?? "",
          event.eventName ?? "",
          `'${event.seqNo}`,
          loggedAt,
        ]),
      });
      await admin
        .from("google_sheet_configs")
        .update({
          last_synced_at: sync.ok ? new Date().toISOString() : sheet.last_synced_at,
          last_error: sync.ok ? null : sync.error,
        })
        .eq("user_id", userId);
    }
  }

  return { ok: true, found: result.events.length, newCount, responseMs: result.ms };
}
