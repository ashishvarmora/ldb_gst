"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import {
  AUDIENCES,
  FREQUENCIES,
  TONES,
  sendAnnouncementPush,
  type Announcement,
  type AnnouncementAudience,
  type AnnouncementFrequency,
  type AnnouncementTone,
} from "@/lib/announcements";
import { assertSuperAdmin } from "@/lib/auth";
import { diffFields, writeAudit } from "@/lib/audit";
import { bool, done, fail, str } from "@/lib/forms";
import { normaliseIndianMobile } from "@/lib/phone";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";

/**
 * Create, edit, pause, duplicate, delete and push an announcement. Every one
 * is super-admin only and audited, like every other write in /admin.
 */

/**
 * A datetime-local value, read as India time.
 *
 * The input gives "2026-10-19T18:30" with no zone, and the browser that typed
 * it may not be in India - an admin travelling, or a laptop left on UTC. The
 * whole product runs on IST, so the zone is stated here rather than taken from
 * wherever the form happened to be filled in.
 */
function parseIst(raw: string | null): Date | null | undefined {
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw)) return undefined;
  const d = new Date(`${raw}:00+05:30`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * A button link must be a path on this site or an https url. Anything else -
 * javascript:, data:, a bare "//evil.example" - is refused here and again by
 * the table's check constraint.
 */
function safeUrl(raw: string): boolean {
  if (raw.startsWith("/") && !raw.startsWith("//")) return true;
  try {
    return new URL(raw).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Emails and phone numbers typed into the "chosen customers" box, turned into
 * account ids. Every unknown one is named in the refusal, so the admin can fix
 * the typo rather than send to fewer people than they think.
 */
async function resolveUsers(raw: string | null): Promise<{ ids: string[] } | { error: string }> {
  const tokens = [
    ...new Set(
      (raw ?? "")
        .split(/[\n,;]+/)
        .map((t) => t.trim())
        .filter(Boolean),
    ),
  ];
  if (tokens.length === 0) return { error: "Add at least one customer's email or phone number." };
  if (tokens.length > 500) return { error: "That is more than 500 people. Use a plan audience instead." };

  const admin = getSupabaseAdmin();
  const emails = tokens.filter((t) => t.includes("@")).map((t) => t.toLowerCase());
  const phones = new Map<string, string>();
  const unreadable: string[] = [];
  for (const t of tokens.filter((t) => !t.includes("@"))) {
    const phone = normaliseIndianMobile(t);
    if (phone) phones.set(phone, t);
    else unreadable.push(t);
  }
  if (unreadable.length > 0) {
    return { error: `Not an email or an Indian mobile number: ${unreadable.join(", ")}.` };
  }

  const found = new Map<string, string>();
  if (emails.length > 0) {
    const { data, error } = await admin.from("profiles").select("id,email").in("email", emails);
    if (error) return { error: error.message };
    for (const row of (data ?? []) as { id: string; email: string }[]) {
      found.set(row.email.toLowerCase(), row.id);
    }
  }
  if (phones.size > 0) {
    const { data, error } = await admin
      .from("profiles")
      .select("id,phone")
      .in("phone", [...phones.keys()]);
    if (error) return { error: error.message };
    for (const row of (data ?? []) as { id: string; phone: string }[]) found.set(row.phone, row.id);
  }

  const missing = [
    ...emails.filter((e) => !found.has(e)),
    ...[...phones.entries()].filter(([p]) => !found.has(p)).map(([, typed]) => typed),
  ];
  if (missing.length > 0) {
    return { error: `No account found for: ${missing.join(", ")}.` };
  }

  return { ids: [...new Set(found.values())] };
}

type AnnouncementValues = {
  title: string;
  body: string;
  tone: AnnouncementTone;
  show_banner: boolean;
  show_popup: boolean;
  send_push: boolean;
  audience: AnnouncementAudience;
  target_plan_ids: string[];
  target_user_ids: string[];
  frequency: AnnouncementFrequency;
  dismissible: boolean;
  starts_at: string;
  ends_at: string | null;
  cta_label: string | null;
  cta_url: string | null;
};

/** Everything on the form, checked. A sentence back for anything wrong. */
async function readForm(fd: FormData): Promise<{ values: AnnouncementValues } | { error: string }> {
  const title = str(fd, "title");
  if (!title) return { error: "Give it a title." };
  if (title.length > 120) return { error: "Keep the title under 120 characters." };

  const body = str(fd, "body") ?? "";
  if (body.length > 1000) return { error: "Keep the message under 1,000 characters." };

  const tone = str(fd, "tone") as AnnouncementTone | null;
  if (!tone || !TONES.includes(tone)) return { error: "Choose a style." };

  const show_banner = bool(fd, "show_banner");
  const show_popup = bool(fd, "show_popup");
  const send_push = bool(fd, "send_push");
  if (!show_banner && !show_popup && !send_push) {
    return { error: "Choose at least one of banner, popup or phone notification." };
  }

  const audience = str(fd, "audience") as AnnouncementAudience | null;
  if (!audience || !AUDIENCES.includes(audience)) return { error: "Choose who it is for." };

  let target_plan_ids: string[] = [];
  let target_user_ids: string[] = [];
  if (audience === "plans") {
    target_plan_ids = fd
      .getAll("target_plan_ids")
      .filter((v): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v));
    if (target_plan_ids.length === 0) return { error: "Tick at least one plan." };
  }
  if (audience === "users") {
    const resolved = await resolveUsers(str(fd, "target_users"));
    if ("error" in resolved) return resolved;
    target_user_ids = resolved.ids;
  }

  const frequency = str(fd, "frequency") as AnnouncementFrequency | null;
  if (!frequency || !FREQUENCIES.includes(frequency)) return { error: "Choose how often it shows." };

  const startsAt = parseIst(str(fd, "starts_at"));
  const endsAt = parseIst(str(fd, "ends_at"));
  if (startsAt === undefined || endsAt === undefined) return { error: "A date could not be read." };
  const start = startsAt ?? new Date();
  if (endsAt && endsAt.getTime() <= start.getTime()) {
    return { error: "The end has to be after the start." };
  }

  const cta_label = str(fd, "cta_label");
  const cta_url = str(fd, "cta_url");
  if ((cta_label === null) !== (cta_url === null)) {
    return { error: "A button needs both a label and a link, or neither." };
  }
  if (cta_label && cta_label.length > 40) return { error: "Keep the button label under 40 characters." };
  if (cta_url && !safeUrl(cta_url)) {
    return { error: "The button link must be a page on this site (starting with /) or an https:// address." };
  }

  return {
    values: {
      title,
      body,
      tone,
      show_banner,
      show_popup,
      send_push,
      audience,
      target_plan_ids,
      target_user_ids,
      frequency,
      dismissible: bool(fd, "dismissible"),
      starts_at: start.toISOString(),
      ends_at: endsAt ? endsAt.toISOString() : null,
      cta_label,
      cta_url,
    },
  };
}

/**
 * Sends the phone notification now if the announcement has already started,
 * after the response has gone back - so a big audience never holds the admin's
 * form open, and the save itself cannot fail because a phone did not answer.
 * One that starts later is sent by the tracking sweep at its start time.
 */
function pushIfDue(row: Pick<Announcement, "id" | "send_push" | "push_sent_at" | "starts_at" | "is_active">) {
  if (!row.send_push || row.push_sent_at || !row.is_active) return false;
  if (new Date(row.starts_at).getTime() > Date.now()) return false;
  after(async () => {
    await sendAnnouncementPush(row.id);
  });
  return true;
}

function revalidate() {
  revalidatePath("/admin/announcements");
  revalidatePath("/portal", "layout");
}

export async function createAnnouncement(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const parsed = await readForm(fd);
  if ("error" in parsed) return fail(parsed.error);

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("announcements")
    .insert({ ...parsed.values, is_active: true, created_by: actor.id })
    .select("*")
    .single<Announcement>();
  if (error || !data) return fail(error?.message ?? "Could not save the announcement.");

  await writeAudit(actor, {
    action: "announcement.create",
    entity: "announcement",
    entityId: data.id,
    entityLabel: data.title,
    meta: { audience: data.audience, frequency: data.frequency, push: data.send_push },
  });

  const pushing = pushIfDue(data);
  revalidate();
  return {
    ok: true,
    message: pushing ? "Published. Phone notifications are going out now." : "Saved.",
  };
}

export async function updateAnnouncement(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const id = str(fd, "id");
  if (!id) return fail("Missing announcement id.");

  const parsed = await readForm(fd);
  if ("error" in parsed) return fail(parsed.error);

  const admin = getSupabaseAdmin();
  const { data: before } = await admin
    .from("announcements")
    .select("*")
    .eq("id", id)
    .maybeSingle<Announcement>();
  if (!before) return fail("That announcement no longer exists.");

  const { data, error } = await admin
    .from("announcements")
    .update({ ...parsed.values, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single<Announcement>();
  if (error || !data) return fail(error?.message ?? "Could not save the announcement.");

  await writeAudit(actor, {
    action: "announcement.update",
    entity: "announcement",
    entityId: id,
    entityLabel: data.title,
    meta: diffFields(before as unknown as Record<string, unknown>, parsed.values),
  });

  const pushing = pushIfDue(data);
  revalidate();
  return { ok: true, message: pushing ? "Saved. Phone notifications are going out now." : "Saved." };
}

export async function setAnnouncementActive(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const id = str(fd, "id");
  if (!id) return fail("Missing announcement id.");
  const active = fd.get("is_active") === "true";

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("announcements")
    .update({ is_active: active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle<Announcement>();
  if (error) return fail(error.message);
  if (!data) return fail("That announcement no longer exists.");

  await writeAudit(actor, {
    action: active ? "announcement.resume" : "announcement.pause",
    entity: "announcement",
    entityId: id,
    entityLabel: data.title,
  });

  // Resuming one whose push was held back by the pause sends it now.
  if (active) pushIfDue(data);
  revalidate();
  return done(active ? "Resumed." : "Paused.");
}

export async function duplicateAnnouncement(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const id = str(fd, "id");
  if (!id) return fail("Missing announcement id.");

  const admin = getSupabaseAdmin();
  const { data: source } = await admin
    .from("announcements")
    .select("*")
    .eq("id", id)
    .maybeSingle<Announcement>();
  if (!source) return fail("That announcement no longer exists.");

  /*
   * Paused, with a fresh window and no push record. A copy is a draft: it
   * should not appear on anybody's screen, or buzz anybody's phone, until the
   * admin has looked at it and pressed Resume.
   */
  const now = new Date();
  const { data, error } = await admin
    .from("announcements")
    .insert({
      title: `Copy of ${source.title}`.slice(0, 120),
      body: source.body,
      tone: source.tone,
      show_banner: source.show_banner,
      show_popup: source.show_popup,
      send_push: source.send_push,
      audience: source.audience,
      target_plan_ids: source.target_plan_ids,
      target_user_ids: source.target_user_ids,
      frequency: source.frequency,
      dismissible: source.dismissible,
      starts_at: now.toISOString(),
      ends_at:
        source.ends_at && new Date(source.ends_at).getTime() > now.getTime() ? source.ends_at : null,
      cta_label: source.cta_label,
      cta_url: source.cta_url,
      is_active: false,
      created_by: actor.id,
    })
    .select("id,title")
    .single<{ id: string; title: string }>();
  if (error || !data) return fail(error?.message ?? "Could not duplicate it.");

  await writeAudit(actor, {
    action: "announcement.duplicate",
    entity: "announcement",
    entityId: data.id,
    entityLabel: data.title,
    meta: { from: id },
  });

  revalidate();
  return done("Copied. The copy is paused until you resume it.");
}

export async function deleteAnnouncement(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const id = str(fd, "id");
  if (!id) return fail("Missing announcement id.");

  const admin = getSupabaseAdmin();
  const { data: before } = await admin
    .from("announcements")
    .select("title")
    .eq("id", id)
    .maybeSingle<{ title: string }>();
  const { error } = await admin.from("announcements").delete().eq("id", id);
  if (error) return fail(error.message);

  await writeAudit(actor, {
    action: "announcement.delete",
    entity: "announcement",
    entityId: id,
    entityLabel: before?.title ?? null,
  });

  revalidate();
  return done("Deleted.");
}

/**
 * "Send push now": switches the phone channel on if it was off and sends,
 * whatever the start time says. Still once only - sendAnnouncementPush()
 * claims the row, so pressing it twice, or pressing it while the sweep is
 * sending, sends nothing the second time.
 */
export async function sendAnnouncementPushNow(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const actor = await assertSuperAdmin();
  const id = str(fd, "id");
  if (!id) return fail("Missing announcement id.");

  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("announcements")
    .select("*")
    .eq("id", id)
    .maybeSingle<Announcement>();
  if (!row) return fail("That announcement no longer exists.");
  if (row.push_sent_at) return fail("Its phone notification has already been sent.");
  if (!row.is_active) return fail("Resume it first - a paused announcement sends nothing.");
  if (row.ends_at && new Date(row.ends_at).getTime() <= Date.now()) {
    return fail("It has already ended.");
  }

  if (!row.send_push) {
    const { error } = await admin.from("announcements").update({ send_push: true }).eq("id", id);
    if (error) return fail(error.message);
  }

  await writeAudit(actor, {
    action: "announcement.push",
    entity: "announcement",
    entityId: id,
    entityLabel: row.title,
  });

  after(async () => {
    await sendAnnouncementPush(id);
  });

  revalidate();
  return done("Sending now. Refresh in a minute to see how many phones it reached.");
}
