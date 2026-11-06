import { after } from "next/server";

import { recordActivity } from "@/lib/audit";
import { CREDIT_ACTIONS, creditRefusalMessage, spendCredits } from "@/lib/credits";
import { reportError } from "@/lib/errors";
import { fetchTruckEvents } from "@/lib/ldb";
import { fmtDateTime } from "@/lib/format";
import { blockedReason, loadOverview } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type LookupResult =
  | { ok: true; found: number; newCount: number; responseMs: number }
  | { ok: false; error: string; creditSpent: boolean };

/**
 * One officer-initiated lookup: credit, upstream call, event storage, call
 * log. Shared by the search box and the "check now" button on a tracked truck,
 * so both spend a credit in exactly the same way.
 */
export async function runManualLookup({
  userId,
  truckNumber,
}: {
  userId: string;
  truckNumber: string;
}): Promise<LookupResult> {
  const admin = getSupabaseAdmin();

  /*
   * SPEED (6 Nov 2026). This used to be about eight database round trips one
   * after another around the portal call, each a trip to the database region,
   * while the customer watched "Searching...". Now everything that does not
   * depend on the step before runs together, and the bookkeeping nobody waits
   * to see (last-active stamp, activity log) runs after the reply is sent.
   */
  const [overview, settings] = await Promise.all([loadOverview(userId), loadSettings(admin)]);
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

  // The portal call is the slow one; the tracked-truck lookup rides alongside it.
  const [result, { data: tracked }] = await Promise.all([
    fetchTruckEvents(truckNumber, settings.ldbApiUrl),
    admin
      .from("tracked_trucks")
      .select("id")
      .eq("user_id", userId)
      .eq("truck_number", truckNumber)
      .maybeSingle(),
  ]);

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
      // The credit is spent either way, so say so: the officer is about to
      // wonder why the balance moved for a search that showed nothing.
      error: `${reportError("manual lookup", result.error)} The credit was still used, because the request did reach the portal.`,
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
      return { ok: false, creditSpent: true, error: reportError("storing search results", insertError) };
    }
    newCount = inserted?.length ?? 0;
  }

  // The result page shows this search's log row and the truck's last check,
  // so both are written before the redirect - but together, not in turn.
  const writeLog = admin.from("search_logs").insert({
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
  const newest = result.events.length > 0 ? result.events[0] : null;
  const updateTracked = tracked
    ? admin
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
      .eq("id", tracked.id)
    : null;
  await Promise.all([writeLog, updateTracked]);

  // Every lookup an officer runs by hand is recorded, which is what makes
  // "which numbers has this officer been asking about" answerable. Automatic
  // checks are deliberately not recorded here: they are the machine following
  // an alert the officer already set up, and one row per truck per interval
  // would bury the searches that were actually a decision.
  //
  // Neither this nor the last-active stamp is on screen, so they run after the
  // reply has gone (after() keeps the function alive for them on Vercel).
  after(async () => {
    try {
      await admin.rpc("touch_last_active", { p_user: userId });
      await recordActivity(
        { id: userId, email: overview.email, role: overview.role },
        {
          action: "search.manual",
          entity: "truck",
          entityLabel: truckNumber,
          meta: { found: result.events.length, newCrossings: newCount },
        },
      );
    } catch (error) {
      reportError("manual lookup bookkeeping", error);
    }
  });

  return { ok: true, found: result.events.length, newCount, responseMs: result.ms };
}
