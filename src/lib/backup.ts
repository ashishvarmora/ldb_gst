import { fmtDateTime } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { syncToSheet, type SheetRows } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { RetentionRule } from "@/lib/types";

/**
 * Copy out, then delete.
 *
 * The database is on a free tier and several tables grow without limit - one
 * row per lookup, one per crossing, one per alert. Almost none of it is read
 * after a case closes, so each table has its own retention window and its own
 * answer to "was this copied first".
 *
 * Two deliberate choices:
 *
 *   EVERY ACCOUNT GETS ITS OWN COPY. Rows are exported per account, into that
 *   account's sheet, so a customer can still see their own history after it
 *   leaves the database. The admin's sheet is the fallback for anyone who has
 *   not named one, so nothing is deleted uncopied just because a customer
 *   never set a sheet up.
 *
 *   A FAILED COPY DELETES NOTHING. Losing the only record of where a truck
 *   went because a spreadsheet was misconfigured is far worse than carrying
 *   the rows for another day.
 *
 * The money tables (credit_transactions, payments, coupon_redemptions) are
 * marked protected and default to keep-for-ever: balances are reconstructed
 * from them, so trimming them does not free space, it destroys the explanation
 * for someone's balance.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Rows read per table per account in one pass. Keeps one request bounded. */
const BATCH = 2_000;

export type EntityOutcome = {
  entity: string;
  keepDays: number;
  exported: number;
  deleted: number;
  /** Set when the copy failed, in which case nothing was deleted. */
  error?: string;
  /** True when rows were deleted without being copied anywhere. */
  deletedWithoutBackup?: boolean;
};

export type BackupSummary = {
  ranAt: string;
  durationMs: number;
  ran: boolean;
  reason?: string;
  accounts: number;
  exported: number;
  deleted: number;
  entities: EntityOutcome[];
  errors: string[];
};

function empty(reason: string, startedAt: Date): BackupSummary {
  return {
    ranAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    ran: false,
    reason,
    accounts: 0,
    exported: 0,
    deleted: 0,
    entities: [],
    errors: [],
  };
}

/* -------------------------------------------------------------------------- */
/* what each table looks like in a sheet                                       */
/* -------------------------------------------------------------------------- */

type Row = Record<string, unknown>;
const text = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const yesNo = (v: unknown) => (v ? "yes" : "no");

/**
 * The columns to read, the column to age rows by, and how a row becomes a
 * spreadsheet line. Keyed by table name so it lines up with retention_rules
 * and SHEET_TABS without a translation layer.
 */
const SHAPES: Record<
  string,
  { select: string; dateColumn: string; userColumn: string; toRow: (r: Row) => SheetRows[number] }
> = {
  truck_events: {
    select: "event_time, truck_number, loc_name, lat, lng, direction, event_name, seq_no, fetched_at",
    dateColumn: "fetched_at",
    userColumn: "user_id",
    toRow: (r) => [
      r.event_time ? fmtDateTime(r.event_time as string) : "",
      text(r.truck_number),
      text(r.loc_name),
      text(r.lat),
      text(r.lng),
      text(r.direction),
      text(r.event_name),
      // A leading apostrophe stops Sheets reading a long numeric id as a
      // number and rounding the end off it.
      `'${text(r.seq_no)}`,
      fmtDateTime(r.fetched_at as string),
    ],
  },
  search_logs: {
    select: "created_at, truck_number, source, ok, events_found, new_events, response_ms, error",
    dateColumn: "created_at",
    userColumn: "user_id",
    toRow: (r) => [
      fmtDateTime(r.created_at as string),
      text(r.truck_number),
      r.source === "manual" ? "manual" : "automatic",
      yesNo(r.ok),
      text(r.events_found),
      text(r.new_events),
      text(r.response_ms),
      text(r.error),
    ],
  },
  alert_logs: {
    select: "created_at, truck_number, kind, title, message, delivered, delivery_error",
    dateColumn: "created_at",
    userColumn: "user_id",
    toRow: (r) => [
      fmtDateTime(r.created_at as string),
      text(r.truck_number),
      text(r.kind),
      text(r.title),
      text(r.message),
      yesNo(r.delivered),
      text(r.delivery_error),
    ],
  },
  audit_logs: {
    select: "created_at, actor_email, actor_role, action, entity, entity_label, meta",
    dateColumn: "created_at",
    userColumn: "actor_id",
    toRow: (r) => [
      fmtDateTime(r.created_at as string),
      text(r.actor_email),
      text(r.actor_role),
      text(r.action),
      text(r.entity),
      text(r.entity_label),
      r.meta ? JSON.stringify(r.meta) : "",
    ],
  },
  credit_transactions: {
    select: "created_at, delta, balance_after, reason, truck_number, note",
    dateColumn: "created_at",
    userColumn: "user_id",
    toRow: (r) => [
      fmtDateTime(r.created_at as string),
      text(r.delta),
      text(r.balance_after),
      text(r.reason),
      text(r.truck_number),
      text(r.note),
    ],
  },
  payments: {
    select: "created_at, kind, amount_inr, discount_inr, credits, status, razorpay_order_id, paid_at",
    dateColumn: "created_at",
    userColumn: "user_id",
    toRow: (r) => [
      fmtDateTime(r.created_at as string),
      text(r.kind),
      text(r.amount_inr),
      text(r.discount_inr),
      text(r.credits),
      text(r.status),
      text(r.razorpay_order_id),
      r.paid_at ? fmtDateTime(r.paid_at as string) : "",
    ],
  },
  coupon_redemptions: {
    select: "created_at, status, amount_inr, discount_inr, settled_at",
    dateColumn: "created_at",
    userColumn: "user_id",
    toRow: (r) => [
      fmtDateTime(r.created_at as string),
      text(r.status),
      text(r.amount_inr),
      text(r.discount_inr),
      r.settled_at ? fmtDateTime(r.settled_at as string) : "",
    ],
  },
};

/* -------------------------------------------------------------------------- */
/* the job                                                                     */
/* -------------------------------------------------------------------------- */

export async function loadRetentionRules(admin: Admin): Promise<RetentionRule[]> {
  const { data } = await admin.from("retention_rules").select("*").order("sort_order");
  return (data ?? []) as RetentionRule[];
}

/**
 * Runs at the end of a sweep. Cheap to call: two settings reads and an early
 * return unless the interval has elapsed.
 */
export async function maybeExportAndPurge(force = false): Promise<BackupSummary> {
  const startedAt = new Date();
  const admin = getSupabaseAdmin();
  const settings = await loadSettings(admin);

  const { data: rows } = await admin
    .from("app_settings")
    .select("key, value")
    .in("key", ["purge_enabled", "last_sheet_export_at"]);

  const map = new Map((rows ?? []).map((r) => [r.key, r.value as unknown]));
  if (!force && map.get("purge_enabled") === false) return empty("disabled", startedAt);

  const last = map.get("last_sheet_export_at");
  if (!force && typeof last === "string") {
    const days = (Date.now() - new Date(last).getTime()) / 86_400_000;
    // A little slack, so a job that drifts by an hour is not pushed a whole
    // interval later every time it runs.
    if (Number.isFinite(days) && days < settings.sheetExportIntervalDays - 0.05) {
      return empty("not_due", startedAt);
    }
  }

  const rules = (await loadRetentionRules(admin)).filter(
    (rule) => rule.is_enabled && rule.keep_days !== -1 && SHAPES[rule.entity],
  );
  if (rules.length === 0) return empty("nothing_to_do", startedAt);

  // Every account, plus a null bucket for rows with no owner (an admin action
  // in audit_logs has an actor, but a deleted account leaves orphans behind).
  const { data: accounts } = await admin.from("profiles").select("id");
  const { data: sheets } = await admin
    .from("google_sheet_configs")
    .select("user_id, spreadsheet_id, is_enabled");

  const sheetFor = new Map(
    (sheets ?? [])
      .filter((s) => s.is_enabled && s.spreadsheet_id)
      .map((s) => [s.user_id as string, s.spreadsheet_id as string]),
  );

  const entities: EntityOutcome[] = [];
  const errors: string[] = [];
  let totalExported = 0;
  let totalDeleted = 0;

  for (const rule of rules) {
    const shape = SHAPES[rule.entity];
    const cutoff = new Date(Date.now() - rule.keep_days * 86_400_000).toISOString();
    const outcome: EntityOutcome = {
      entity: rule.entity,
      keepDays: rule.keep_days,
      exported: 0,
      deleted: 0,
    };

    for (const account of accounts ?? []) {
      const userId = account.id as string;
      const target = sheetFor.get(userId) ?? settings.backupSheetId;

      const { data: old, error } = await admin
        .from(rule.entity)
        .select(shape.select)
        .eq(shape.userColumn, userId)
        .lt(shape.dateColumn, cutoff)
        .order(shape.dateColumn, { ascending: true })
        .limit(BATCH);

      if (error) {
        errors.push(`${rule.entity}: ${error.message}`);
        continue;
      }

      const batch = (old ?? []) as unknown as Row[];
      if (batch.length === 0) continue;

      if (rule.backup_before_delete) {
        if (!target) {
          // Nowhere to put it and the rule says copy first, so the rows stay.
          // Silently deleting them would be the one outcome nobody can undo.
          outcome.error = "No sheet configured, so nothing was copied or deleted.";
          continue;
        }

        const result = await syncToSheet(target, {
          [rule.entity]: batch.map(shape.toRow),
        });

        if (!result.ok) {
          outcome.error = result.error;
          errors.push(`${rule.entity} for ${userId}: ${result.error}`);
          await admin
            .from("google_sheet_configs")
            .update({ last_error: result.error })
            .eq("user_id", userId);
          continue;
        }

        outcome.exported += batch.length;
        await admin
          .from("google_sheet_configs")
          .update({ last_synced_at: new Date().toISOString(), last_error: null })
          .eq("user_id", userId);
      } else {
        outcome.deletedWithoutBackup = true;
      }

      // Only ever delete as far as the rows just read, so a row written between
      // the read and the delete is never removed uncopied.
      const boundary = batch[batch.length - 1][shape.dateColumn] as string;
      const { data: deleted, error: purgeError } = await admin.rpc("purge_entity", {
        p_entity: rule.entity,
        // Inclusive of the last row read: purge_entity uses a strict <, so a
        // hair past the boundary includes it without reaching the next row.
        p_cutoff: new Date(new Date(boundary).getTime() + 1).toISOString(),
        p_user: userId,
      });

      if (purgeError) {
        errors.push(`${rule.entity} purge for ${userId}: ${purgeError.message}`);
        continue;
      }
      outcome.deleted += Number(deleted ?? 0);
    }

    totalExported += outcome.exported;
    totalDeleted += outcome.deleted;
    entities.push(outcome);
  }

  await admin.from("app_settings").upsert(
    {
      key: "last_sheet_export_at",
      value: new Date().toISOString() as never,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );

  return {
    ranAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    ran: true,
    accounts: (accounts ?? []).length,
    exported: totalExported,
    deleted: totalDeleted,
    entities,
    errors,
  };
}

/**
 * Kept under the old name so the worker and the admin button do not both have
 * to change in the same commit as the rewrite.
 */
export const maybeBackupAndPurge = maybeExportAndPurge;
