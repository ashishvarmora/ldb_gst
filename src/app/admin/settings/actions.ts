"use server";

import { revalidatePath } from "next/cache";

import { assertSuperAdmin, type SessionUser } from "@/lib/auth";
import { diffFields, writeAudit } from "@/lib/audit";
import { maybeBackupAndPurge } from "@/lib/backup";
import { friendlyError } from "@/lib/errors";
import { spreadsheetIdFromUrl } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { runTrackingSweep } from "@/lib/tracking";
import type { ActionResult } from "@/lib/types";

/**
 * Each form on the settings page saves its own keys. They have to stay separate
 * lists: a spec whose field is not in the submitted form reads as blank, and
 * saving one form would quietly wipe the other's values.
 */
type SettingSpec = { key: string; label: string } & (
  | { kind: "url" }
  | { kind: "bool" }
  | { kind: "key_id" }
  | { kind: "sheet" }
  | { kind: "retention" }
  | { kind: "int"; min: number; max: number }
);

const ENGINE_SPECS: SettingSpec[] = [
  { key: "ldb_api_url", label: "LDB API endpoint", kind: "url" },
  { key: "tracking_enabled", label: "Background tracking", kind: "bool" },
  { key: "no_activity_hours", label: "No-activity threshold", kind: "int", min: 1, max: 168 },
];

const BACKUP_SPECS: SettingSpec[] = [
  { key: "backup_sheet_id", label: "Backup sheet", kind: "sheet" },
  { key: "backup_interval_days", label: "Backup every", kind: "int", min: 1, max: 365 },
  { key: "data_retention_days", label: "Keep history for", kind: "retention" },
  { key: "purge_enabled", label: "Automatic backup", kind: "bool" },
];

const PAYMENT_SPECS: SettingSpec[] = [
  { key: "razorpay_enabled", label: "Razorpay", kind: "bool" },
  { key: "razorpay_key_id", label: "Razorpay key id", kind: "key_id" },
];

function readSpecs(
  fd: FormData,
  specs: SettingSpec[],
): { values: Record<string, unknown> } | { error: string } {
  const values: Record<string, unknown> = {};

  for (const spec of specs) {
    const raw = fd.get(spec.key);
    const text = typeof raw === "string" ? raw.trim() : "";

    switch (spec.kind) {
      case "bool":
        values[spec.key] = fd.getAll(spec.key).includes("true");
        break;

      case "url":
        if (!/^https?:\/\/\S+$/.test(text)) {
          return { error: `${spec.label} must start with http:// or https://` };
        }
        values[spec.key] = text;
        break;

      case "key_id":
        // A Razorpay key id always starts with rzp_. The secret does not, so
        // this also catches the far worse mistake of pasting the secret here -
        // it belongs in the environment, never in the database.
        if (text !== "" && !/^rzp_[A-Za-z0-9_]{6,}$/.test(text)) {
          return {
            error:
              "That is not a Razorpay key id. It starts with rzp_ and is safe to publish. Never paste the key secret here — it goes in RAZORPAY_KEY_SECRET.",
          };
        }
        values[spec.key] = text;
        break;

      case "sheet": {
        // Blank is a real answer: it means no backup is wanted. Anything else
        // is stored as the bare id, so a pasted browser address and a pasted id
        // end up as the same setting.
        if (text === "") {
          values[spec.key] = "";
          break;
        }
        const id = spreadsheetIdFromUrl(text);
        if (!id) {
          return {
            error:
              "That is not a Google Sheet link. Paste the whole address from your browser, or just the id out of it.",
          };
        }
        values[spec.key] = id;
        break;
      }

      case "retention": {
        const days = Number(text);
        if (days === -1) {
          values[spec.key] = -1;
          break;
        }
        if (!Number.isInteger(days) || days < 1 || days > 3650) {
          return {
            error: `${spec.label} must be a whole number of days between 1 and 3650, or -1 to keep everything for ever.`,
          };
        }
        values[spec.key] = days;
        break;
      }

      default: {
        const n = Number(text);
        if (!Number.isInteger(n) || n < spec.min || n > spec.max) {
          return {
            error: `${spec.label} must be a whole number between ${spec.min} and ${spec.max}.`,
          };
        }
        values[spec.key] = n;
      }
    }
  }

  return { values };
}

async function persist(
  actor: SessionUser,
  values: Record<string, unknown>,
  auditAction: string,
): Promise<ActionResult> {
  const admin = getSupabaseAdmin();

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
    action: auditAction,
    entity: "settings",
    meta: { changes: diffFields(before, values) },
  });

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function saveSettings(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();

  const parsed = readSpecs(fd, ENGINE_SPECS);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const defaultPlan = fd.get("default_plan_name");
  parsed.values.default_plan_name = typeof defaultPlan === "string" ? defaultPlan : "";

  const result = await persist(actor, parsed.values, "settings.update");
  return result.ok ? { ok: true, message: "Settings saved." } : result;
}

/**
 * Backup and retention. The message says what will now happen to old rows,
 * because the difference between "copied then deleted" and "just deleted" is
 * one empty box and is not recoverable afterwards.
 */
export async function saveBackupSettings(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();

  const parsed = readSpecs(fd, BACKUP_SPECS);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const result = await persist(actor, parsed.values, "settings.update_backup");
  if (!result.ok) return result;

  revalidatePath("/admin");

  const days = Number(parsed.values.data_retention_days);
  const every = Number(parsed.values.backup_interval_days);
  const sheet = String(parsed.values.backup_sheet_id ?? "");

  if (parsed.values.purge_enabled !== true) {
    return { ok: true, message: "Saved. Nothing is deleted automatically while this is switched off." };
  }
  if (days === -1) {
    return { ok: true, message: "Saved. Everything is kept for ever and nothing is deleted." };
  }
  return {
    ok: true,
    message: sheet
      ? `Saved. Every ${every} day(s), crossings older than ${days} days are copied to the sheet and then deleted.`
      : `Saved. No backup sheet is set, so every ${every} day(s) crossings older than ${days} days are deleted with no copy kept.`,
  };
}

/**
 * Razorpay. Only the public key id is stored; the secret stays in the
 * environment, so nothing here is enough to take a payment on its own. What a
 * rupee buys is set by the credit packs, not by a price in this form.
 */
export async function savePaymentSettings(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();

  const parsed = readSpecs(fd, PAYMENT_SPECS);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  if (parsed.values.razorpay_enabled === true && !parsed.values.razorpay_key_id) {
    return {
      ok: false,
      error: "Add the Razorpay key id before switching payments on, or officers see a broken page.",
    };
  }

  const result = await persist(actor, parsed.values, "settings.update_payment");
  if (!result.ok) return result;

  revalidatePath("/admin/credits");
  revalidatePath("/portal/plan");

  return {
    ok: true,
    message: parsed.values.razorpay_enabled
      ? "Payment settings saved. Checkout still needs RAZORPAY_KEY_SECRET in the environment before an officer can pay."
      : "Payment settings saved. Officers cannot buy credits, so add credits by hand on their page.",
  };
}

/**
 * Runs a tracking sweep immediately, from the admin panel. Useful for checking
 * the whole pipeline end to end without waiting for the scheduled call.
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
      checked: summary.checked,
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
    `${summary.checked} truck${summary.checked === 1 ? "" : "s"} checked`,
    `${summary.newEvents} new crossing${summary.newEvents === 1 ? "" : "s"}`,
    `${summary.alerts} alert${summary.alerts === 1 ? "" : "s"} (${summary.alertsDelivered} delivered)`,
  ];
  if (summary.failed > 0) parts.push(`${summary.failed} failed`);
  if (summary.skipped > 0) parts.push(`${summary.skipped} skipped, out of credits`);
  if (summary.deferred > 0) parts.push(`${summary.deferred} left for the next run`);
  if (summary.errors.length > 0) parts.push(`${summary.errors.length} error(s)`);
  if (summary.backup?.ran) parts.push("backup ran");

  return { ok: true, message: `${parts.join(" · ")} in ${(summary.durationMs / 1000).toFixed(1)}s.` };
}

/**
 * Backs up and clears old history on demand, ignoring both the interval and the
 * automatic switch - the admin pressing this button is the decision.
 *
 * Nothing is deleted when a sheet is configured but could not be written, so a
 * broken backup can never quietly turn into a deletion.
 */
export async function runBackupNow(
  _prev: ActionResult | null,
  _fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();

  const summary = await maybeBackupAndPurge(true);
  const deleted =
    summary.purged.truckEvents + summary.purged.searchLogs + summary.purged.alertLogs;

  await writeAudit(actor, {
    action: "data.backup",
    entity: "settings",
    meta: {
      ran: summary.ran,
      reason: summary.reason ?? null,
      backedUp: summary.backedUp,
      purged: summary.purged,
      sheetError: summary.sheetError ?? null,
    },
  });

  revalidatePath("/admin/settings");
  revalidatePath("/admin");

  if (summary.sheetError) {
    return {
      ok: false,
      error: `Nothing was deleted: the backup sheet could not be written. ${friendlyError(summary.sheetError)}`,
    };
  }

  if (!summary.ran) {
    return {
      ok: true,
      message:
        summary.reason === "keep_forever"
          ? "Nothing to do — history is set to be kept for ever."
          : "Nothing to do right now.",
    };
  }

  const copied =
    summary.backedUp > 0
      ? `${summary.backedUp.toLocaleString("en-IN")} crossing(s) copied to the sheet`
      : "nothing to copy";

  return {
    ok: true,
    message: `${copied}, ${deleted.toLocaleString("en-IN")} row(s) deleted (${summary.purged.truckEvents} crossings, ${summary.purged.searchLogs} searches, ${summary.purged.alertLogs} alerts).`,
  };
}
