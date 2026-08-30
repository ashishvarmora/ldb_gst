import {
  alertDue,
  evaluateAlert,
  normaliseLocation,
  type AlertDraft,
  type Position,
} from "@/lib/alerts";
import { CREDIT_ACTIONS, spendCredits } from "@/lib/credits";
import { fetchTruckEvents } from "@/lib/ldb";
import { loadSettings } from "@/lib/settings";
import { syncToSheet } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formatAlertMessage, sendTelegramMessage } from "@/lib/telegram";
import { fmtDateTime } from "@/lib/format";
import type {
  AppSettings,
  EffectiveLimits,
  GoogleSheetConfig,
  TelegramConfig,
  TrackedTruck,
  TruckAlertWithTemplate,
  TruckStatus,
} from "@/lib/types";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Crossing shape the worker passes around. */
export type EventLike = {
  seq_no: string;
  event_time: string | null;
  loc_name: string | null;
  direction: string | null;
};

/** Give up on a truck after this many consecutive failed checks. */
const ERROR_CUTOFF = 20;
/** Trucks handled per sweep, and how many at a time. */
const DEFAULT_BATCH = 60;
const CONCURRENCY = 4;

export type PollOutcome = {
  truckId: string;
  truckNumber: string;
  userId: string;
  status: "checked" | "skipped" | "failed";
  reason?: string;
  newEvents: number;
  alerts: number;
  alertsDelivered: number;
  responseMs?: number;
  error?: string;
};

export type SweepSummary = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trackingEnabled: boolean;
  candidates: number;
  due: number;
  checked: number;
  skipped: number;
  failed: number;
  newEvents: number;
  alerts: number;
  alertsDelivered: number;
  /** Set when the batch cap cut the sweep short, so it is never silent. */
  deferred: number;
  sheetErrors: string[];
  outcomes: PollOutcome[];
  /** Set when this sweep also ran the daily retention purge. */
  purge?: { officers: number; rowsDeleted: number; withoutBackup: string[] } | null;
};

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function deriveStatus(
  lastEventAt: string | null,
  now: Date,
  noActivityHours: number,
): TruckStatus {
  if (!lastEventAt) return "unknown";
  const then = new Date(lastEventAt).getTime();
  if (Number.isNaN(then)) return "unknown";
  const hours = (now.getTime() - then) / 3_600_000;
  if (hours <= 1) return "moving";
  if (hours <= noActivityHours) return "idle";
  return "no_activity";
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/* -------------------------------------------------------------------------- */
/* per-officer context, loaded once per sweep                                  */
/* -------------------------------------------------------------------------- */

export type OfficerContext = {
  userId: string;
  limits: EffectiveLimits | null;
  telegram: TelegramConfig | null;
  sheet: GoogleSheetConfig | null;
  /** Crossings queued for the officer's Google Sheet, flushed at the end. */
  sheetEvents: (string | number | null)[][];
};

async function loadOfficerContext(admin: Admin, userId: string): Promise<OfficerContext> {
  const [{ data: limits }, { data: telegram }, { data: sheet }] = await Promise.all([
    admin
      .from("officer_effective_limits")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle<EffectiveLimits>(),
    admin.from("telegram_configs").select("*").eq("user_id", userId).maybeSingle<TelegramConfig>(),
    admin
      .from("google_sheet_configs")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle<GoogleSheetConfig>(),
  ]);

  return {
    userId,
    limits: limits ?? null,
    telegram: telegram ?? null,
    sheet: sheet ?? null,
    sheetEvents: [],
  };
}

/* -------------------------------------------------------------------------- */
/* alert delivery                                                              */
/* -------------------------------------------------------------------------- */

/**
 * There is no cooldown table. Each alert carries its own interval and its own
 * last_run_at, so it cannot repeat inside its window by construction.
 */
async function dispatchAlerts({
  admin,
  context,
  truckNumber,
  drafts,
}: {
  admin: Admin;
  context: OfficerContext;
  truckNumber: string;
  drafts: AlertDraft[];
}): Promise<{ created: number; delivered: number }> {
  if (drafts.length === 0) return { created: 0, delivered: 0 };

  const telegramAllowed =
    (context.limits?.telegram_enabled ?? false) &&
    (context.telegram?.is_enabled ?? false) &&
    Boolean(context.telegram?.chat_id);

  let delivered = 0;

  for (const draft of drafts) {
    let deliveryError: string | null = null;
    let sent = false;

    if (telegramAllowed) {
      const result = await sendTelegramMessage({
        chatId: context.telegram!.chat_id!,
        botToken: context.telegram!.bot_token,
        text: formatAlertMessage({
          title: draft.title,
          truckNumber,
          location: draft.position.locName,
          direction: draft.position.direction,
          eventTime: draft.position.eventTime,
          extra: draft.message,
        }),
      });
      sent = result.ok;
      if (!result.ok) deliveryError = result.error;
    } else {
      deliveryError = !context.limits?.telegram_enabled
        ? "Telegram is disabled by the plan."
        : "No Telegram chat id saved.";
    }

    if (sent) delivered += 1;

    const { error } = await admin.from("alert_logs").insert({
      user_id: context.userId,
      truck_number: truckNumber,
      kind: draft.kind,
      title: draft.title,
      message: draft.message,
      delivered: sent,
      delivery_error: deliveryError,
    });
    if (error) console.error("alert_logs insert failed", error.message);
  }

  await admin.rpc("bump_alerts_sent", { p_user: context.userId, p_count: drafts.length });

  return { created: drafts.length, delivered };
}

/* -------------------------------------------------------------------------- */
/* one truck                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Checks one truck and runs whichever of its alerts are due.
 *
 * A truck is only ever here because an alert asked for it, so the upstream
 * call and the credit are charged once and shared by every alert that was due
 * at the same moment.
 */
export async function checkTruck({
  admin,
  truck,
  alerts,
  context,
  settings,
  now,
}: {
  admin: Admin;
  truck: TrackedTruck;
  alerts: TruckAlertWithTemplate[];
  context: OfficerContext;
  settings: AppSettings;
  now: Date;
}): Promise<PollOutcome> {
  const outcome: PollOutcome = {
    truckId: truck.id,
    truckNumber: truck.truck_number,
    userId: truck.user_id,
    status: "skipped",
    newEvents: 0,
    alerts: 0,
    alertsDelivered: 0,
  };

  // 1. A plan can withdraw alerts after an officer set some up. Checking the
  //    truck anyway would charge a credit for a message that is never sent, so
  //    stop before the balance is touched.
  if (!context.limits?.alerts_enabled) {
    return { ...outcome, reason: "alerts_not_enabled" };
  }

  // 2. Credits. spend_credits is the only writer of the balance, and it locks
  //    the row, so two overlapping sweeps cannot both spend the last one.
  const verdict = await spendCredits({
    admin,
    userId: truck.user_id,
    action: CREDIT_ACTIONS.autoCheck,
    truckNumber: truck.truck_number,
  });

  if (!verdict.allowed) {
    // Out of credits is not a failure of the truck, and it fixes itself the
    // moment the officer tops up, so tracking is left switched on.
    if (verdict.reason === "account_suspended") {
      await admin.from("tracked_trucks").update({ is_active: false }).eq("id", truck.id);
    }
    return { ...outcome, reason: verdict.reason ?? "not_allowed" };
  }

  // 3. Upstream call.
  const result = await fetchTruckEvents(truck.truck_number, settings.ldbApiUrl);

  if (!result.ok) {
    await admin.from("search_logs").insert({
      user_id: truck.user_id,
      truck_number: truck.truck_number,
      source: "tracking",
      ok: false,
      http_status: result.httpStatus,
      response_ms: result.ms,
      events_found: 0,
      new_events: 0,
      error: result.error,
    });

    const errors = truck.consecutive_errors + 1;
    await admin
      .from("tracked_trucks")
      .update({
        last_polled_at: now.toISOString(),
        consecutive_errors: errors,
        is_active: errors >= ERROR_CUTOFF ? false : truck.is_active,
      })
      .eq("id", truck.id);

    return {
      ...outcome,
      status: "failed",
      error: result.error,
      responseMs: result.ms,
      reason: errors >= ERROR_CUTOFF ? "paused_after_repeated_errors" : undefined,
    };
  }

  // 4. Store only movements. A plaza re-reports the same crossing under several
  //    sequence numbers, and a parked truck registers over and over; those rows
  //    say nothing the previous row does not already say.
  //
  //    The walk is seeded from the truck's last SAVED location, so it reaches
  //    the same answer on every check: a repeat is skipped now and skipped
  //    again next time, never inserted. The unique index on (user_id, seq_no)
  //    lets only one of two overlapping sweeps win.
  const { data: history } = await admin
    .from("truck_events")
    .select("seq_no, event_time, loc_name, direction")
    .eq("user_id", truck.user_id)
    .eq("truck_number", truck.truck_number)
    .order("event_time", { ascending: false, nullsFirst: false })
    .limit(50);

  let inserted: EventLike[] = [];

  if (result.events.length > 0) {
    const chronological = [...result.events].sort((a, b) =>
      (a.eventTime ?? "").localeCompare(b.eventTime ?? ""),
    );

    let previous = normaliseLocation(truck.last_location);
    const movements: typeof chronological = [];

    for (const event of chronological) {
      const location = normaliseLocation(event.locName);
      // An unnamed plaza cannot be compared, so it always counts as a move.
      if (location !== null && location === previous) continue;
      previous = location ?? previous;
      movements.push(event);
    }

    if (movements.length > 0) {
      const { data: newRows, error: insertError } = await admin
        .from("truck_events")
        .upsert(
          movements.map((event) => ({
            user_id: truck.user_id,
            tracked_truck_id: truck.id,
            truck_number: truck.truck_number,
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
        .select("seq_no, event_time, loc_name, direction");

      if (insertError) {
        return { ...outcome, status: "failed", error: `Storing events failed: ${insertError.message}` };
      }
      inserted = (newRows ?? []) as EventLike[];
    }
  }

  inserted.sort((a, b) => (b.event_time ?? "").localeCompare(a.event_time ?? ""));

  // Log the call only when it carried news. A truck that has not moved produces
  // a successful, empty check every few minutes; at fifty trucks that is over
  // 200,000 rows a month saying "nothing happened". Credits are counted by
  // spend_credits, not by counting rows here, so billing is unaffected.
  if (inserted.length > 0) {
    await admin.from("search_logs").insert({
      user_id: truck.user_id,
      truck_number: truck.truck_number,
      source: "tracking",
      ok: true,
      http_status: result.httpStatus,
      response_ms: result.ms,
      events_found: result.events.length,
      new_events: inserted.length,
      error: null,
    });

    await recordPlazas(admin, inserted.map((row) => row.loc_name));
  }

  const recentEvents: EventLike[] = [
    ...inserted,
    ...((history ?? []) as EventLike[]).filter(
      (row) => !inserted.some((event) => event.seq_no === row.seq_no),
    ),
  ].sort((a, b) => (b.event_time ?? "").localeCompare(a.event_time ?? ""));

  const latest = recentEvents[0] ?? null;
  const latestEventAt = latest?.event_time ?? truck.last_event_at ?? null;

  const position: Position = {
    locName: latest?.loc_name ?? truck.last_location,
    direction: latest?.direction ?? truck.last_direction,
    eventTime: latestEventAt,
  };

  // 5. Alerts, against the position this check just established.
  const drafts: AlertDraft[] = [];

  for (const alert of alerts) {
    const { draft, stateUpdate } = evaluateAlert({
      truckNumber: truck.truck_number,
      alert,
      position,
      now,
    });
    if (draft) drafts.push(draft);
    await admin.from("truck_alerts").update(stateUpdate).eq("id", alert.id);
  }

  const alertResult = context.limits?.alerts_enabled
    ? await dispatchAlerts({ admin, context, truckNumber: truck.truck_number, drafts })
    : { created: 0, delivered: 0 };

  // 6. Queue sheet rows for the flush at the end of the sweep. The sheet holds
  //    the crossings and nothing else: it is the long-term copy of where a
  //    truck has been, for after retention trims the database.
  if (inserted.length > 0 && context.limits?.google_sheet_enabled && context.sheet?.spreadsheet_id) {
    const bySeq = new Map(result.events.map((event) => [event.seqNo, event]));
    const loggedAt = fmtDateTime(now);

    for (const row of [...inserted].reverse()) {
      const full = bySeq.get(row.seq_no);
      context.sheetEvents.push([
        row.event_time ? fmtDateTime(row.event_time) : (full?.eventTimeRaw ?? ""),
        truck.truck_number,
        row.loc_name ?? "",
        full?.lat ?? "",
        full?.lng ?? "",
        row.direction ?? "",
        full?.eventName ?? "",
        `'${row.seq_no}`,
        loggedAt,
      ]);
    }
  }

  // 7. Roll the truck forward.
  await admin
    .from("tracked_trucks")
    .update({
      last_polled_at: now.toISOString(),
      last_event_at: latestEventAt,
      last_location: position.locName,
      last_direction: position.direction,
      status: deriveStatus(latestEventAt, now, settings.noActivityHours),
      consecutive_errors: 0,
    })
    .eq("id", truck.id);

  return {
    ...outcome,
    status: "checked",
    newEvents: inserted.length,
    alerts: alertResult.created,
    alertsDelivered: alertResult.delivered,
    responseMs: result.ms,
  };
}

/**
 * Keeps the plaza catalogue current. It is what the "alert me when the truck
 * reaches this plaza" dropdown is built from, so it has to learn names as the
 * platform sees them rather than being maintained by hand.
 */
async function recordPlazas(admin: Admin, names: (string | null)[]): Promise<void> {
  const unique = [...new Set(names.map((n) => n?.trim()).filter((n): n is string => Boolean(n)))];
  if (unique.length === 0) return;

  const { error } = await admin.from("toll_plazas").upsert(
    unique.map((name) => ({ name, last_seen_at: new Date().toISOString() })),
    { onConflict: "name", ignoreDuplicates: true },
  );
  if (error) console.error("toll_plazas upsert failed", error.message);
}

/* -------------------------------------------------------------------------- */
/* sheet flush                                                                 */
/* -------------------------------------------------------------------------- */

async function flushSheets(admin: Admin, contexts: OfficerContext[]): Promise<string[]> {
  const errors: string[] = [];

  for (const context of contexts) {
    const spreadsheetId = context.sheet?.spreadsheet_id;
    if (!spreadsheetId) continue;
    if (!context.limits?.google_sheet_enabled || !context.sheet?.is_enabled) continue;
    if (context.sheetEvents.length === 0) continue;

    const result = await syncToSheet(spreadsheetId, { events: context.sheetEvents });

    await admin
      .from("google_sheet_configs")
      .update({
        last_synced_at: result.ok ? new Date().toISOString() : context.sheet.last_synced_at,
        last_error: result.ok ? null : result.error,
      })
      .eq("user_id", context.userId);

    if (!result.ok) errors.push(`${context.userId}: ${result.error}`);
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* the sweep                                                                   */
/* -------------------------------------------------------------------------- */

export async function runTrackingSweep(
  options: { batch?: number; truckIds?: string[] } = {},
): Promise<SweepSummary> {
  const startedAt = new Date();
  const admin = getSupabaseAdmin();
  const settings = await loadSettings(admin);
  const batch = options.batch ?? DEFAULT_BATCH;

  const base = {
    startedAt: startedAt.toISOString(),
    trackingEnabled: settings.trackingEnabled,
    candidates: 0,
    due: 0,
    checked: 0,
    skipped: 0,
    failed: 0,
    newEvents: 0,
    alerts: 0,
    alertsDelivered: 0,
    deferred: 0,
    sheetErrors: [] as string[],
    outcomes: [] as PollOutcome[],
    purge: null as SweepSummary["purge"],
  };

  const finish = (partial: typeof base): SweepSummary => {
    const finishedAt = new Date();
    return {
      ...partial,
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  };

  if (!settings.trackingEnabled) return finish(base);

  // Only active trucks belonging to active officers.
  let query = admin
    .from("tracked_trucks")
    .select("*, profiles!inner(status)")
    .eq("is_active", true)
    .eq("profiles.status", "active")
    .order("last_polled_at", { ascending: true, nullsFirst: true })
    .limit(500);

  if (options.truckIds?.length) query = query.in("id", options.truckIds);

  const { data: candidates, error } = await query;
  if (error) {
    return finish({ ...base, sheetErrors: [`Could not list trucks: ${error.message}`] });
  }

  const all = (candidates ?? []) as TrackedTruck[];
  if (all.length === 0) return finish(base);

  // A truck is checked because one of its alerts came due. Nothing else calls
  // for a check, so a truck with no alerts costs nothing and is never fetched.
  const { data: alertRows } = await admin
    .from("truck_alerts")
    .select("*, template:alert_rule_templates(*)")
    .eq("is_enabled", true)
    .in(
      "tracked_truck_id",
      all.map((truck) => truck.id),
    );

  const byTruck = new Map<string, TruckAlertWithTemplate[]>();
  for (const row of (alertRows ?? []) as TruckAlertWithTemplate[]) {
    // A rule the admin switched off stops firing without the officer losing it.
    if (!row.template?.is_active) continue;
    const list = byTruck.get(row.tracked_truck_id) ?? [];
    list.push(row);
    byTruck.set(row.tracked_truck_id, list);
  }

  const due = all
    .map((truck) => {
      const alerts = byTruck.get(truck.id) ?? [];
      const ready = options.truckIds?.length
        ? alerts
        : alerts.filter((alert) => alertDue(alert, startedAt));
      return { truck, alerts: ready };
    })
    .filter((item) => item.alerts.length > 0);

  const selected = due.slice(0, batch);

  // Load each officer's limits and integrations once, not once per truck.
  const contexts = new Map<string, OfficerContext>();
  for (const userId of new Set(selected.map((item) => item.truck.user_id))) {
    contexts.set(userId, await loadOfficerContext(admin, userId));
  }

  const outcomes = await mapWithConcurrency(selected, CONCURRENCY, ({ truck, alerts }) =>
    checkTruck({
      admin,
      truck,
      alerts,
      context: contexts.get(truck.user_id)!,
      settings,
      now: new Date(),
    }),
  );

  const sheetErrors = await flushSheets(admin, [...contexts.values()]);

  // Housekeeping runs after the useful work, and never blocks it.
  let purge: SweepSummary["purge"] = null;
  try {
    const result = await maybePurge();
    if (result) {
      purge = {
        officers: result.purgedFor,
        rowsDeleted: result.rowsDeleted,
        withoutBackup: result.withoutBackup,
      };
    }
  } catch (error) {
    console.error("retention purge failed", error);
  }

  return finish({
    ...base,
    candidates: all.length,
    due: due.length,
    deferred: Math.max(due.length - selected.length, 0),
    checked: outcomes.filter((o) => o.status === "checked").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    newEvents: outcomes.reduce((sum, o) => sum + o.newEvents, 0),
    alerts: outcomes.reduce((sum, o) => sum + o.alerts, 0),
    alertsDelivered: outcomes.reduce((sum, o) => sum + o.alertsDelivered, 0),
    sheetErrors,
    outcomes,
    purge,
  });
}

/* -------------------------------------------------------------------------- */
/* retention                                                                   */
/* -------------------------------------------------------------------------- */

export type PurgeOutcome = {
  userId: string;
  email: string | null;
  purged: boolean;
  reason?: string;
  days?: number;
  truckEvents?: number;
  searchLogs?: number;
  alertLogs?: number;
  usageCounters?: number;
};

export type PurgeSummary = {
  ranAt: string;
  durationMs: number;
  officers: number;
  purgedFor: number;
  skipped: number;
  rowsDeleted: number;
  /** Officers skipped because they have no sheet to fall back on. */
  withoutBackup: string[];
  outcomes: PurgeOutcome[];
};

/**
 * Trims each officer's history down to their retention window.
 *
 * The Google Sheet is the permanent record, so the database only needs enough
 * to answer "where has this truck been lately". An officer with no working
 * sheet is skipped rather than purged - for them the database IS the record,
 * and deleting it would lose the case history. Pass `force` to override that,
 * which the admin UI asks about explicitly.
 */
export async function runRetentionPurge(
  options: { force?: boolean; userId?: string } = {},
): Promise<PurgeSummary> {
  const startedAt = new Date();
  const admin = getSupabaseAdmin();

  let query = admin.from("profiles").select("id, email");
  if (options.userId) query = query.eq("id", options.userId);

  const { data: officers } = await query;
  const outcomes: PurgeOutcome[] = [];

  for (const officer of officers ?? []) {
    const { data, error } = await admin.rpc("purge_officer_data", {
      p_user: officer.id,
      p_days: null,
      p_force: options.force ?? false,
    });

    if (error) {
      outcomes.push({
        userId: officer.id,
        email: officer.email,
        purged: false,
        reason: `error: ${error.message}`,
      });
      continue;
    }

    const result = (data ?? {}) as Record<string, unknown>;
    outcomes.push({
      userId: officer.id,
      email: officer.email,
      purged: Boolean(result.purged),
      reason: result.reason as string | undefined,
      days: result.days as number | undefined,
      truckEvents: (result.truck_events as number) ?? 0,
      searchLogs: (result.search_logs as number) ?? 0,
      alertLogs: (result.alert_logs as number) ?? 0,
      usageCounters: (result.usage_counters as number) ?? 0,
    });
  }

  const finishedAt = new Date();
  const purgedFor = outcomes.filter((o) => o.purged).length;

  return {
    ranAt: startedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    officers: outcomes.length,
    purgedFor,
    skipped: outcomes.length - purgedFor,
    rowsDeleted: outcomes.reduce(
      (sum, o) =>
        sum + (o.truckEvents ?? 0) + (o.searchLogs ?? 0) + (o.alertLogs ?? 0) + (o.usageCounters ?? 0),
      0,
    ),
    withoutBackup: outcomes
      .filter((o) => o.reason === "no_sheet_backup")
      .map((o) => o.email ?? o.userId),
    outcomes,
  };
}

/**
 * Called at the end of a sweep. Purging is a daily job, not a per-tick one, so
 * this only fires when the last run was more than 20 hours ago - leaving slack
 * so a daily cron that drifts slightly still gets through.
 */
export async function maybePurge(): Promise<PurgeSummary | null> {
  const admin = getSupabaseAdmin();

  const { data: rows } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["purge_enabled", "last_purge_at"]);

  const map = new Map((rows ?? []).map((r) => [r.key, r.value as unknown]));
  if (map.get("purge_enabled") === false) return null;

  const last = map.get("last_purge_at");
  if (typeof last === "string") {
    const hours = (Date.now() - new Date(last).getTime()) / 3_600_000;
    if (Number.isFinite(hours) && hours < 20) return null;
  }

  const summary = await runRetentionPurge();

  await admin
    .from("app_settings")
    .upsert(
      { key: "last_purge_at", value: new Date().toISOString() as never, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

  return summary;
}
