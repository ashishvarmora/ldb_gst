"use server";

import { revalidatePath } from "next/cache";

import { ALERT_KIND_LABEL } from "@/lib/alerts";
import { diffFields, writeAudit } from "@/lib/audit";
import { assertSuperAdmin } from "@/lib/auth";
import { bool, fail, int, str } from "@/lib/forms";
import { MAX_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES } from "@/lib/intervals";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, AlertRuleKind, AlertRuleTemplate } from "@/lib/types";

/**
 * The admin's catalogue of alert rules. People pick from it; they never write a
 * rule themselves.
 *
 * The set of kinds lives in one place - ALERT_KIND_LABEL in src/lib/alerts.ts.
 * The dropdown is built from it and this validator checks against it, so adding
 * a fourth kind is one entry there plus a case in evaluateAlert(). Nothing in
 * the admin area needs touching.
 */
const ALERT_KINDS = Object.keys(ALERT_KIND_LABEL) as AlertRuleKind[];

function isAlertKind(value: string | null): value is AlertRuleKind {
  return value !== null && (ALERT_KINDS as string[]).includes(value);
}

type RuleDraft = {
  name: string;
  kind: AlertRuleKind;
  description: string | null;
  min_interval_minutes: number;
  default_interval_minutes: number;
  sort_order: number;
  is_active: boolean;
};

/** Read the whole rule off the form, or say what is wrong with it. */
function readRule(fd: FormData): { rule: RuleDraft } | { error: string } {
  const name = str(fd, "name");
  if (!name) return { error: "Give the rule a name people will recognise." };

  const kind = str(fd, "kind");
  if (!isAlertKind(kind)) return { error: "Choose what the rule watches for." };

  const min = int(fd, "min_interval_minutes", {
    min: MIN_INTERVAL_MINUTES,
    max: MAX_INTERVAL_MINUTES,
  });
  if (min === null) {
    return {
      error: `Fastest repeat must be between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES} minutes.`,
    };
  }

  const preset = int(fd, "default_interval_minutes", {
    min: MIN_INTERVAL_MINUTES,
    max: MAX_INTERVAL_MINUTES,
  });
  if (preset === null) {
    return {
      error: `Suggested interval must be between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES} minutes.`,
    };
  }

  // A new alert starts on the suggested interval, so a suggestion below the
  // floor would be refused the moment it was saved.
  if (preset < min) {
    return { error: "The suggested interval cannot be faster than the fastest repeat." };
  }

  return {
    rule: {
      name,
      kind,
      description: str(fd, "description"),
      min_interval_minutes: min,
      default_interval_minutes: preset,
      sort_order: int(fd, "sort_order", { min: 0, max: 9999 }) ?? 100,
      is_active: bool(fd, "is_active"),
    },
  };
}

export async function createAlertRule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const parsed = readRule(fd);
  if ("error" in parsed) return fail(parsed.error);

  const { data, error } = await admin
    .from("alert_rule_templates")
    .insert(parsed.rule)
    .select("id")
    .single();
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "alert_rule.create",
    entity: "alert_rule_template",
    entityId: data.id,
    entityLabel: parsed.rule.name,
    meta: parsed.rule,
  });

  revalidatePath("/admin/alerts");
  return { ok: true, message: `Rule "${parsed.rule.name}" added to the catalogue.` };
}

export async function updateAlertRule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const ruleId = str(fd, "rule_id");
  if (!ruleId) return fail("Missing rule id.");

  const parsed = readRule(fd);
  if ("error" in parsed) return fail(parsed.error);

  const { data: before } = await admin
    .from("alert_rule_templates")
    .select("*")
    .eq("id", ruleId)
    .maybeSingle<AlertRuleTemplate>();

  const { error } = await admin
    .from("alert_rule_templates")
    .update(parsed.rule)
    .eq("id", ruleId);
  if (error) return fail(error.message);

  // Alerts already on this rule keep their own interval, so tightening the
  // floor does not retro-fix them. Say how many are affected.
  const { count } = await admin
    .from("truck_alerts")
    .select("id", { count: "exact", head: true })
    .eq("template_id", ruleId)
    .lt("interval_minutes", parsed.rule.min_interval_minutes);

  await writeAudit(actor, {
    action: "alert_rule.update",
    entity: "alert_rule_template",
    entityId: ruleId,
    entityLabel: parsed.rule.name,
    meta: {
      changes: diffFields(before as unknown as Record<string, unknown> | null, parsed.rule),
      below_new_floor: count ?? 0,
    },
  });

  revalidatePath("/admin/alerts");
  return {
    ok: true,
    message:
      (count ?? 0) > 0
        ? `Rule saved. ${count} existing alert${count === 1 ? " is" : "s are"} still faster than the new floor - edit them or leave them.`
        : "Rule saved.",
  };
}

export async function setAlertRuleActive(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const ruleId = str(fd, "rule_id");
  const active = fd.get("is_active") === "true";
  if (!ruleId) return fail("Missing rule id.");

  const { data: rule } = await admin
    .from("alert_rule_templates")
    .select("name")
    .eq("id", ruleId)
    .maybeSingle<{ name: string }>();

  const { error } = await admin
    .from("alert_rule_templates")
    .update({ is_active: active })
    .eq("id", ruleId);
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: active ? "alert_rule.activate" : "alert_rule.deactivate",
    entity: "alert_rule_template",
    entityId: ruleId,
    entityLabel: rule?.name ?? null,
    meta: {},
  });

  revalidatePath("/admin/alerts");
  return {
    ok: true,
    message: active
      ? "Rule is offered again."
      : "Rule hidden from the picker. Alerts already using it keep running.",
  };
}

/**
 * Nudge a rule up or down the list people see.
 *
 * Swapping sort_order with the neighbour keeps the numbers the admin typed
 * meaningful, instead of renumbering the whole catalogue on every move.
 */
export async function moveAlertRule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const ruleId = str(fd, "rule_id");
  const direction = fd.get("direction");
  if (!ruleId) return fail("Missing rule id.");
  if (direction !== "up" && direction !== "down") return fail("Unknown direction.");

  const { data: rules } = await admin
    .from("alert_rule_templates")
    .select("id, name, sort_order")
    .order("sort_order")
    .order("name");

  const list = (rules ?? []) as Pick<AlertRuleTemplate, "id" | "name" | "sort_order">[];
  const index = list.findIndex((rule) => rule.id === ruleId);
  if (index === -1) return fail("That rule no longer exists.");

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= list.length) return { ok: true };

  const current = list[index];
  const neighbour = list[target];

  // Equal sort_order values are broken by name, so a swap alone would not move
  // anything. Step past the neighbour instead.
  const currentOrder =
    current.sort_order === neighbour.sort_order
      ? neighbour.sort_order + (direction === "up" ? -1 : 1)
      : neighbour.sort_order;

  await admin
    .from("alert_rule_templates")
    .update({ sort_order: currentOrder })
    .eq("id", current.id);

  if (current.sort_order !== neighbour.sort_order) {
    await admin
      .from("alert_rule_templates")
      .update({ sort_order: current.sort_order })
      .eq("id", neighbour.id);
  }

  await writeAudit(actor, {
    action: "alert_rule.reorder",
    entity: "alert_rule_template",
    entityId: current.id,
    entityLabel: current.name,
    meta: { direction, swapped_with: neighbour.name },
  });

  revalidatePath("/admin/alerts");
  return { ok: true };
}

export async function deleteAlertRule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const ruleId = str(fd, "rule_id");
  if (!ruleId) return fail("Missing rule id.");

  const { data: rule } = await admin
    .from("alert_rule_templates")
    .select("name")
    .eq("id", ruleId)
    .maybeSingle<{ name: string }>();

  // truck_alerts.template_id is ON DELETE CASCADE, so this takes every alert
  // built on the rule with it. Counted first so the audit row records what was
  // actually destroyed.
  const { count } = await admin
    .from("truck_alerts")
    .select("id", { count: "exact", head: true })
    .eq("template_id", ruleId);

  const { error } = await admin.from("alert_rule_templates").delete().eq("id", ruleId);
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "alert_rule.delete",
    entity: "alert_rule_template",
    entityId: ruleId,
    entityLabel: rule?.name ?? null,
    meta: { alerts_removed: count ?? 0 },
  });

  revalidatePath("/admin/alerts");
  return {
    ok: true,
    message:
      (count ?? 0) > 0
        ? `Rule deleted, along with ${count} alert${count === 1 ? "" : "s"} that used it.`
        : "Rule deleted.",
  };
}
