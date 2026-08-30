import { fmtDateTime } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { syncToSheet } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Back up, then delete.
 *
 * truck_events is the table that grows without limit - one row per movement
 * per truck for ever - and almost none of it is looked at after a case closes.
 * So old rows are copied to one Google Sheet the admin owns and then removed
 * from the database.
 *
 * Two deliberate choices:
 *
 *   The sheet is the admin's, not each officer's. Every officer used to
 *   connect their own, which meant the copy that had to survive the purge
 *   belonged to someone who was not running the purge.
 *
 *   No sheet configured means no backup is wanted, and the purge still runs.
 *   The old rule - refuse to purge without a sheet - quietly kept everything
 *   for ever for anyone who had not set one up, which is the opposite of what
 *   a retention window is for.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Rows copied per run. Enough to catch up, small enough for one request. */
const MAX_ROWS = 5_000;

export type BackupSummary = {
  ranAt: string;
  durationMs: number;
  /** False when the interval has not elapsed yet. */
  ran: boolean;
  reason?: string;
  backedUp: number;
  purged: { truckEvents: number; searchLogs: number; alertLogs: number };
  sheetError?: string;
};

function empty(reason: string, startedAt: Date): BackupSummary {
  return {
    ranAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    ran: false,
    reason,
    backedUp: 0,
    purged: { truckEvents: 0, searchLogs: 0, alertLogs: 0 },
  };
}

/**
 * Runs at the end of a sweep. Cheap to call: it reads two settings and returns
 * immediately unless the interval has elapsed.
 */
export async function maybeBackupAndPurge(force = false): Promise<BackupSummary> {
  const startedAt = new Date();
  const admin = getSupabaseAdmin();
  const settings = await loadSettings(admin);

  const { data: rows } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["purge_enabled", "last_backup_at"]);

  const map = new Map((rows ?? []).map((r) => [r.key, r.value as unknown]));
  if (!force && map.get("purge_enabled") === false) return empty("disabled", startedAt);

  const last = map.get("last_backup_at");
  if (!force && typeof last === "string") {
    const days = (Date.now() - new Date(last).getTime()) / 86_400_000;
    // A little slack, so a job that drifts by an hour is not pushed a whole
    // interval later each time.
    if (Number.isFinite(days) && days < settings.backupIntervalDays - 0.05) {
      return empty("not_due", startedAt);
    }
  }

  if (settings.dataRetentionDays === -1) return empty("keep_forever", startedAt);

  const cutoff = new Date(
    Date.now() - settings.dataRetentionDays * 86_400_000,
  ).toISOString();

  let backedUp = 0;
  let sheetError: string | undefined;

  // 1. Copy out, oldest first, only when there is somewhere to copy to.
  if (settings.backupSheetId) {
    const { data: old } = await admin
      .from("truck_events")
      .select("truck_number, event_time, loc_name, lat, lng, direction, event_name, seq_no, fetched_at")
      .lt("fetched_at", cutoff)
      .order("event_time", { ascending: true, nullsFirst: true })
      .limit(MAX_ROWS);

    const batch = old ?? [];
    if (batch.length > 0) {
      const result = await syncToSheet(settings.backupSheetId, {
        events: batch.map((row) => [
          row.event_time ? fmtDateTime(row.event_time) : "",
          row.truck_number,
          row.loc_name ?? "",
          row.lat ?? "",
          row.lng ?? "",
          row.direction ?? "",
          row.event_name ?? "",
          `'${row.seq_no}`,
          fmtDateTime(row.fetched_at),
        ]),
      });

      if (!result.ok) {
        // Nothing is deleted when the copy failed. Losing the only record of
        // where a truck went, because a sheet was misconfigured, is far worse
        // than carrying the rows for another interval.
        return {
          ...empty("backup_failed", startedAt),
          sheetError: result.error,
        };
      }
      backedUp = batch.length;
    }
  }

  // 2. Delete what is now safely copied, or what was never wanted.
  const purged = await purgeOlderThan(admin, cutoff);

  await admin.from("app_settings").upsert(
    {
      key: "last_backup_at",
      value: new Date().toISOString() as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  return {
    ranAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    ran: true,
    backedUp,
    purged,
    sheetError,
  };
}

async function purgeOlderThan(
  admin: Admin,
  cutoff: string,
): Promise<{ truckEvents: number; searchLogs: number; alertLogs: number }> {
  const [events, searches, alerts] = await Promise.all([
    admin.from("truck_events").delete().lt("fetched_at", cutoff).select("id"),
    admin.from("search_logs").delete().lt("created_at", cutoff).select("id"),
    admin.from("alert_logs").delete().lt("created_at", cutoff).select("id"),
  ]);

  return {
    truckEvents: events.data?.length ?? 0,
    searchLogs: searches.data?.length ?? 0,
    alertLogs: alerts.data?.length ?? 0,
  };
}
