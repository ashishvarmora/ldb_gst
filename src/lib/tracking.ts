import { evaluateRules, type AlertDraft, type EventLike } from "@/lib/alerts";
import { fetchTruckEvents } from "@/lib/ldb";
import { loadSettings } from "@/lib/settings";
import { syncToSheet } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formatAlertMessage, sendTelegramMessage } from "@/lib/telegram";
import { fmtDateTime } from "@/lib/format";
import type {
  AlertRule,
  AppSettings,
  EffectiveLimits,
  GoogleSheetConfig,
  QuotaVerdict,
  TelegramConfig,
  TrackedTruck,
  TruckStatus,
} from "@/lib/types";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Dedupe/history window used by the time-based alert rules. */
const HISTORY_ROWS = 200;
/** Give up on a truck after this many consecutive failed polls. */
const ERROR_CUTOFF = 20;
/** Trucks polled per sweep, and how many at a time. */
const DEFAULT_BATCH = 60;
const CONCURRENCY = 4;

export type PollOutcome = {
  truckId: string;
  truckNumber: string;
  userId: string;
  status: "polled" | "skipped" | "failed";
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
  polled: number;
  skipped: number;
  failed: number;
  newEvents: number;
  alerts: number;
  alertsDelivered: number;
  /** Set when the batch cap cut the sweep short, so it is never silent. */
  deferred: number;
  sheetErrors: string[];
  outcomes: PollOutcome[];
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

/** A truck is due when it has never been polled, or the interval has elapsed. */
export function isDue(
  truck: Pick<TrackedTruck, "last_polled_at" | "polling_interval_minutes">,
  now: Date,
  floorMinutes: number,
): boolean {
  if (!truck.last_polled_at) return true;
  const interval = Math.max(truck.polling_interval_minutes, floorMinutes);
  const last = new Date(truck.last_polled_at).getTime();
  if (Number.isNaN(last)) return true;
  // 30s of slack so a 10-minute truck is not pushed to 15 by a 5-minute tick.
  return now.getTime() - last >= interval * 60_000 - 30_000;
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
  rules: AlertRule[];
  telegram: TelegramConfig | null;
  sheet: GoogleSheetConfig | null;
  /** Recent alerts, for cooldown checks. */
  recentAlerts: { alert_rule_id: string | null; truck_number: string | null; created_at: string }[];
  /** Rows queued for the officer's Google Sheet, flushed at the end. */
  sheetEvents: (string | number | null)[][];
  sheetAlerts: (string | number | null)[][];
};

async function loadOfficerContext(admin: Admin, userId: string): Promise<OfficerContext> {
  const sixHoursAgo = new Date(Date.now() - 6 * 3_600_000).toISOString();

  const [{ data: limits }, { data: rules }, { data: telegram }, { data: sheet }, { data: alerts }] =
    await Promise.all([
      admin
        .from("officer_effective_limits")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle<EffectiveLimits>(),
      admin.from("alert_rules").select("*").eq("user_id", userId).eq("is_active", true),
      admin.from("telegram_configs").select("*").eq("user_id", userId).maybeSingle<TelegramConfig>(),
      admin
        .from("google_sheet_configs")
        .select("*")
        .eq("user_id", userId)
        .maybeSingle<GoogleSheetConfig>(),
      admin
        .from("alert_logs")
        .select("alert_rule_id, truck_number, created_at")
        .eq("user_id", userId)
        .gte("created_at", sixHoursAgo),
    ]);

  return {
    userId,
    limits: limits ?? null,
    rules: (rules ?? []) as AlertRule[],
    telegram: telegram ?? null,
    sheet: sheet ?? null,
    recentAlerts: alerts ?? [],
    sheetEvents: [],
    sheetAlerts: [],
  };
}

/* -------------------------------------------------------------------------- */
/* alert delivery                                                              */
/* -------------------------------------------------------------------------- */

function isOnCooldown(context: OfficerContext, draft: AlertDraft, truckNumber: string): boolean {
  if (draft.dedupeMinutes <= 0) return false;
  const cutoff = Date.now() - draft.dedupeMinutes * 60_000;

  return context.recentAlerts.some(
    (alert) =>
      alert.alert_rule_id === draft.ruleId &&
      alert.truck_number === truckNumber &&
      new Date(alert.created_at).getTime() >= cutoff,
  );
}

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
  const fresh = drafts.filter((draft) => !isOnCooldown(context, draft, truckNumber));
  if (fresh.length === 0) return { created: 0, delivered: 0 };

  const telegramAllowed =
    (context.limits?.telegram_enabled ?? false) &&
    (context.telegram?.is_enabled ?? false) &&
    Boolean(context.telegram?.chat_id);

  let delivered = 0;

  for (const draft of fresh) {
    let deliveryError: string | null = null;
    let sent = false;

    if (draft.notifyTelegram && telegramAllowed) {
      const result = await sendTelegramMessage({
        chatId: context.telegram!.chat_id!,
        botToken: context.telegram!.bot_token,
        text: formatAlertMessage({
          title: draft.title,
          truckNumber,
          location: draft.event?.loc_name ?? null,
          direction: draft.event?.direction ?? null,
          eventTime: draft.event?.event_time ?? null,
          extra: draft.message,
        }),
      });
      sent = result.ok;
      if (!result.ok) deliveryError = result.error;
    } else if (draft.notifyTelegram) {
      deliveryError = !context.limits?.telegram_enabled
        ? "Telegram is disabled by the plan."
        : "No Telegram chat id saved.";
    }

    if (sent) delivered += 1;

    const { error } = await admin.from("alert_logs").insert({
      user_id: context.userId,
      alert_rule_id: draft.ruleId,
      truck_number: truckNumber,
      kind: draft.kind,
      title: draft.title,
      message: draft.message,
      delivered: sent,
      delivery_error: deliveryError,
    });
    if (error) console.error("alert_logs insert failed", error.message);

    // Keep the in-memory cooldown list current for the rest of the sweep.
    context.recentAlerts.push({
      alert_rule_id: draft.ruleId,
      truck_number: truckNumber,
      created_at: new Date().toISOString(),
    });

    if (draft.notifySheet) {
      context.sheetAlerts.push([
        fmtDateTime(new Date()),
        truckNumber,
        draft.kind,
        draft.title,
        draft.message,
      ]);
    }
  }

  if (fresh.length > 0) {
    await admin.rpc("bump_alerts_sent", { p_user: context.userId, p_count: fresh.length });
  }

  return { created: fresh.length, delivered };
}

/* -------------------------------------------------------------------------- */
/* one truck                                                                   */
/* -------------------------------------------------------------------------- */

export async function pollTruck({
  admin,
  truck,
  context,
  settings,
  now,
}: {
  admin: Admin;
  truck: TrackedTruck;
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

  // 1. Quota. consume_quota is the only writer of usage_counters.
  const { data: quotaRaw, error: quotaError } = await admin.rpc("consume_quota", {
    p_user: truck.user_id,
    p_source: "tracking",
    p_amount: 1,
  });

  if (quotaError) {
    return { ...outcome, status: "failed", error: `Quota check failed: ${quotaError.message}` };
  }

  const quota = (quotaRaw ?? { allowed: false }) as QuotaVerdict;
  if (!quota.allowed) {
    // Suspension and expiry are terminal until an admin acts, so stop polling.
    if (quota.reason === "account_suspended" || quota.reason === "plan_expired") {
      await admin.from("tracked_trucks").update({ is_active: false }).eq("id", truck.id);
    }
    return { ...outcome, reason: quota.reason ?? "not_allowed" };
  }

  // 2. Upstream call.
  const result = await fetchTruckEvents(truck.truck_number, settings.ldbApiUrl);

  // 3. Failures are logged here; successes are logged below, once we know how
  //    many crossings were actually new.
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

  // 4. History for the window-based rules, and for ordering.
  const { data: history } = await admin
    .from("truck_events")
    .select("seq_no, event_time, loc_name, direction")
    .eq("user_id", truck.user_id)
    .eq("truck_number", truck.truck_number)
    .order("event_time", { ascending: false, nullsFirst: false })
    .limit(HISTORY_ROWS);

  // 5. Insert only crossings we have never seen. ON CONFLICT DO NOTHING plus a
  //    returning clause means the database itself tells us what is new, so two
  //    overlapping sweeps cannot double-alert.
  let inserted: EventLike[] = [];
  if (result.events.length > 0) {
    const { data: newRows, error: insertError } = await admin
      .from("truck_events")
      .upsert(
        result.events.map((event) => ({
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

  inserted.sort((a, b) => (b.event_time ?? "").localeCompare(a.event_time ?? ""));

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

  const recentEvents: EventLike[] = [
    ...inserted,
    ...((history ?? []) as EventLike[]).filter(
      (row) => !inserted.some((event) => event.seq_no === row.seq_no),
    ),
  ].sort((a, b) => (b.event_time ?? "").localeCompare(a.event_time ?? ""));

  const latestEventAt = recentEvents[0]?.event_time ?? truck.last_event_at ?? null;
  const latest = recentEvents[0] ?? null;

  // 6. Alerts.
  const drafts = evaluateRules({
    truckNumber: truck.truck_number,
    isWatchlist: truck.is_watchlist,
    newEvents: inserted,
    recentEvents,
    rules: context.limits?.alert_rules_enabled ? context.rules : [],
    settings,
    now,
  });

  const alertResult = await dispatchAlerts({
    admin,
    context,
    truckNumber: truck.truck_number,
    drafts,
  });

  // 7. Queue sheet rows for the flush at the end of the sweep.
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

  // 8. Roll the truck forward.
  await admin
    .from("tracked_trucks")
    .update({
      last_polled_at: now.toISOString(),
      last_event_at: latestEventAt,
      last_location: latest?.loc_name ?? truck.last_location,
      last_direction: latest?.direction ?? truck.last_direction,
      status: deriveStatus(latestEventAt, now, settings.noActivityHours),
      consecutive_errors: 0,
    })
    .eq("id", truck.id);

  return {
    ...outcome,
    status: "polled",
    newEvents: inserted.length,
    alerts: alertResult.created,
    alertsDelivered: alertResult.delivered,
    responseMs: result.ms,
  };
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
    if (context.sheetEvents.length === 0 && context.sheetAlerts.length === 0) continue;

    // Refresh the usage tab in the same round trip; it is a full rewrite, so it
    // never accumulates duplicate rows.
    const { data: usage } = await admin
      .from("usage_counters")
      .select("usage_date, manual_searches, tracking_queries")
      .eq("user_id", context.userId)
      .order("usage_date", { ascending: false })
      .limit(60);

    const result = await syncToSheet(spreadsheetId, {
      events: context.sheetEvents,
      alerts: context.sheetAlerts,
      usage: (usage ?? []).map((row) => [
        row.usage_date,
        row.manual_searches,
        row.tracking_queries,
      ]),
    });

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
    polled: 0,
    skipped: 0,
    failed: 0,
    newEvents: 0,
    alerts: 0,
    alertsDelivered: 0,
    deferred: 0,
    sheetErrors: [] as string[],
    outcomes: [] as PollOutcome[],
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
    return finish({
      ...base,
      sheetErrors: [`Could not list trucks: ${error.message}`],
    });
  }

  const all = (candidates ?? []) as TrackedTruck[];
  const due = options.truckIds?.length
    ? all
    : all.filter((truck) => isDue(truck, startedAt, settings.globalPollingFloor));
  const selected = due.slice(0, batch);

  // Load each officer's rules and integrations once, not once per truck.
  const contexts = new Map<string, OfficerContext>();
  for (const userId of new Set(selected.map((truck) => truck.user_id))) {
    contexts.set(userId, await loadOfficerContext(admin, userId));
  }

  const outcomes = await mapWithConcurrency(selected, CONCURRENCY, (truck) =>
    pollTruck({
      admin,
      truck,
      context: contexts.get(truck.user_id)!,
      settings,
      now: new Date(),
    }),
  );

  const sheetErrors = await flushSheets(admin, [...contexts.values()]);

  return finish({
    ...base,
    candidates: all.length,
    due: due.length,
    deferred: Math.max(due.length - selected.length, 0),
    polled: outcomes.filter((o) => o.status === "polled").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    newEvents: outcomes.reduce((sum, o) => sum + o.newEvents, 0),
    alerts: outcomes.reduce((sum, o) => sum + o.alerts, 0),
    alertsDelivered: outcomes.reduce((sum, o) => sum + o.alertsDelivered, 0),
    sheetErrors,
    outcomes,
  });
}
