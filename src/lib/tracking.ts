import {
  alertDue,
  evaluateAlert,
  isRevisit,
  normaliseLocation,
  type AlertDraft,
  type Position,
} from "@/lib/alerts";
import { CREDIT_ACTIONS, spendCredits } from "@/lib/credits";
import { fetchTruckEvents } from "@/lib/ldb";
import { maybeBackupAndPurge, type BackupSummary } from "@/lib/backup";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formatAlertMessage, sendTelegramMessage } from "@/lib/telegram";
import { fmtDateTime } from "@/lib/format";
import type {
  AppSettings,
  EffectiveLimits,
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
  /** Anything that went wrong outside a single truck's own check. */
  errors: string[];
  outcomes: PollOutcome[];
  /** Set when this sweep also ran the backup-and-purge. */
  backup?: BackupSummary | null;
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
};

async function loadOfficerContext(admin: Admin, userId: string): Promise<OfficerContext> {
  const [{ data: limits }, { data: telegram }] = await Promise.all([
    admin
      .from("officer_effective_limits")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle<EffectiveLimits>(),
    admin.from("telegram_configs").select("*").eq("user_id", userId).maybeSingle<TelegramConfig>(),
  ]);

  return {
    userId,
    limits: limits ?? null,
    telegram: telegram ?? null,
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
    (context.telegram?.is_enabled ?? false) && Boolean(context.telegram?.chat_id);

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
      deliveryError = "No Telegram chat id saved. Add it in Settings to receive alerts.";
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

  // 1. Credits. spend_credits is the only writer of the balance, and it locks
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

  // 4. Store movements, and count a return trip as one.
  //
  //    A plaza re-reports one physical crossing under several sequence numbers,
  //    so a reading at the same plaza as the previous stored one is usually
  //    noise. Usually - but not when the truck has been away and come back:
  //    Malvan at 11:00 and Malvan at 15:00 are two crossings, and dropping the
  //    second lost the whole return leg.
  //
  //    Time is what separates them. Same plaza inside the revisit window is
  //    the same crossing being re-reported; the same plaza hours later is news.
  //
  //    The walk is seeded from the truck's last SAVED crossing, so it reaches
  //    the same answer on every check: a repeat is skipped now and skipped
  //    again next time. The unique index on (user_id, seq_no) lets only one of
  //    two overlapping sweeps win.
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
    let previousAt = truck.last_event_at;
    const movements: typeof chronological = [];

    for (const event of chronological) {
      const location = normaliseLocation(event.locName);
      // An unnamed plaza cannot be compared, so it always counts as a move.
      if (location !== null && location === previous && !isRevisit(previousAt, event.eventTime, settings.revisitMinutes)) {
        continue;
      }
      previous = location ?? previous;
      previousAt = event.eventTime ?? previousAt;
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

  const alertResult = await dispatchAlerts({
    admin,
    context,
    truckNumber: truck.truck_number,
    drafts,
  });

  // 6. Roll the truck forward.
  //
  //    Nothing is written to a sheet here any more. Crossings are copied out
  //    in bulk before they are purged - see maybeBackupAndPurge - so a check
  //    is one upstream call and one row update rather than a third-party
  //    write on the hot path.
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
    errors: [] as string[],
    outcomes: [] as PollOutcome[],
    backup: null as BackupSummary | null,
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
    return finish({ ...base, errors: [`Could not list trucks: ${error.message}`] });
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

  const errors: string[] = [];

  // Housekeeping runs after the useful work and never blocks it: a failed
  // backup must not cost the sweep the checks it already paid for.
  let backup: BackupSummary | null = null;
  try {
    const result = await maybeBackupAndPurge();
    if (result.ran) backup = result;
    if (result.sheetError) errors.push(`Backup sheet: ${result.sheetError}`);
  } catch (error) {
    console.error("backup and purge failed", error);
    errors.push("The backup could not run. Nothing was deleted.");
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
    errors,
    outcomes,
    backup,
  });
}

