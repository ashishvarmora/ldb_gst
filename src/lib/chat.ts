import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = SupabaseClient;

/**
 * Direct messages between one customer and the admin desk.
 *
 * Everything here is scoped by an id the CALLER has already established from
 * the session. Nothing in this file works out who is asking, and nothing in it
 * accepts a user id off a form - the actions above it do that, the same way
 * checkout-actions.ts does. The table has RLS on with no policy, so these
 * service-role queries are the only route to it at all.
 */

/**
 * The window, in one place on this side.
 *
 * Its twin is the default on purge_chat_messages() in 0056. They must agree:
 * a read window LONGER than the purge shows gaps where deleted messages were,
 * and a read window SHORTER hides messages that still exist and that the other
 * side can still see - which on a two-sided conversation means one person
 * answering something the other can no longer read.
 */
export const CHAT_KEEP_DAYS = 7;

/** Nothing before this is shown, whether or not the purge has got to it yet. */
function windowStart(): string {
  return new Date(Date.now() - CHAT_KEEP_DAYS * 86_400_000).toISOString();
}

export type ChatMessage = {
  id: string;
  body: string;
  senderRole: "customer" | "admin";
  createdAt: string;
  readAt: string | null;
  /** True when this account wrote it - decided by the caller, not the row. */
  mine: boolean;
};

/** One row of the admin's conversation list. */
export type ChatThread = {
  userId: string;
  name: string;
  email: string;
  lastMessageAt: string;
  lastBody: string;
  lastSenderRole: "customer" | "admin";
  unreadForAdmin: number;
};

type Row = {
  id: string;
  user_id: string;
  body: string;
  sender_role: "customer" | "admin";
  created_at: string;
  read_at: string | null;
};

const COLUMNS = "id, user_id, body, sender_role, created_at, read_at";

/**
 * One conversation, oldest first.
 *
 * Oldest first because that is the order a conversation is read in, and it
 * means the newest message is at the bottom where a chat window scrolls to.
 * The limit is a safety rail rather than paging: seven days of support chat
 * does not reach 500 messages, and if it ever did, the older half is the half
 * nobody is scrolling back to.
 */
export async function loadThread(
  admin: Admin,
  userId: string,
  viewerRole: "customer" | "admin",
): Promise<ChatMessage[]> {
  const { data, error } = await admin
    .from("chat_messages")
    .select(COLUMNS)
    .eq("user_id", userId)
    .gte("created_at", windowStart())
    .order("created_at", { ascending: true })
    .limit(500);

  if (error) {
    console.error("[chat] could not read a thread:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: (row as Row).id,
    body: (row as Row).body,
    senderRole: (row as Row).sender_role,
    createdAt: (row as Row).created_at,
    readAt: (row as Row).read_at,
    mine: (row as Row).sender_role === viewerRole,
  }));
}

/**
 * Writes one message and hands back what was written.
 *
 * The body is trimmed here as well as in the form, because this is the last
 * point before a check constraint turns "  " into a database error rather than
 * a sentence somebody can read.
 */
export async function postMessage(
  admin: Admin,
  {
    userId,
    senderRole,
    senderId,
    body,
  }: {
    userId: string;
    senderRole: "customer" | "admin";
    senderId: string;
    body: string;
  },
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const trimmed = body.trim().slice(0, 2000);
  if (!trimmed) return { ok: false, error: "Type a message first." };

  const { data, error } = await admin
    .from("chat_messages")
    .insert({ user_id: userId, sender_role: senderRole, sender_id: senderId, body: trimmed })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    console.error("[chat] could not post a message:", error.message);
    return { ok: false, error: "That message did not send. Try again." };
  }

  return { ok: true, id: data.id };
}

/**
 * Marks the OTHER side's messages in this conversation as read.
 *
 * `readerRole` is who is doing the reading, so the filter is on everything they
 * did not write. Marking your own messages read is how an unread badge becomes
 * permanently zero for the person who most needs to see it.
 *
 * Already-read rows are excluded rather than overwritten, so read_at keeps
 * saying when it was FIRST read instead of when the page was last refreshed.
 */
export async function markThreadRead(
  admin: Admin,
  userId: string,
  readerRole: "customer" | "admin",
): Promise<void> {
  const writtenByTheOtherSide = readerRole === "admin" ? "customer" : "admin";

  const { error } = await admin
    .from("chat_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("sender_role", writtenByTheOtherSide)
    .is("read_at", null);

  if (error) console.error("[chat] could not mark a thread read:", error.message);
}

/**
 * How many messages are waiting for this customer. Drives the badge in the
 * portal nav, so it counts only what the ADMIN wrote.
 */
export async function unreadForCustomer(admin: Admin, userId: string): Promise<number> {
  const { count, error } = await admin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("sender_role", "admin")
    .is("read_at", null)
    .gte("created_at", windowStart());

  if (error) {
    console.error("[chat] could not count unread for a customer:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** The same figure for the admin console's nav: everything customers have sent. */
export async function unreadForAdmin(admin: Admin): Promise<number> {
  const { count, error } = await admin
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("sender_role", "customer")
    .is("read_at", null)
    .gte("created_at", windowStart());

  if (error) {
    console.error("[chat] could not count unread for the admin:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * The admin's conversation list: everyone who has said anything this week.
 *
 * Aggregated here rather than in a view. At this size it is one indexed read of
 * a week of messages and a group-by over a few hundred rows, and keeping it in
 * TypeScript means the unread rule - "written by the customer, not yet read" -
 * is stated once, beside the two count functions that state it the same way,
 * rather than once here and again in SQL where the two can drift.
 *
 * Unread first, then most recent. A support desk's list is a queue before it is
 * a history, so the thing waiting for an answer belongs at the top even when
 * somebody else has messaged more recently.
 */
export async function loadThreads(admin: Admin): Promise<ChatThread[]> {
  const { data, error } = await admin
    .from("chat_messages")
    .select(COLUMNS)
    .gte("created_at", windowStart())
    .order("created_at", { ascending: true });

  if (error) {
    console.error("[chat] could not list conversations:", error.message);
    return [];
  }

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) return [];

  type Partial = {
    lastMessageAt: string;
    lastBody: string;
    lastSenderRole: "customer" | "admin";
    unreadForAdmin: number;
  };
  const byUser = new Map<string, Partial>();

  // Ascending, so the last write for a user is genuinely their newest message.
  for (const row of rows) {
    const current = byUser.get(row.user_id) ?? {
      lastMessageAt: row.created_at,
      lastBody: row.body,
      lastSenderRole: row.sender_role,
      unreadForAdmin: 0,
    };
    current.lastMessageAt = row.created_at;
    current.lastBody = row.body;
    current.lastSenderRole = row.sender_role;
    if (row.sender_role === "customer" && row.read_at === null) current.unreadForAdmin += 1;
    byUser.set(row.user_id, current);
  }

  const { data: people } = await admin
    .from("profiles")
    .select("id, full_name, email")
    .in("id", [...byUser.keys()]);

  const nameOf = new Map(
    (people ?? []).map((p) => [
      p.id as string,
      { name: (p.full_name as string | null) ?? "", email: (p.email as string | null) ?? "" },
    ]),
  );

  return [...byUser.entries()]
    .map(([userId, partial]) => {
      const who = nameOf.get(userId);
      return {
        userId,
        // A conversation with no name against it is still a conversation, so
        // the email carries it rather than the row being dropped.
        name: who?.name || who?.email || "Unknown account",
        email: who?.email ?? "",
        ...partial,
      };
    })
    .sort((a, b) => {
      if (a.unreadForAdmin !== b.unreadForAdmin) return b.unreadForAdmin - a.unreadForAdmin;
      return b.lastMessageAt.localeCompare(a.lastMessageAt);
    });
}

/**
 * Every super admin, so a customer's message reaches whoever is on the desk
 * rather than one named person who may be asleep.
 */
export async function adminRecipients(admin: Admin): Promise<string[]> {
  const { data, error } = await admin
    .from("profiles")
    .select("id")
    .eq("role", "super_admin")
    .eq("status", "active");

  if (error) {
    console.error("[chat] could not list admins:", error.message);
    return [];
  }
  return (data ?? []).map((row) => row.id as string);
}

/** Housekeeping, called from the tracking sweep. Never throws. */
export async function purgeOldChat(): Promise<number> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.rpc("purge_chat_messages", { p_days: CHAT_KEEP_DAYS });
    if (error) {
      console.error("[chat] purge failed:", error.message);
      return 0;
    }
    return Number(data ?? 0);
  } catch (error) {
    console.error("[chat] purge crashed:", (error as Error).message);
    return 0;
  }
}
