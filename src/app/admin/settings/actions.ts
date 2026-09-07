"use server";

import { revalidatePath } from "next/cache";

import { assertSuperAdmin, type SessionUser } from "@/lib/auth";
import { diffFields, writeAudit } from "@/lib/audit";
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
  | { kind: "int"; min: number; max: number }
  // Site panel. "optional_*" kinds accept blank, which the public pages read as
  // "do not show this at all" - see loadSettings().
  | { kind: "name"; max: number }
  | { kind: "optional_text"; max: number }
  | { kind: "optional_email" }
  | { kind: "optional_phone" }
  | { kind: "optional_link" }
);

const ENGINE_SPECS: SettingSpec[] = [
  { key: "ldb_api_url", label: "LDB API endpoint", kind: "url" },
  { key: "tracking_enabled", label: "Background tracking", kind: "bool" },
  { key: "no_activity_hours", label: "No-activity threshold", kind: "int", min: 1, max: 168 },
  { key: "revisit_minutes", label: "Same-plaza window", kind: "int", min: 5, max: 1440 },
  {
    key: "signup_free_credits",
    label: "Free credits for a new account",
    kind: "int",
    min: 0,
    max: 100000,
  },
  {
    key: "tracking_failure_cutoff",
    label: "Pause a truck after this many failed checks",
    kind: "int",
    min: 1,
    max: 1000,
  },
  /*
   * The fallback for the other automatic stop. An officer who set their own
   * number for a truck keeps it; this is what every other truck follows.
   *
   * The ceiling is a year rather than a week because "never stop this one" is
   * a legitimate answer for a lorry that spends months on a site, and the
   * floor is an hour because the sweep does not run more often than that -
   * anything shorter would pause a truck before it had been checked once.
   */
  {
    key: "inactive_pause_hours",
    label: "Pause a truck after this long without movement",
    kind: "int",
    min: 1,
    max: 8760,
  },
];

/*
 * Sheets and the export schedule only. How long each table is kept moved to one
 * row per table in retention_rules, edited on /admin/storage - a single
 * data_retention_days for crossings, searches, alerts and the money ledger
 * alike was too blunt to be safe.
 */
const BACKUP_SPECS: SettingSpec[] = [
  { key: "backup_sheet_id", label: "Fallback sheet", kind: "sheet" },
  { key: "sheet_export_interval_days", label: "Export every", kind: "int", min: 1, max: 365 },
  { key: "purge_enabled", label: "Automatic export", kind: "bool" },
];

const PAYMENT_SPECS: SettingSpec[] = [
  { key: "razorpay_enabled", label: "Razorpay", kind: "bool" },
  { key: "razorpay_key_id", label: "Razorpay key id", kind: "key_id" },
];

/*
 * Its own form rather than four more fields on the Site one, because the two
 * are opposites: every box on the Site panel is published, and every box here
 * is internal. Saving one form must not touch the other's keys - readSpecs()
 * reads a missing field as blank - so they cannot share a list anyway.
 */
const NOTIFY_SPECS: SettingSpec[] = [
  { key: "admin_notify_email", label: "Notification email", kind: "optional_email" },
  { key: "admin_notify_signup", label: "New customer", kind: "bool" },
  { key: "admin_notify_plan", label: "Plan bought", kind: "bool" },
  { key: "admin_notify_topup", label: "Credits topped up", kind: "bool" },
];

const SITE_SPECS: SettingSpec[] = [
  { key: "brand_name", label: "Product name", kind: "name", max: 60 },
  { key: "signup_enabled", label: "Public sign-up", kind: "bool" },
  { key: "support_email", label: "Support email", kind: "optional_email" },
  { key: "support_phone", label: "Support phone", kind: "optional_phone" },
  { key: "support_address", label: "Postal address", kind: "optional_text", max: 300 },
  { key: "privacy_url", label: "Privacy policy link", kind: "optional_link" },
  { key: "terms_url", label: "Terms link", kind: "optional_link" },
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

      case "name":
        // The one site field that cannot be blank: it is what the product calls
        // itself on every public page, and an empty header reads as a bug.
        if (text.length < 2 || text.length > spec.max) {
          return { error: `${spec.label} must be between 2 and ${spec.max} characters.` };
        }
        values[spec.key] = text;
        break;

      case "optional_text":
        if (text.length > spec.max) {
          return { error: `${spec.label} must be ${spec.max} characters or fewer.` };
        }
        values[spec.key] = text;
        break;

      case "optional_email":
        // Deliberately loose. This address is printed for people to write to,
        // never signed in to, so a shape check is all it is worth.
        if (text !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text)) {
          return { error: `${spec.label} does not look like an email address.` };
        }
        values[spec.key] = text.toLowerCase();
        break;

      case "optional_phone":
        if (text !== "" && !/^[0-9+\-\s()]{6,20}$/.test(text)) {
          return { error: `${spec.label} looks wrong. Digits, spaces, + - ( ) only.` };
        }
        values[spec.key] = text;
        break;

      case "optional_link":
        if (text !== "" && !/^https?:\/\/\S+$/.test(text)) {
          return { error: `${spec.label} must start with http:// or https://, or be left blank.` };
        }
        values[spec.key] = text;
        break;

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

  // No default plan is written any more: a new account starts with no plan and
  // no credits, and buys or is given one. The setting it used to save was read
  // only by the trigger that 0010 dropped.
  const parsed = readSpecs(fd, ENGINE_SPECS);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const result = await persist(actor, parsed.values, "settings.update");
  return result.ok ? { ok: true, message: "Settings saved." } : result;
}

/**
 * The public face of the site: what it calls itself, whether anyone may sign up,
 * and how to reach a human. Every one of these is rendered to people who are not
 * signed in, so the message says where the change will show up.
 */
export async function saveSiteSettings(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();

  const parsed = readSpecs(fd, SITE_SPECS);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const result = await persist(actor, parsed.values, "settings.update_site");
  if (!result.ok) return result;

  // The brand name and the footer details are read by every public page, so the
  // whole tree is revalidated rather than guessing which routes show them.
  revalidatePath("/", "layout");

  return {
    ok: true,
    message:
      parsed.values.signup_enabled === true
        ? `Saved. The site calls itself "${parsed.values.brand_name}" and anyone can register.`
        : `Saved. The site calls itself "${parsed.values.brand_name}". Registration is closed, so new accounts can only be created from this console.`,
  };
}

/**
 * Who hears about a new customer or a payment, and which of those to hear.
 *
 * The address is not validated any harder than support_email is - a shape
 * check, no more - because it is a mailbox somebody types, not one that is
 * signed in to. What it IS checked for is the mistake this form makes easy:
 * turning on three events with no address to send them to, which switches
 * nothing on and looks exactly like a feature that does not work. That refuses
 * with the fix in it rather than saving a silent configuration.
 *
 * Whether mail can leave this deployment at all is a separate question, and it
 * is answered on the Health tab (emailSenderProblem) rather than re-answered
 * here - the panel copy points at it.
 */
export async function saveNotificationSettings(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();

  const parsed = readSpecs(fd, NOTIFY_SPECS);
  if ("error" in parsed) return { ok: false, error: parsed.error };

  const address = String(parsed.values.admin_notify_email ?? "");
  const events = [
    parsed.values.admin_notify_signup === true ? "a new customer" : null,
    parsed.values.admin_notify_plan === true ? "a plan bought" : null,
    parsed.values.admin_notify_topup === true ? "credits topped up" : null,
  ].filter(Boolean) as string[];

  if (!address && events.length > 0) {
    return {
      ok: false,
      error:
        "Add the address these should go to, or switch all three events off. With the box empty nothing is sent.",
    };
  }

  const result = await persist(actor, parsed.values, "settings.update_notifications");
  if (!result.ok) return result;

  if (!address) {
    return { ok: true, message: "Saved. No address is set, so no notifications are sent." };
  }
  if (events.length === 0) {
    return {
      ok: true,
      message: `Saved. ${address} is on file but every event is switched off, so nothing is sent.`,
    };
  }
  return {
    ok: true,
    message: `Saved. ${address} will be emailed when ${
      events.length === 1
        ? events[0]
        : `${events.slice(0, -1).join(", ")} or ${events[events.length - 1]}`
    } arrives.`,
  };
}

/**
 * Where copies go and how often. What is copied, and how old it has to be, is
 * per table on the Storage page.
 *
 * The message names the fallback nature of this sheet on purpose: an admin who
 * thinks this is the only sheet will assume clearing it stops every export,
 * when in fact each account may have named its own.
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
  revalidatePath("/admin/storage");

  const every = Number(parsed.values.sheet_export_interval_days);
  const sheet = String(parsed.values.backup_sheet_id ?? "");

  if (parsed.values.purge_enabled !== true) {
    return {
      ok: true,
      message:
        "Saved. Nothing is exported or deleted automatically while this is switched off — only the button on the Storage page will do it.",
    };
  }
  return {
    ok: true,
    message: sheet
      ? `Saved. Every ${every} day(s), each account's old rows are copied to its own sheet, or to this fallback sheet if it has none, and then deleted. The per-table windows are on the Storage page.`
      : `Saved. No fallback sheet is set, so an account with no sheet of its own has nowhere to copy to. Any rule set to copy first will keep its rows rather than delete them uncopied; a rule with copying switched off deletes them anyway.`,
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
      error: "Add the Razorpay key id before switching payments on, or customers see a broken page.",
    };
  }

  const result = await persist(actor, parsed.values, "settings.update_payment");
  if (!result.ok) return result;

  revalidatePath("/admin/plans");
  revalidatePath("/portal/plan");

  return {
    ok: true,
    message: parsed.values.razorpay_enabled
      ? "Payment settings saved. Checkout still needs RAZORPAY_KEY_SECRET in the environment before anyone can pay."
      : "Payment settings saved. Nobody can buy a plan or credits in the app, so assign and top up by hand on the account's page.",
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
      autoPaused: summary.autoPaused,
    },
  });

  revalidatePath("/admin");
  revalidatePath("/admin/trucks");
  revalidatePath("/admin/usage");
  revalidatePath("/admin/settings");

  if (!summary.trackingEnabled) {
    return { ok: false, error: "Tracking is switched off in the settings above." };
  }

  const stopped = summary.autoPaused.schedule + summary.autoPaused.inactive;
  const stoppedNote = stopped
    ? ` ${stopped} truck${stopped === 1 ? "" : "s"} stopped by itself (${
        [
          summary.autoPaused.schedule ? `${summary.autoPaused.schedule} reached its time limit` : null,
          summary.autoPaused.inactive ? `${summary.autoPaused.inactive} stopped moving` : null,
        ]
          .filter(Boolean)
          .join(", ")
      }).`
    : "";

  /*
   * "Nothing was due" is the ordinary answer, but it must not swallow the
   * trucks this run stopped. An admin who has just tightened the inactivity
   * setting and pressed Run now needs to see how many that switched off - the
   * sweep having checked nothing is not the same as it having done nothing.
   */
  if (summary.due === 0) {
    return {
      ok: true,
      message: `Nothing was due. ${summary.candidates} active truck${summary.candidates === 1 ? "" : "s"} on the platform, all checked recently.${stoppedNote}`,
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

  return {
    ok: true,
    message: `${parts.join(" · ")} in ${(summary.durationMs / 1000).toFixed(1)}s.${stoppedNote}`,
  };
}

/*
 * "Run the export now" used to live here as runBackupNow(). It moved to
 * src/app/admin/storage/actions.ts, next to the rules it applies: the summary
 * is now one outcome per table, and a button that reports "1,200 rows deleted"
 * without saying which tables kept theirs is worse than no button.
 */
