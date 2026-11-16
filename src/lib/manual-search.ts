import { after } from "next/server";

import { recordActivity } from "@/lib/audit";
import { CREDIT_ACTIONS, creditRefusalMessage, spendCredits } from "@/lib/credits";
import { reportError } from "@/lib/errors";
import { fetchTruckEvents, type LdbResult } from "@/lib/ldb";
import { fmtDateTime } from "@/lib/format";
import { blockedReason, loadOverview } from "@/lib/officer";
import type { CreditVerdict } from "@/lib/types";
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
    fetchWithOneRetry(truckNumber, settings.ldbApiUrl),
    admin
      .from("tracked_trucks")
      .select("id")
      .eq("user_id", userId)
      .eq("truck_number", truckNumber)
      .maybeSingle(),
  ]);

  if (!result.ok) {
    console.error(`manual lookup failed for ${truckNumber}:`, result.error);
    /*
     * A FAILED SEARCH COSTS NOTHING (owner, 16 Nov 2026). It used to keep the
     * credit "because the request did reach the portal" - true, and no comfort
     * to a customer who paid for an answer and got none. About one search in
     * seven failed this way, almost all of them the toll portal's own HTTP 500.
     */
    const [refunded] = await Promise.all([
      refundSearch(admin, userId, truckNumber, verdict, result.error),
      admin.from("search_logs").insert({
        user_id: userId,
        truck_number: truckNumber,
        source: "manual",
        ok: false,
        http_status: result.httpStatus,
        response_ms: result.ms,
        events_found: 0,
        new_events: 0,
        error: result.error,
      }),
    ]);
    return {
      ok: false,
      creditSpent: !refunded,
      error: failureMessage(truckNumber, result, refunded),
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
      // Our fault, not the portal's: the answer came back and we could not
      // keep it. Refunded the same way.
      reportError("storing search results", insertError);
      const refunded = await refundSearch(admin, userId, truckNumber, verdict, "could not store results");
      return {
        ok: false,
        creditSpent: !refunded,
        error: `Sorry — we found the crossings for ${truckNumber} but could not save them on our side. ${
          refunded ? "Your credit has been returned. " : ""
        }Please try again in a moment.`,
      };
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

/**
 * The toll portal fails often and briefly: most failures are a bare HTTP 500
 * that a second request a moment later answers. One quiet retry, for 5xx only -
 * never after a timeout (the customer has already waited 15 seconds) and never
 * on a 4xx, which a retry would only repeat.
 */
async function fetchWithOneRetry(truckNumber: string, apiUrl: string): Promise<LdbResult> {
  const first = await fetchTruckEvents(truckNumber, apiUrl);
  if (first.ok || first.httpStatus === null || first.httpStatus < 500) return first;
  await new Promise((resolve) => setTimeout(resolve, 700));
  const second = await fetchTruckEvents(truckNumber, apiUrl);
  return second.ok ? second : { ...second, ms: first.ms + second.ms };
}

/**
 * Gives back exactly what spend_credits took for this search. Recorded as its
 * own ledger row (reason 'search_refund', counted as negative spend by 0062)
 * rather than by deleting the charge, so the ledger still adds up to the
 * balance and the attempt stays visible. Returns whether it went through.
 */
async function refundSearch(
  admin: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
  truckNumber: string,
  verdict: CreditVerdict,
  why: string,
): Promise<boolean> {
  const cost = Number(verdict.cost ?? 0);
  if (verdict.free || !(cost > 0)) return true; // nothing was taken
  const { data, error } = await admin.rpc("grant_credits", {
    p_user: userId,
    p_amount: cost,
    p_reason: "search_refund",
    p_actor: null,
    p_note: `Refund: search for ${truckNumber} failed (${why.slice(0, 120)})`,
    p_payment: null,
  });
  if (error || (data as { ok?: boolean } | null)?.ok === false) {
    reportError("refunding a failed search", error ?? data);
    return false;
  }
  return true;
}

/**
 * What the customer reads when the toll portal let them down: what happened in
 * plain words, an apology, that they were not charged, and what to do next.
 * Never the raw "Portal returned HTTP 500".
 */
function failureMessage(
  truckNumber: string,
  result: Extract<LdbResult, { ok: false }>,
  refunded: boolean,
): string {
  const status = result.httpStatus;
  const what =
    status === null && /respond within/i.test(result.error)
      ? "the toll records service is responding very slowly right now"
      : status === 403 || status === 429
        ? "the toll records service is limiting requests at the moment"
        : status !== null && status >= 400 && status < 500
          ? `the toll records service could not look up ${truckNumber} — please check the number is correct`
          : "the toll records service is having a temporary problem";
  const charge = refunded
    ? "You have not been charged for this search."
    : "If a credit was taken for this search, contact support and we will return it.";
  return `Sorry — we couldn't fetch crossings for ${truckNumber} because ${what}. ${charge} Please try again in a few minutes.`;
}
