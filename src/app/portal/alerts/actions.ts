"use server";

import { revalidatePath } from "next/cache";

import { bool, done, fail, int, list, str } from "@/lib/forms";
import { assertPortalUser, loadOverview } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, AlertRuleKind } from "@/lib/types";

const KINDS: AlertRuleKind[] = [
  "approaching_city",
  "state_entry",
  "state_exit",
  "no_movement",
  "excessive_movement",
  "watchlist_move",
  "night_travel",
  "route_prediction",
];

/**
 * Turns the kind-specific form fields into the rule's config jsonb. Anything the
 * officer leaves blank falls back to the platform default at evaluation time,
 * so a half-filled rule still behaves sensibly.
 */
function buildConfig(kind: AlertRuleKind, fd: FormData): Record<string, unknown> | string {
  switch (kind) {
    case "approaching_city": {
      const city = str(fd, "city");
      const tolls = list(fd, "tolls");
      if (!city) return "Name the city you want to be warned about.";
      if (tolls.length === 0) {
        return "List at least one toll plaza keyword, comma separated.";
      }
      return { city, tolls };
    }

    case "state_entry":
    case "state_exit": {
      const state = str(fd, "state");
      if (kind === "state_exit" && !state) {
        return "Choose the state you want to be told about when the truck leaves it.";
      }
      return state ? { state } : {};
    }

    case "no_movement": {
      const hours = int(fd, "hours", { min: 1, max: 168 });
      if (hours === null) return "Enter a whole number of hours between 1 and 168.";
      return { hours };
    }

    case "excessive_movement": {
      const tolls = int(fd, "toll_count", { min: 2, max: 50 });
      const hours = int(fd, "hours", { min: 1, max: 48 });
      if (tolls === null) return "Toll count must be between 2 and 50.";
      if (hours === null) return "Window must be between 1 and 48 hours.";
      return { tolls, hours };
    }

    case "watchlist_move":
      return {};

    case "night_travel": {
      const from = str(fd, "from");
      const to = str(fd, "to");
      const clock = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!from || !clock.test(from)) return "Start time must look like 22:00.";
      if (!to || !clock.test(to)) return "End time must look like 06:00.";
      return { from, to };
    }

    case "route_prediction": {
      const sequence = list(fd, "sequence");
      if (sequence.length < 2) {
        return "List at least two plazas in order, comma separated, e.g. Dahod, Godhra, Vadodara.";
      }
      return { sequence, destination: str(fd, "destination") ?? sequence[sequence.length - 1] };
    }

    default:
      return {};
  }
}

export async function createAlertRule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const kind = str(fd, "kind") as AlertRuleKind | null;
  if (!kind || !KINDS.includes(kind)) return fail("Choose what should trigger the alert.");

  const name = str(fd, "name");
  if (!name) return fail("Give the rule a name you will recognise.");

  const overview = await loadOverview(session.id);
  if (!overview) return fail("Could not read your account. Sign in again.");
  if (!overview.alert_rules_enabled) {
    return fail("Alert rules are not enabled on your plan. Ask your administrator.");
  }

  if (overview.max_alert_rules !== -1) {
    const { count } = await admin
      .from("alert_rules")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.id);

    if ((count ?? 0) >= overview.max_alert_rules) {
      return fail(
        overview.max_alert_rules === 0
          ? "Your plan does not include alert rules."
          : `Your plan allows ${overview.max_alert_rules} rule${overview.max_alert_rules === 1 ? "" : "s"}. Delete one first.`,
      );
    }
  }

  const config = buildConfig(kind, fd);
  if (typeof config === "string") return fail(config);

  const cooldown = int(fd, "cooldown_minutes", { min: 0, max: 10_080 });
  if (cooldown !== null) config.cooldown_minutes = cooldown;

  const { error } = await admin.from("alert_rules").insert({
    user_id: session.id,
    name,
    kind,
    config,
    is_active: true,
    notify_telegram: bool(fd, "notify_telegram"),
    notify_sheet: bool(fd, "notify_sheet"),
  });

  if (error) return fail(error.message);

  revalidatePath("/portal/alerts");
  return done(`Rule "${name}" created. It applies to every truck you track.`);
}

export async function updateAlertRule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const ruleId = str(fd, "rule_id");
  if (!ruleId) return fail("Missing rule id.");

  const { data: existing } = await admin
    .from("alert_rules")
    .select("kind")
    .eq("id", ruleId)
    .eq("user_id", session.id)
    .maybeSingle();

  if (!existing) return fail("That rule is not yours.");

  const name = str(fd, "name");
  if (!name) return fail("Give the rule a name.");

  const kind = existing.kind as AlertRuleKind;
  const config = buildConfig(kind, fd);
  if (typeof config === "string") return fail(config);

  const cooldown = int(fd, "cooldown_minutes", { min: 0, max: 10_080 });
  if (cooldown !== null) config.cooldown_minutes = cooldown;

  const { error } = await admin
    .from("alert_rules")
    .update({
      name,
      config,
      notify_telegram: bool(fd, "notify_telegram"),
      notify_sheet: bool(fd, "notify_sheet"),
    })
    .eq("id", ruleId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  revalidatePath("/portal/alerts");
  return done("Rule saved.");
}

export async function toggleAlertRule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const ruleId = str(fd, "rule_id");
  const active = fd.get("is_active") === "true";
  if (!ruleId) return fail("Missing rule id.");

  const { error } = await admin
    .from("alert_rules")
    .update({ is_active: active })
    .eq("id", ruleId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  revalidatePath("/portal/alerts");
  return done(active ? "Rule switched on." : "Rule switched off.");
}

export async function deleteAlertRule(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const ruleId = str(fd, "rule_id");
  if (!ruleId) return fail("Missing rule id.");

  const { error } = await admin
    .from("alert_rules")
    .delete()
    .eq("id", ruleId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  revalidatePath("/portal/alerts");
  return done("Rule deleted. Past alerts are kept.");
}
