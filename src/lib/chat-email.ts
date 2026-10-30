import { CHAT_KEEP_DAYS } from "@/lib/chat";
import { esc, notifyTarget, sendEmail, telLink } from "@/lib/email";
import { env } from "@/lib/env";
import { fmtDayTime } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Email about a chat message that has sat unread.
 *
 * The chat is only seen by somebody who opens the app, and the whole point of a
 * support reply is that the customer did not have it open - they asked, went
 * back to their trucks, and will not look again until something tells them to.
 * Phone notifications do that for whoever installed the app; this is the
 * fallback that reaches everybody, and the same in the other direction for an
 * admin desk that is not watching the inbox.
 *
 * Called every minute by the notify cron. One mail per CONVERSATION per tick,
 * never one per message: three quick lines from support are one thing to read,
 * and three mails for them is how a sender teaches Gmail it is noise.
 *
 * Each message is mailed about at most once - chat_messages.emailed_at (0061).
 * A message that gets read inside the delay is never mailed about at all, which
 * is the point of the delay: somebody mid-conversation does not need an email
 * about the line they are looking at.
 *
 * Never throws. It runs inside a cron that does other work, and a Resend outage
 * must not stop that work.
 */

/** Only the type, for the same reason email.ts and settings.ts import it so. */
type Admin = ReturnType<typeof getSupabaseAdmin>;

type Side = "customer" | "admin";

type Row = {
  id: string;
  user_id: string;
  body: string;
  created_at: string;
};

type Person = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
};

/** Conversations mailed per side per tick. The rest wait a minute, not forever. */
const BATCH = 25;
/** Messages quoted in one mail. The newest ones; the app has the rest. */
const SHOWN = 5;
/** A long message is quoted, not reproduced - the button opens the whole of it. */
const BODY_CHARS = 500;
/**
 * Rows read per side per tick. Comfortably more than BATCH conversations'
 * worth; a backlog bigger than this is drained over the next few minutes.
 */
const ROW_LIMIT = 500;

/** Where each side reads and answers. Found from where loadThread/loadThreads are used. */
const CUSTOMER_CHAT_PATH = "/portal/support";
const adminChatPath = (userId: string) => `/admin/chat/${userId}`;

export async function sendUnseenChatEmails(
  admin: Admin,
): Promise<{ customers: number; admins: number }> {
  try {
    const settings = await loadSettings(admin);
    const delay = Math.max(0, Number(settings.chatEmailDelayMinutes) || 0);

    /*
     * Sequential, not Promise.all. The two halves touch disjoint rows so it
     * would be safe, but a tick is not in a hurry and one failing half should
     * not be able to swallow the other's count.
     */
    const customers = settings.chatEmailEnabled
      ? await sweep(admin, "customer", delay, {
          brand: settings.brandName,
          supportEmail: settings.supportEmail,
        })
      : 0;

    const admins = settings.adminNotifyChat
      ? await sweep(admin, "admin", delay, {
          brand: settings.brandName,
          supportEmail: settings.supportEmail,
        })
      : 0;

    return { customers, admins };
  } catch (error) {
    console.error("[chat-email] crashed:", error);
    return { customers: 0, admins: 0 };
  }
}

/**
 * One side's sweep. `recipient` is who is being emailed: "customer" mails a
 * customer about the ADMIN's unread messages, "admin" mails the notify list
 * about a CUSTOMER's. Returns how many mails went out.
 */
async function sweep(
  admin: Admin,
  recipient: Side,
  delayMinutes: number,
  site: { brand: string; supportEmail: string },
): Promise<number> {
  try {
    const now = Date.now();
    const writtenBy: Side = recipient === "customer" ? "admin" : "customer";

    /*
     * Oldest first, so the conversation that has waited longest is the one the
     * batch cap reaches first. The lower bound is the chat window: anything
     * older is being purged and is not visible in either app, so mailing about
     * it would link to a message that is not there.
     */
    const { data, error } = await admin
      .from("chat_messages")
      .select("id, user_id, body, created_at")
      .eq("sender_role", writtenBy)
      .is("read_at", null)
      .is("emailed_at", null)
      .lte("created_at", new Date(now - delayMinutes * 60_000).toISOString())
      .gte("created_at", new Date(now - CHAT_KEEP_DAYS * 86_400_000).toISOString())
      .order("created_at", { ascending: true })
      .limit(ROW_LIMIT);

    if (error) {
      console.error(`[chat-email] could not read unmailed (${recipient}):`, error.message);
      return 0;
    }

    const rows = (data ?? []) as Row[];
    if (rows.length === 0) return 0;

    // Insertion order of a Map is first-seen, so this keeps "waited longest first".
    const byUser = new Map<string, Row[]>();
    for (const row of rows) {
      const list = byUser.get(row.user_id) ?? [];
      list.push(row);
      byUser.set(row.user_id, list);
    }
    const batch = [...byUser.entries()].slice(0, BATCH);

    const { data: people, error: peopleError } = await admin
      .from("profiles")
      .select("id, full_name, email, phone, status")
      .in(
        "id",
        batch.map(([userId]) => userId),
      );
    if (peopleError) {
      console.error("[chat-email] could not read profiles:", peopleError.message);
      return 0;
    }
    const personOf = new Map(((people ?? []) as Person[]).map((p) => [p.id, p]));

    /*
     * Resolved once for the whole admin batch rather than per conversation:
     * notifyTarget reads settings, which are memoised, but there is no reason
     * to ask twenty-five times. Null - nobody on the list, switched off, or a
     * deployment that cannot mail strangers - leaves every row unmarked, so the
     * mail goes out once the address is fixed instead of the backlog being
     * silently written off.
     */
    const target = recipient === "admin" ? await notifyTarget(admin, "chat") : null;
    if (recipient === "admin" && !target) return 0;

    let sent = 0;
    for (const [userId, all] of batch) {
      const person = personOf.get(userId) ?? null;

      /*
       * CLAIMED BEFORE SENDING. The minute tick and the five-minute tracking
       * tick both run this, and they meet every five minutes - so marking
       * after the send let both mail the same conversation. The update below
       * hands each row to exactly one caller; a failed send gives them back.
       */
      const ids = await claim(admin, all.map((m) => m.id));
      if (ids.length === 0) continue;
      const messages = all.filter((m) => ids.includes(m.id));

      if (recipient === "customer") {
        /*
         * Nobody to send to: no address, a suspended account, or an account
         * that has gone. Marked anyway, deliberately - otherwise these rows
         * come back every minute for a week, each time costing a read and
         * crowding out conversations that CAN be mailed.
         */
        const email = person?.email?.trim();
        if (!person || !email || (person.status && person.status !== "active")) {
          continue; // already claimed, so never retried
        }

        const mail = customerMail(site.brand, messages);
        const result = await sendEmail({
          to: email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          replyTo: site.supportEmail || null,
        });
        if (!result.ok) {
          // Given back: next minute tries again.
          console.error(`[chat-email] customer mail not sent (${userId}):`, result.error);
          await release(admin, ids);
          continue;
        }
        sent += 1;
      } else {
        const mail = adminMail(target!.brand, userId, person, messages);
        const result = await sendEmail({
          to: target!.to,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          // An admin hitting Reply lands in the customer's own inbox - the
          // reply that is quickest to write. The app is still the record.
          replyTo: person?.email?.trim() || null,
        });
        if (!result.ok) {
          console.error(`[chat-email] admin mail not sent (${userId}):`, result.error);
          await release(admin, ids);
          continue;
        }
        sent += 1;
      }
    }

    return sent;
  } catch (error) {
    console.error(`[chat-email] ${recipient} sweep crashed:`, error);
    return 0;
  }
}

/**
 * Takes the rows that nobody has claimed yet and returns their ids. The
 * `emailed_at is null` guard makes it a once-only hand-off between ticks.
 */
async function claim(admin: Admin, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data, error } = await admin
    .from("chat_messages")
    .update({ emailed_at: new Date().toISOString() })
    .in("id", ids)
    .is("emailed_at", null)
    .select("id");
  if (error) {
    console.error("[chat-email] could not claim rows:", error.message);
    return [];
  }
  return (data ?? []).map((row) => row.id as string);
}

/** Gives claimed rows back after a send that failed, so they are retried. */
async function release(admin: Admin, ids: string[]): Promise<void> {
  const { error } = await admin.from("chat_messages").update({ emailed_at: null }).in("id", ids);
  if (error) console.error("[chat-email] could not release rows:", error.message);
}

/* -------------------------------------------------------------------------- */
/* templates                                                                   */
/* -------------------------------------------------------------------------- */

const FONT = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";

function trimBody(body: string): string {
  const clean = body.trim();
  return clean.length > BODY_CHARS ? `${clean.slice(0, BODY_CHARS).trimEnd()}…` : clean;
}

/** The newest few, oldest of those first - the order a chat is read in. */
function latest(messages: Row[]): { shown: Row[]; hidden: number } {
  const shown = messages.slice(-SHOWN);
  return { shown, hidden: messages.length - shown.length };
}

/**
 * One message, as a bubble: who and when on a small line, the words below.
 *
 * The body keeps its line breaks (white-space:pre-wrap) because support answers
 * are often a few short lines - a vehicle number, then a step, then another -
 * and run together they read as one garbled sentence. Escaped first, so
 * pre-wrap only ever sees text.
 */
function bubble(sender: string, at: string, body: string): string {
  return `<tr><td style="padding:0 0 12px">
  <div style="font:12px/1.4 ${FONT};color:#5b6b7b;margin:0 0 4px"><strong style="color:#1f2933;font-weight:600">${esc(sender)}</strong> &middot; ${esc(at)}</div>
  <div style="background:#f1f4f8;border-radius:10px;padding:12px 14px;font:15px/1.55 ${FONT};color:#1f2933;white-space:pre-wrap;word-wrap:break-word;overflow-wrap:anywhere">${esc(trimBody(body))}</div>
</td></tr>`;
}

/**
 * A slightly richer cousin of shell() in email.ts: same head, same palette, same
 * card, but with the messages laid out as a conversation and a footer that says
 * why this arrived. Tables for the message list, because Outlook still renders
 * divs inside a card unpredictably and a chat with its lines out of order is
 * worse than no chat.
 */
function chatShell({
  brand,
  title,
  intro,
  bubbles,
  more,
  details,
  button,
  footer,
}: {
  brand: string;
  title: string;
  intro: string;
  bubbles: string;
  more: number;
  details?: string;
  button: { label: string; url: string };
  footer: string;
}): string {
  const moreLine =
    more > 0
      ? `<p style="margin:0 0 4px;font:13px/1.5 ${FONT};color:#5b6b7b">${more} earlier unread message${more === 1 ? "" : "s"} not shown.</p>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${esc(brand)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#f4f6f9">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e3e8ef;border-radius:12px;padding:28px 24px">
    <p style="margin:0 0 20px;font:600 15px ${FONT};color:#1d4ed8">${esc(brand)}</p>
    <h1 style="margin:0 0 10px;font:600 20px/1.3 ${FONT};color:#1f2933">${esc(title)}</h1>
    <p style="margin:0 0 20px;font:15px/1.6 ${FONT};color:#1f2933">${intro}</p>
    ${details ?? ""}
    ${moreLine}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${bubbles}</table>
    <p style="margin:12px 0 20px"><a href="${esc(button.url)}" style="display:inline-block;padding:12px 22px;border-radius:8px;background:#1d4ed8;color:#fff;font:600 15px ${FONT};text-decoration:none">${esc(button.label)}</a></p>
    <p style="margin:0 0 20px;font:13px/1.6 ${FONT};color:#5b6b7b">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all;color:#1d4ed8">${esc(button.url)}</span></p>
    <p style="margin:0;padding-top:16px;border-top:1px solid #e3e8ef;font:12px/1.6 ${FONT};color:#7b8794">${footer}</p>
  </div>
</body></html>`;
}

function textMessages(sender: (row: Row) => string, shown: Row[], hidden: number): string {
  const lines = shown.map((m) => `${sender(m)} · ${fmtDayTime(m.created_at)} IST\n${trimBody(m.body)}`);
  return (hidden > 0 ? `(${hidden} earlier unread not shown)\n\n` : "") + lines.join("\n\n");
}

/** To the customer: support wrote and they have not seen it. */
function customerMail(brand: string, messages: Row[]) {
  const { shown, hidden } = latest(messages);
  const url = `${env.siteUrl}${CUSTOMER_CHAT_PATH}`;
  const sender = `${brand} support`;
  const count = messages.length;
  const plural = count === 1 ? "a message" : `${count} messages`;

  const subject = `New message from ${brand} support`;
  const intro = `You have ${esc(plural)} from our support team that you have not read yet.`;

  return {
    subject,
    html: chatShell({
      brand,
      title: count === 1 ? "You have a new message" : "You have new messages",
      intro,
      bubbles: shown.map((m) => bubble(sender, `${fmtDayTime(m.created_at)} IST`, m.body)).join(""),
      more: hidden,
      button: { label: "Reply in the app", url },
      footer: `You are getting this because you have an unread message from ${esc(brand)} support. Replies are best sent from the app, so the whole conversation stays in one place.`,
    }),
    text:
      `${subject}\n\n` +
      `You have ${plural} from our support team that you have not read yet.\n\n` +
      `${textMessages(() => sender, shown, hidden)}\n\n` +
      `Reply in the app: ${url}\n\n` +
      `You are getting this because you have an unread message from ${brand} support.`,
  };
}

/** To the notify list: a customer wrote and nobody on the desk has opened it. */
function adminMail(brand: string, userId: string, person: Person | null, messages: Row[]) {
  const { shown, hidden } = latest(messages);
  const url = `${env.siteUrl}${adminChatPath(userId)}`;
  const named = person?.full_name?.trim() ?? "";
  const email = person?.email?.trim() ?? "";
  const who = named || email || "a customer";
  const count = messages.length;

  const subject = `Unanswered message from ${who}`;

  const factRows: [string, string][] = [
    ["Customer", esc(named || "not given")],
    ["Email", email ? esc(email) : "not given"],
    ["Mobile", telLink(person?.phone) || "not given"],
  ];
  const details = `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 20px">${factRows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;font:14px/1.5 ${FONT};color:#5b6b7b;white-space:nowrap">${esc(label)}</td><td style="padding:2px 0;font:600 14px/1.5 ${FONT};color:#1f2933">${value}</td></tr>`,
    )
    .join("")}</table>`;

  return {
    subject,
    html: chatShell({
      brand,
      title: count === 1 ? "A customer is waiting for a reply" : `${count} messages waiting for a reply`,
      intro: `${esc(who)} wrote to support and nobody has opened it yet.`,
      details,
      bubbles: shown.map((m) => bubble(who, `${fmtDayTime(m.created_at)} IST`, m.body)).join(""),
      more: hidden,
      button: { label: "Reply in the admin inbox", url },
      footer: `Sent to the ${esc(brand)} notification list because a customer message has gone unread. Each message is mailed about once; switch these off under Notify admin in settings.`,
    }),
    text:
      `${subject}\n\n` +
      `${who} wrote to ${brand} support and nobody has opened it yet.\n\n` +
      `Customer: ${named || "not given"}\n` +
      `Email: ${email || "not given"}\n` +
      `Mobile: ${person?.phone ?? "not given"}\n\n` +
      `${textMessages(() => who, shown, hidden)}\n\n` +
      `Reply in the admin inbox: ${url}`,
  };
}
