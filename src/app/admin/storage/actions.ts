"use server";

import { revalidatePath } from "next/cache";

import { KEEP_FOREVER, parseKeepDays } from "./keep-days";
import { diffFields, writeAudit } from "@/lib/audit";
import { assertSuperAdmin } from "@/lib/auth";
import { loadRetentionRules, maybeExportAndPurge, type EntityOutcome } from "@/lib/backup";
import { friendlyError, reportError } from "@/lib/errors";
import { bool, fail, str } from "@/lib/forms";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, RetentionRule } from "@/lib/types";

/**
 * Retention is edited one table at a time.
 *
 * There is deliberately no form that saves every rule at once. A bulk save is
 * how a protected table gets a finite window by accident: the admin came to
 * shorten search_logs, the money rules were on the same form, and one submit
 * carried all seven. One form per rule means the only rule a submit can change
 * is the one whose entity it posts.
 */

const n = (value: number) => value.toLocaleString("en-IN");

async function loadRule(entity: string): Promise<RetentionRule | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("retention_rules")
    .select("*")
    .eq("entity", entity)
    .maybeSingle();
  return (data as RetentionRule | null) ?? null;
}

export async function saveRetentionRule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const entity = str(fd, "entity");
  if (!entity) return fail("Which table? The form did not say.");

  // The rule is read back rather than trusted from the form. is_protected and
  // the label decide whether this save is allowed and what the confirmation
  // has to say, so neither may come from something a browser can edit.
  const rule = await loadRule(entity);
  if (!rule) {
    return fail(
      `There is no retention rule for ${entity}. Run 0016_retention_rules_and_sheets.sql against the project, then reload.`,
    );
  }

  const parsed = parseKeepDays(str(fd, "keep_days"));
  if (!parsed.ok) return fail(`${rule.label}: ${parsed.error}`);

  const keepDays = parsed.days;
  const backupBeforeDelete = bool(fd, "backup_before_delete");
  const isEnabled = bool(fd, "is_enabled");

  /*
   * The guard that matters. A protected rule may not be saved with a finite
   * window unless the confirmation came with it - every time, not only the
   * first, because the state that destroys the record is "finite", not "just
   * changed to finite".
   */
  if (rule.is_protected && keepDays !== KEEP_FOREVER && !bool(fd, "confirm_trim")) {
    return fail(
      `${rule.label} is a money record, not a log. Tick the box that says what a ${keepDays}-day window destroys before saving it.`,
    );
  }

  const values = {
    keep_days: keepDays,
    backup_before_delete: backupBeforeDelete,
    is_enabled: isEnabled,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin.from("retention_rules").update(values).eq("entity", entity);
  if (error) return fail(reportError(`retention rule ${entity}`, error));

  /*
   * The customer's own records page prints "crossings older than N days are
   * cleared automatically", and it reads data_retention_days rather than this
   * table. Mirroring the crossings window keeps that sentence true instead of
   * leaving a stale promise on a page the customer sees.
   */
  if (entity === "truck_events") {
    await admin.from("app_settings").upsert(
      {
        key: "data_retention_days",
        value: keepDays as never,
        updated_at: new Date().toISOString(),
        updated_by: actor.id,
      },
      { onConflict: "key" },
    );
  }

  await writeAudit(actor, {
    action: "retention.update",
    entity: "retention_rule",
    entityId: entity,
    entityLabel: rule.label,
    meta: {
      protected: rule.is_protected,
      confirmed_trim: rule.is_protected ? bool(fd, "confirm_trim") : undefined,
      changes: diffFields(
        {
          keep_days: rule.keep_days,
          backup_before_delete: rule.backup_before_delete,
          is_enabled: rule.is_enabled,
        },
        { keep_days: keepDays, backup_before_delete: backupBeforeDelete, is_enabled: isEnabled },
      ),
    },
  });

  revalidatePath("/admin/storage");
  revalidatePath("/admin/settings");
  if (entity === "truck_events") revalidatePath("/portal/records");

  if (!isEnabled) {
    return {
      ok: true,
      message: `Saved. ${rule.label} is switched off, so nothing in it is ever deleted, whatever the window says.`,
    };
  }
  if (keepDays === KEEP_FOREVER) {
    return { ok: true, message: `Saved. ${rule.label} is kept for ever and nothing is deleted.` };
  }
  return {
    ok: true,
    message: backupBeforeDelete
      ? `Saved. ${rule.label} older than ${keepDays} days is copied to a sheet and then deleted. If the copy fails, nothing is deleted.`
      : `Saved. ${rule.label} older than ${keepDays} days is deleted with no copy kept anywhere. This cannot be undone afterwards.`,
  };
}

/* -------------------------------------------------------------------------- */
/* run it now                                                                  */
/* -------------------------------------------------------------------------- */

/** One entity's outcome as a sentence. */
function describe(outcome: EntityOutcome, label: string): string {
  if (outcome.error) {
    // The important half is not the error, it is that the rows are still here.
    return `${label}: nothing deleted — ${friendlyError(outcome.error)}`;
  }
  if (outcome.exported === 0 && outcome.deleted === 0) {
    return `${label}: nothing older than ${outcome.keepDays} days`;
  }
  if (outcome.deletedWithoutBackup) {
    return `${label}: ${n(outcome.deleted)} deleted, no copy kept`;
  }
  return `${label}: ${n(outcome.exported)} copied, ${n(outcome.deleted)} deleted`;
}

/**
 * Exports and trims on demand, ignoring both the interval and the automatic
 * switch - the admin pressing the button is the decision.
 *
 * Every entity is reported separately because they do not share a fate: one
 * table can copy and delete cleanly in the same run where another's sheet is
 * unreachable and keeps all its rows.
 */
export async function runExportNow(
  _prev: ActionResult | null,
  _fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();

  let summary;
  try {
    summary = await maybeExportAndPurge(true);
  } catch (error) {
    return fail(
      reportError("manual sheet export", error, "The export could not run. Nothing was deleted."),
    );
  }

  const labels = new Map(
    (await loadRetentionRules(getSupabaseAdmin())).map((rule) => [rule.entity, rule.label]),
  );

  await writeAudit(actor, {
    action: "data.export",
    entity: "retention",
    meta: {
      ran: summary.ran,
      reason: summary.reason ?? null,
      accounts: summary.accounts,
      exported: summary.exported,
      deleted: summary.deleted,
      durationMs: summary.durationMs,
      entities: summary.entities,
      errors: summary.errors,
    },
  });

  revalidatePath("/admin/storage");
  revalidatePath("/admin/settings");
  revalidatePath("/admin");

  if (!summary.ran) {
    return {
      ok: true,
      message:
        summary.reason === "nothing_to_do"
          ? "Nothing to do. Every table is either kept for ever or switched off, so there is nothing to copy out and nothing to delete."
          : "Nothing to do right now.",
    };
  }

  const parts = summary.entities.map((outcome) =>
    describe(outcome, labels.get(outcome.entity) ?? outcome.entity),
  );

  // Every table failed, so nothing at all was deleted. That reads as a failure
  // rather than a report, however calmly each line is worded.
  const allFailed =
    summary.entities.length > 0 && summary.entities.every((outcome) => Boolean(outcome.error));
  if (allFailed) {
    return { ok: false, error: `Nothing was deleted. ${parts.join(" · ")}` };
  }

  const headline =
    `${n(summary.exported)} row(s) copied and ${n(summary.deleted)} deleted across ` +
    `${n(summary.accounts)} account(s) in ${(summary.durationMs / 1000).toFixed(1)}s`;

  return { ok: true, message: `${headline}. ${parts.join(" · ")}.` };
}
