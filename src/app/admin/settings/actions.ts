"use server";

import { revalidatePath } from "next/cache";

import { assertSuperAdmin } from "@/lib/auth";
import { diffFields, writeAudit } from "@/lib/audit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { runRetentionPurge, runTrackingSweep } from "@/lib/tracking";
import type { ActionResult } from "@/lib/types";

/** Every knob on the settings page, with how to read it off the form. */
const SETTING_SPECS = [
  { key: "ldb_api_url", kind: "url" },
  { key: "tracking_enabled", kind: "bool" },
  { key: "global_polling_floor", kind: "int", min: 1, max: 1440 },
  { key: "no_activity_hours", kind: "int", min: 1, max: 168 },
  { key: "data_retention_days", kind: "int", min: 1, max: 3650 },
  { key: "purge_enabled", kind: "bool" },
] as const;

export async function saveSettings(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const values: Record<string, unknown> = {};

  for (const spec of SETTING_SPECS) {
    const raw = fd.get(spec.key);
    const text = typeof raw === "string" ? raw.trim() : "";

    if (spec.kind === "bool") {
      values[spec.key] = fd.getAll(spec.key).includes("true");
      continue;
    }

    if (spec.kind === "url") {
      if (!/^https?:\/\/\S+$/.test(text)) {
        return { ok: false, error: "LDB API URL must start with http:// or https://" };
      }
      values[spec.key] = text;
      continue;
    }

    const n = Number(text);
    if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
      return {
        ok: false,
        error: `"${spec.key}" must be a whole number between ${spec.min} and ${spec.max}.`,
      };
    }
    values[spec.key] = n;
  }

  const defaultPlan = fd.get("default_plan_name");
  values.default_plan_name = typeof defaultPlan === "string" ? defaultPlan : "";

  const { data: existing } = await admin.from("app_settings").select("key, value");
  const before = Object.fromEntries((existing ?? []).map((row) => [row.key, row.value]));

  const rows = Object.entries(values).map(([key, value]) => ({
    key,
    value: value as never,
    updated_at: new Date().toISOString(),
    updated_by: actor.id,
  }));

  const { error } = await admin.from("app_settings").upsert(rows, { onConflict: "key" });
  if (error) return { ok: false, error: error.message };

  await writeAudit(actor, {
    action: "settings.update",
    entity: "settings",
    meta: { changes: diffFields(before, values as Record<string, unknown>) },
  });

  revalidatePath("/admin/settings");
  return { ok: true, message: "Settings saved." };
}

/**
 * Runs a tracking sweep immediately, from the admin panel. Useful for checking
 * the whole pipeline end to end without waiting for the cron tick.
 */
export async function runTrackingNow(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();

  const rawBatch = fd.get("batch");
  const batch = typeof rawBatch === "string" && Number.isInteger(Number(rawBatch))
    ? Math.min(Math.max(Number(rawBatch), 1), 300)
    : 20;

  const summary = await runTrackingSweep({ batch });

  await writeAudit(actor, {
    action: "tracking.manual_run",
    entity: "settings",
    meta: {
      polled: summary.polled,
      failed: summary.failed,
      newEvents: summary.newEvents,
      alerts: summary.alerts,
      deferred: summary.deferred,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/trucks");
  revalidatePath("/admin/usage");
  revalidatePath("/admin/settings");

  if (!summary.trackingEnabled) {
    return { ok: false, error: "Tracking is switched off in the settings above." };
  }

  if (summary.due === 0) {
    return {
      ok: true,
      message: `Nothing was due. ${summary.candidates} active truck${summary.candidates === 1 ? "" : "s"} on the platform, all checked recently.`,
    };
  }

  const parts = [
    `${summary.polled} truck${summary.polled === 1 ? "" : "s"} checked`,
    `${summary.newEvents} new crossing${summary.newEvents === 1 ? "" : "s"}`,
    `${summary.alerts} alert${summary.alerts === 1 ? "" : "s"} (${summary.alertsDelivered} delivered)`,
  ];
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped on quota`);
  if (summary.deferred > 0) parts.push(`${summary.deferred} left for the next run`);
  if (summary.sheetErrors.length > 0) parts.push(`${summary.sheetErrors.length} sheet error(s)`);

  return { ok: true, message: `${parts.join(" · ")} in ${(summary.durationMs / 1000).toFixed(1)}s.` };
}


/**
 * Clears history older than each officer's retention window, on demand.
 *
 * Officers without a working Google Sheet are skipped unless `force` is set:
 * for them the database is the only copy, and purging would lose the case
 * history rather than just trimming a cache.
 */
export async function purgeOldDataNow(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const force = fd.getAll("force").includes("true");

  const summary = await runRetentionPurge({ force });

  await writeAudit(actor, {
    action: "data.purge",
    entity: "settings",
    meta: {
      force,
      officers: summary.purgedFor,
      rowsDeleted: summary.rowsDeleted,
      withoutBackup: summary.withoutBackup,
    },
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin");

  if (summary.rowsDeleted === 0 && summary.purgedFor === 0) {
    const reason = summary.withoutBackup.length
      ? ` ${summary.withoutBackup.length} officer(s) were skipped because they have no Google Sheet.`
      : "";
    return { ok: true, message: `Nothing to clear.${reason}` };
  }

  const parts = [
    `${summary.rowsDeleted.toLocaleString("en-IN")} row(s) cleared`,
    `across ${summary.purgedFor} officer(s)`,
  ];
  if (summary.withoutBackup.length > 0) {
    parts.push(`${summary.withoutBackup.length} skipped with no sheet backup`);
  }
  return { ok: true, message: `${parts.join(", ")}.` };
}
