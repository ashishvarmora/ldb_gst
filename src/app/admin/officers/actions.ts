"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { assertSuperAdmin } from "@/lib/auth";
import { diffFields, writeAudit } from "@/lib/audit";
import { NUMERIC_LIMITS, parseLimitInput } from "@/lib/limits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* form helpers                                                                */
/* -------------------------------------------------------------------------- */

function str(fd: FormData, name: string): string | null {
  const raw = fd.get(name);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Checkbox posts "false" (hidden) then "true" (checked); take the last one. */
function bool(fd: FormData, name: string): boolean {
  const all = fd.getAll(name);
  return all.includes("true");
}

function fail(error: string): ActionResult {
  return { ok: false, error };
}

function firstZodError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the values and try again.";
}

/** 14 chars, unambiguous alphabet, safe to read out over the phone. */
function generatePassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const profileSchema = z.object({
  email: z.string().email("Enter a valid email address."),
  full_name: z.string().min(2, "Enter the officer's name.").nullable(),
  phone: z
    .string()
    .regex(/^[0-9+\-\s()]{6,20}$/, "Phone number looks wrong.")
    .nullable(),
});

/* -------------------------------------------------------------------------- */
/* create                                                                      */
/* -------------------------------------------------------------------------- */

export async function createOfficer(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const email = str(fd, "email")?.toLowerCase() ?? "";
  const parsed = profileSchema.safeParse({
    email,
    full_name: str(fd, "full_name"),
    phone: str(fd, "phone"),
  });
  if (!parsed.success) return fail(firstZodError(parsed.error));

  const suppliedPassword = str(fd, "password");
  if (suppliedPassword && suppliedPassword.length < 8) {
    return fail("Password must be at least 8 characters.");
  }
  const password = suppliedPassword ?? generatePassword();
  const planId = str(fd, "plan_id");

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.full_name, role: "officer" },
  });

  if (createError || !created.user) {
    const message = createError?.message ?? "Could not create the account.";
    return fail(
      /already been registered|already exists/i.test(message)
        ? `An account already exists for ${email}.`
        : message,
    );
  }

  const userId = created.user.id;

  // That insert already ran assign_default_plan(), which gave the row the
  // default plan and the credits it includes. Only write plan_id when the admin
  // picked one - writing null would take the default straight back off.
  const planPatch = planId
    ? { plan_id: planId, plan_assigned_at: new Date().toISOString() }
    : {};

  // The on_auth_user_created trigger already inserted a bare row; fill it in.
  const { error: profileError } = await admin
    .from("profiles")
    .upsert(
      {
        id: userId,
        email,
        full_name: parsed.data.full_name,
        phone: parsed.data.phone,
        designation: str(fd, "designation"),
        office: str(fd, "office"),
        district: str(fd, "district"),
        state: str(fd, "state") ?? "Gujarat",
        role: "officer",
        status: "active",
        ...planPatch,
        plan_expires_on: str(fd, "plan_expires_on"),
        notes: str(fd, "notes"),
        created_by: actor.id,
      },
      { onConflict: "id" },
    );

  if (profileError) {
    // Do not leave an auth user with no profile behind.
    await admin.auth.admin.deleteUser(userId);
    return fail(`Account rolled back: ${profileError.message}`);
  }

  const chatId = str(fd, "telegram_chat_id");
  if (chatId) {
    await admin.from("telegram_configs").upsert({ user_id: userId, chat_id: chatId });
  }

  await writeAudit(actor, {
    action: "officer.create",
    entity: "profile",
    entityId: userId,
    entityLabel: email,
    meta: { plan_id: planId, generated_password: !suppliedPassword },
  });

  revalidatePath("/admin/officers");
  revalidatePath("/admin");

  return {
    ok: true,
    message: suppliedPassword
      ? `${email} created. Share the password you set.`
      : `${email} created. Temporary password: ${password} — copy it now, it is not stored in readable form.`,
  };
}

/* -------------------------------------------------------------------------- */
/* update details                                                              */
/* -------------------------------------------------------------------------- */

export async function updateOfficer(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const userId = str(fd, "user_id");
  if (!userId) return fail("Missing officer id.");

  const parsed = profileSchema
    .omit({ email: true })
    .safeParse({ full_name: str(fd, "full_name"), phone: str(fd, "phone") });
  if (!parsed.success) return fail(firstZodError(parsed.error));

  const { data: before } = await admin
    .from("profiles")
    .select("full_name, phone, designation, office, district, state, notes")
    .eq("id", userId)
    .maybeSingle();

  const patch = {
    full_name: parsed.data.full_name,
    phone: parsed.data.phone,
    designation: str(fd, "designation"),
    office: str(fd, "office"),
    district: str(fd, "district"),
    state: str(fd, "state"),
    notes: str(fd, "notes"),
  };

  const { error } = await admin.from("profiles").update(patch).eq("id", userId);
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "officer.update",
    entity: "profile",
    entityId: userId,
    entityLabel: patch.full_name,
    meta: { changes: diffFields(before, patch) },
  });

  revalidatePath(`/admin/officers/${userId}`);
  revalidatePath("/admin/officers");
  return { ok: true, message: "Details saved." };
}

/* -------------------------------------------------------------------------- */
/* plan assignment                                                             */
/* -------------------------------------------------------------------------- */

export async function assignPlan(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const userId = str(fd, "user_id");
  if (!userId) return fail("Missing officer id.");

  const planId = str(fd, "plan_id");
  const expiresOn = str(fd, "plan_expires_on");

  if (expiresOn && Number.isNaN(Date.parse(expiresOn))) {
    return fail("Expiry date is not valid.");
  }

  let planName = "no plan";
  if (planId) {
    const { data: plan } = await admin
      .from("plans")
      .select("name, is_active")
      .eq("id", planId)
      .maybeSingle();
    if (!plan) return fail("That plan no longer exists.");
    if (!plan.is_active) return fail(`Plan "${plan.name}" is archived. Reactivate it first.`);
    planName = plan.name;
  }

  const { error } = await admin
    .from("profiles")
    .update({
      plan_id: planId,
      plan_assigned_at: planId ? new Date().toISOString() : null,
      plan_expires_on: expiresOn,
    })
    .eq("id", userId);
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "officer.assign_plan",
    entity: "profile",
    entityId: userId,
    entityLabel: planName,
    meta: { plan_id: planId, plan_expires_on: expiresOn },
  });

  revalidatePath(`/admin/officers/${userId}`);
  revalidatePath("/admin/officers");
  return { ok: true, message: `Plan set to ${planName}.` };
}

/* -------------------------------------------------------------------------- */
/* per-officer limit overrides                                                 */
/* -------------------------------------------------------------------------- */

export async function saveOverrides(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const userId = str(fd, "user_id");
  if (!userId) return fail("Missing officer id.");

  // Only numeric limits are left - every feature switch a plan used to carry is
  // now either paid for out of the credit balance or set once for the platform.
  const row: Record<string, number | string | null> = { user_id: userId };

  for (const field of NUMERIC_LIMITS) {
    const value = parseLimitInput(fd.get(`override_${field.key}`), {
      allowUnlimited: field.allowUnlimited,
      allowBlank: true,
      min: field.min,
    });
    if (value === undefined) {
      return fail(
        `"${field.label}": enter a whole number of at least ${field.min}` +
          (field.allowUnlimited ? `, or -1 for unlimited, or leave blank to inherit.` : `, or leave blank to inherit.`),
      );
    }
    row[field.key] = value;
  }

  row.reason = str(fd, "override_reason");
  row.updated_at = new Date().toISOString();

  const hasAnyOverride = NUMERIC_LIMITS.some((f) => row[f.key] !== null);

  const { data: before } = await admin
    .from("user_limit_overrides")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!hasAnyOverride) {
    if (before) {
      const { error } = await admin.from("user_limit_overrides").delete().eq("user_id", userId);
      if (error) return fail(error.message);
    }
    await writeAudit(actor, {
      action: "officer.clear_overrides",
      entity: "profile",
      entityId: userId,
      meta: {},
    });
    revalidatePath(`/admin/officers/${userId}`);
    revalidatePath("/admin/officers");
    return { ok: true, message: "Overrides cleared — the officer now follows the plan exactly." };
  }

  const { error } = await admin
    .from("user_limit_overrides")
    .upsert(row, { onConflict: "user_id" });
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "officer.set_overrides",
    entity: "profile",
    entityId: userId,
    meta: { changes: diffFields(before as Record<string, unknown> | null, row) },
  });

  revalidatePath(`/admin/officers/${userId}`);
  revalidatePath("/admin/officers");
  return { ok: true, message: "Overrides saved." };
}

/* -------------------------------------------------------------------------- */
/* status, password, integrations, usage                                       */
/* -------------------------------------------------------------------------- */

export async function setOfficerStatus(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const userId = str(fd, "user_id");
  const status = fd.get("status");
  if (!userId) return fail("Missing officer id.");
  if (status !== "active" && status !== "suspended") return fail("Unknown status.");
  if (userId === actor.id) return fail("You cannot suspend your own account.");

  const { error } = await admin.from("profiles").update({ status }).eq("id", userId);
  if (error) return fail(error.message);

  // A suspended officer must not keep polling in the background either.
  if (status === "suspended") {
    await admin.from("tracked_trucks").update({ is_active: false }).eq("user_id", userId);
  }

  await writeAudit(actor, {
    action: status === "active" ? "officer.reactivate" : "officer.suspend",
    entity: "profile",
    entityId: userId,
    meta: {},
  });

  revalidatePath(`/admin/officers/${userId}`);
  revalidatePath("/admin/officers");
  return {
    ok: true,
    message:
      status === "active"
        ? "Account reactivated. Tracking stays paused until the officer re-enables each truck."
        : "Account suspended and background tracking paused.",
  };
}

export async function resetOfficerPassword(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const userId = str(fd, "user_id");
  if (!userId) return fail("Missing officer id.");

  const supplied = str(fd, "new_password");
  if (supplied && supplied.length < 8) return fail("Password must be at least 8 characters.");
  const password = supplied ?? generatePassword();

  const { error } = await admin.auth.admin.updateUserById(userId, { password });
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "officer.reset_password",
    entity: "profile",
    entityId: userId,
    meta: { generated: !supplied },
  });

  return {
    ok: true,
    message: supplied
      ? "Password updated."
      : `New password: ${password} — copy it now, it cannot be shown again.`,
  };
}

export async function saveOfficerIntegrations(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const userId = str(fd, "user_id");
  if (!userId) return fail("Missing officer id.");

  const chatId = str(fd, "telegram_chat_id");
  const botToken = str(fd, "telegram_bot_token");
  const telegramEnabled = bool(fd, "telegram_is_enabled");

  const { error: tgError } = await admin.from("telegram_configs").upsert(
    {
      user_id: userId,
      chat_id: chatId,
      bot_token: botToken,
      is_enabled: telegramEnabled,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
  if (tgError) return fail(tgError.message);

  await writeAudit(actor, {
    action: "officer.update_integrations",
    entity: "profile",
    entityId: userId,
    meta: { telegram: Boolean(chatId), enabled: telegramEnabled },
  });

  revalidatePath(`/admin/officers/${userId}`);
  return { ok: true, message: "Telegram settings saved." };
}

export async function deleteOfficer(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const admin = getSupabaseAdmin();

  const userId = str(fd, "user_id");
  const typed = str(fd, "confirm_email")?.toLowerCase();
  if (!userId) return fail("Missing officer id.");
  if (userId === actor.id) return fail("You cannot delete your own account.");

  const { data: profile } = await admin
    .from("profiles")
    .select("email")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return fail("That officer no longer exists.");

  if (typed !== profile.email.toLowerCase()) {
    return fail(`Type ${profile.email} exactly to confirm deletion.`);
  }

  // Deleting the auth user cascades to profiles and everything keyed off it.
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "officer.delete",
    entity: "profile",
    entityId: userId,
    entityLabel: profile.email,
    meta: {},
  });

  revalidatePath("/admin/officers");
  revalidatePath("/admin");
  redirect("/admin/officers");
}
