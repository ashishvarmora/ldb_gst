"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { intervalWords, needsPlaza } from "@/lib/alerts";
import { bool, done, fail, int, looksLikeTruckNumber, normalizeTruck, str } from "@/lib/forms";
import { MAX_INTERVAL_MINUTES } from "@/lib/intervals";
import { runManualLookup } from "@/lib/manual-search";
import { assertPortalUser, loadOverview, truckSlotsLeft } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult, AlertRuleTemplate, TrackedTruck } from "@/lib/types";

export async function addTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const raw = str(fd, "truck_number");
  if (!raw) return fail("Enter a truck number.");

  const truckNumber = normalizeTruck(raw);
  if (!looksLikeTruckNumber(truckNumber)) {
    return fail(`"${truckNumber}" does not look like a registration number. Example: GJ02AT8546`);
  }

  const overview = await loadOverview(session.id);
  if (!overview) return fail("Could not read your account. Sign in again.");
  if (!overview.plan_id) {
    return fail("No plan is assigned to your account yet. Ask your administrator to assign one.");
  }

  const { data: existing } = await admin
    .from("tracked_trucks")
    .select("id, is_active")
    .eq("user_id", session.id)
    .eq("truck_number", truckNumber)
    .maybeSingle();

  if (existing?.is_active) {
    return fail(`${truckNumber} is already under tracking.`);
  }

  if (truckSlotsLeft(overview) <= 0) {
    return fail(
      `Your plan allows ${overview.truck_limit} tracked truck${overview.truck_limit === 1 ? "" : "s"}. Pause or remove one first, or ask your administrator for more.`,
    );
  }

  const payload = {
    user_id: session.id,
    truck_number: truckNumber,
    label: str(fd, "label"),
    is_active: true,
  };

  // Re-activating a paused truck keeps its history instead of duplicating it.
  const { error } = existing
    ? await admin.from("tracked_trucks").update(payload).eq("id", existing.id)
    : await admin.from("tracked_trucks").insert(payload);

  if (error) return fail(error.message);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");

  return done(`${truckNumber} added. Open it and add an alert to start checking it.`);
}

export async function updateTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Missing truck id.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("is_active")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle<Pick<TrackedTruck, "is_active">>();

  if (!truck) return fail("That truck is not on your list.");

  const activating = bool(fd, "is_active");
  if (activating && !truck.is_active) {
    const overview = await loadOverview(session.id);
    if (overview && truckSlotsLeft(overview) <= 0) {
      return fail(
        `Resuming this truck would exceed your limit of ${overview.truck_limit}. Pause another one first.`,
      );
    }
  }

  const { error } = await admin
    .from("tracked_trucks")
    .update({ label: str(fd, "label"), is_active: activating })
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done("Saved.");
}

/* -------------------------------------------------------------------------- */
/* alerts on one truck                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Attaches one of the admin's alert rules to a truck. Several rows may use the
 * same rule, so an officer can watch two plazas on the same vehicle.
 */
export async function addTruckAlert(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  const templateId = str(fd, "template_id");
  if (!truckId) return fail("Missing truck id.");
  if (!templateId) return fail("Choose an alert first.");

  const overview = await loadOverview(session.id);
  if (!overview) return fail("Could not read your account. Sign in again.");
  if (!overview.alerts_enabled) {
    return fail("Alerts are not enabled on your plan. Ask your administrator.");
  }

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("id")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle();

  if (!truck) return fail("That truck is not on your list.");

  const { data: template } = await admin
    .from("alert_rule_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle<AlertRuleTemplate>();

  if (!template || !template.is_active) {
    return fail("That alert is no longer available. Pick another one.");
  }

  const requested = int(fd, "interval_minutes", { min: 1, max: MAX_INTERVAL_MINUTES });
  const minutes = Math.max(
    requested ?? template.default_interval_minutes,
    template.min_interval_minutes,
  );

  const plaza = str(fd, "plaza");
  if (needsPlaza(template.kind) && !plaza) {
    return fail(`"${template.name}" watches one toll plaza. Choose which plaza to watch.`);
  }

  const { error } = await admin.from("truck_alerts").insert({
    user_id: session.id,
    tracked_truck_id: truckId,
    template_id: template.id,
    is_enabled: true,
    interval_minutes: minutes,
    plaza: needsPlaza(template.kind) ? plaza : null,
  });

  if (error) return fail(error.message);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done(
    requested !== null && minutes > requested
      ? `${template.name} added. This alert may run every ${intervalWords(template.min_interval_minutes)} at the fastest, so that was used.`
      : `${template.name} added, every ${intervalWords(minutes)}.`,
  );
}

export async function setTruckAlertEnabled(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const alertId = str(fd, "alert_id");
  const enabled = fd.get("is_enabled") === "true";
  if (!alertId) return fail("Missing alert id.");

  const { data: alert, error } = await admin
    .from("truck_alerts")
    .update({ is_enabled: enabled })
    .eq("id", alertId)
    .eq("user_id", session.id)
    .select("tracked_truck_id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!alert) return fail("That alert is not on your list.");

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${alert.tracked_truck_id}`);

  return done(enabled ? "Alert switched on." : "Alert switched off.");
}

export async function deleteTruckAlert(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const alertId = str(fd, "alert_id");
  if (!alertId) return fail("Missing alert id.");

  const { data: alert, error } = await admin
    .from("truck_alerts")
    .delete()
    .eq("id", alertId)
    .eq("user_id", session.id)
    .select("tracked_truck_id")
    .maybeSingle();

  if (error) return fail(error.message);
  if (!alert) return fail("That alert is not on your list.");

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${alert.tracked_truck_id}`);

  return done("Alert removed.");
}

/* -------------------------------------------------------------------------- */
/* the truck itself                                                            */
/* -------------------------------------------------------------------------- */

export async function setTruckPaused(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  const active = fd.get("is_active") === "true";
  if (!truckId) return fail("Missing truck id.");

  if (active) {
    const overview = await loadOverview(session.id);
    if (overview && truckSlotsLeft(overview) <= 0) {
      return fail(
        `Resuming would exceed your limit of ${overview.truck_limit} tracked trucks. Pause another one first.`,
      );
    }
  }

  const { error } = await admin
    .from("tracked_trucks")
    .update({ is_active: active })
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);
  return done(active ? "Tracking resumed." : "Tracking paused. No credits are spent while paused.");
}

/** Officer-initiated re-check. Spends a manual credit, same as a search. */
export async function checkTruckNow(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Missing truck id.");

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("truck_number")
    .eq("id", truckId)
    .eq("user_id", session.id)
    .maybeSingle();

  if (!truck) return fail("That truck is not on your list.");

  const result = await runManualLookup({ userId: session.id, truckNumber: truck.truck_number });
  if (!result.ok) return fail(result.error);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  revalidatePath(`/portal/trucks/${truckId}`);

  return done(
    result.newCount > 0
      ? `${result.newCount} new crossing${result.newCount === 1 ? "" : "s"} found.`
      : `No new crossings. The portal is showing ${result.found} recent crossing${result.found === 1 ? "" : "s"}.`,
  );
}

/**
 * Removes the truck and its alerts, and keeps the toll crossings. The history
 * is the case record; the truck row is only the instruction to keep checking.
 */
export async function removeTruck(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const truckId = str(fd, "truck_id");
  if (!truckId) return fail("Missing truck id.");

  const { error } = await admin
    .from("tracked_trucks")
    .delete()
    .eq("id", truckId)
    .eq("user_id", session.id);

  if (error) return fail(error.message);

  revalidatePath("/portal");
  revalidatePath("/portal/trucks");
  redirect("/portal/trucks");
}
