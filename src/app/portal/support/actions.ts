"use server";

import { revalidatePath } from "next/cache";

import { assertSuperAdmin } from "@/lib/auth";
import { pushAdmins } from "@/lib/admin-alerts";
import {
  loadThread,
  markThreadRead,
  postMessage,
  type ChatMessage,
} from "@/lib/chat";
import { reportError } from "@/lib/errors";
import { fail, str } from "@/lib/forms";
import { assertPortalUser } from "@/lib/officer";
import { sendPushToUser } from "@/lib/push";
import { rateLimit, rateLimitMessage } from "@/lib/ratelimit";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";

/**
 * Both ends of the conversation, in one file.
 *
 * They are here together because the pair has to agree about three things -
 * which conversation a message belongs to, who counts as having read it, and
 * who gets woken up - and those are exactly the things that drift when the
 * customer's half and the admin's half live in different folders.
 *
 * WHOSE CONVERSATION IS NEVER POSTED. The customer's half takes it from the
 * session and ignores the form entirely. The admin's half does read a user id
 * off the form, because an admin is legitimately writing into somebody else's
 * conversation - and that is gated on assertSuperAdmin() first, which is the
 * whole of the difference between the two.
 */

/** A phone notification can fail for a hundred reasons; none of them lose the message. */
async function notify(
  userIds: string[],
  payload: { title: string; body: string; tag: string; url: string },
): Promise<void> {
  await Promise.allSettled(userIds.map((id) => sendPushToUser(id, payload)));
}

/**
 * A one-line preview for the notification.
 *
 * The whole message would be wrong in two ways: a lock screen truncates it
 * anyway, and a notification is read by whoever is holding the phone rather
 * than by the account that owns it.
 */
function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 119)}…` : flat;
}

/* -------------------------------------------------------------------------- */
/* the customer's half                                                         */
/* -------------------------------------------------------------------------- */

export async function sendCustomerMessage(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const session = await assertPortalUser();

    const body = str(fd, "body");
    if (!body) return fail("Type a message first.");

    const throttle = await rateLimit("chat:user", session.id);
    if (!throttle.allowed) return fail(rateLimitMessage(throttle, "messages sent"));

    const admin = getSupabaseAdmin();
    const posted = await postMessage(admin, {
      // From the session. A customer can only ever write into their own
      // conversation, so there is nothing here for a form to influence.
      userId: session.id,
      senderRole: "customer",
      senderId: session.id,
      body,
    });
    if (!posted.ok) return fail(posted.error);

    /*
     * Wake the desk, not one person. Awaited rather than detached: work that
     * outlives a serverless response is killed, so a fire-and-forget push is
     * one that lands on a warm instance and quietly does not on a cold one.
     */
    const who = session.profile.full_name?.trim() || session.email;
    // Through pushAdmins so the "Customer message" switch on /admin/settings
    // decides; it reads the desk itself.
    await pushAdmins(admin, "chat", {
      title: `Message from ${who}`,
      body: preview(body),
      // One notification per conversation, replaced rather than stacked. Six
      // lines in a row from one customer is one thing to look at, not six.
      tag: `chat-${session.id}`,
      url: `/admin/chat/${session.id}`,
    });

    revalidatePath("/portal/support");
    revalidatePath("/admin/chat");
    return { ok: true };
  } catch (error) {
    return fail(reportError("sendCustomerMessage crashed", error, "That message did not send."));
  }
}

/** Opening the conversation is what marks the admin's messages read. */
export async function markCustomerThreadRead(): Promise<void> {
  try {
    const session = await assertPortalUser();
    await markThreadRead(getSupabaseAdmin(), session.id, "customer");
    revalidatePath("/portal", "layout");
  } catch (error) {
    // Nothing the reader can do about it, and nothing they lose - the badge
    // stays up and clears on the next open.
    console.error("[chat] markCustomerThreadRead:", (error as Error).message);
  }
}

/**
 * What the open chat window polls for.
 *
 * Returns the whole visible thread rather than a delta. Seven days of support
 * chat is a few dozen short rows, a diff would need a cursor the client has to
 * keep correct across reconnects, and the failure mode of getting that wrong is
 * a message that never appears.
 */
export async function pollCustomerThread(): Promise<ChatMessage[]> {
  const session = await assertPortalUser();
  return loadThread(getSupabaseAdmin(), session.id, "customer");
}

/* -------------------------------------------------------------------------- */
/* the admin's half                                                            */
/* -------------------------------------------------------------------------- */

export async function sendAdminMessage(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  try {
    const session = await assertSuperAdmin();

    const userId = str(fd, "user_id");
    const body = str(fd, "body");
    if (!userId) return fail("That conversation could not be found.");
    if (!body) return fail("Type a message first.");

    const throttle = await rateLimit("chat:user", session.id);
    if (!throttle.allowed) return fail(rateLimitMessage(throttle, "messages sent"));

    const admin = getSupabaseAdmin();

    /*
     * The posted id is checked against a real, active account before anything
     * is written. Without this a mistyped id would open a conversation against
     * a user that does not exist, which nobody would ever see or be able to
     * delete - and a suspended account should not be messaged at all.
     */
    const { data: recipient } = await admin
      .from("profiles")
      .select("id, status")
      .eq("id", userId)
      .maybeSingle<{ id: string; status: string }>();

    if (!recipient) return fail("That account no longer exists.");
    if (recipient.status !== "active") return fail("That account is suspended.");

    const posted = await postMessage(admin, {
      userId: recipient.id,
      senderRole: "admin",
      senderId: session.id,
      body,
    });
    if (!posted.ok) return fail(posted.error);

    // The customer sees the product's name, not an admin's. They are talking to
    // Rahdari, and a personal name here would be the first time they had seen it.
    const { brandName } = await loadSettings(admin);
    await notify([recipient.id], {
      title: brandName || "Rahdari",
      body: preview(body),
      tag: "chat-support",
      url: "/portal/support",
    });

    revalidatePath(`/admin/chat/${recipient.id}`);
    revalidatePath("/admin/chat");
    revalidatePath("/portal/support");
    return { ok: true };
  } catch (error) {
    return fail(reportError("sendAdminMessage crashed", error, "That message did not send."));
  }
}

export async function markAdminThreadRead(userId: string): Promise<void> {
  try {
    await assertSuperAdmin();
    if (!userId) return;
    await markThreadRead(getSupabaseAdmin(), userId, "admin");
    revalidatePath("/admin", "layout");
  } catch (error) {
    console.error("[chat] markAdminThreadRead:", (error as Error).message);
  }
}

export async function pollAdminThread(userId: string): Promise<ChatMessage[]> {
  await assertSuperAdmin();
  if (!userId) return [];
  return loadThread(getSupabaseAdmin(), userId, "admin");
}
