import { env } from "@/lib/env";
import { indianMobileDigits } from "@/lib/phone";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * WhatsApp alerts through Meta's WhatsApp Cloud API.
 *
 * Sender: "Rahdari", +91 92134 34855 (WHATSAPP_PHONE_ID). Inside the 24-hour
 * window after the person last messaged us, an alert goes as free text (free
 * of charge); outside it, business-initiated messages need a pre-approved
 * template, so it goes as WA_TEMPLATE_TRIP_UPDATE with three body parameters:
 * {{1}} the truck, {{2}} what happened, {{3}} when - a paid utility message.
 *
 * Because of that cost, WhatsApp carries only high-value news: see
 * alertGoesToWhatsApp() in alerts.ts for trucks, and the admin daily summary
 * (daily-summary.ts) - the only WhatsApp an admin gets.
 *
 * Same contract as telegram.ts and push.ts: never throws, and `skipped` tells
 * "the platform has no WhatsApp" apart from "this send failed".
 *
 * Every send is logged to whatsapp_messages under Meta's message id (wamid) so
 * the webhook can record delivered / read / failed. The token, and the full
 * number, never reach a log line.
 */

export type WhatsAppResult =
  | { ok: true; wamid: string | null }
  | { ok: false; error: string; code?: number; skipped?: boolean };

const TIMEOUT_MS = 10_000;
const RETRIES = 3;

/** Meta error codes worth naming (https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes). */
const RETRYABLE = new Set([130429, 131056, 131000, 2]);

export function whatsappConfigured(): boolean {
  return Boolean(env.whatsappToken && env.whatsappPhoneId);
}

/** `9876543210`, `+91 98765-43210`, `919876543210` → `919876543210`; anything else → null. */
export function toWhatsAppNumber(raw: string | null | undefined): string | null {
  const digits = indianMobileDigits(raw);
  return digits === null ? null : `91${digits}`;
}

/** `91XXXXXX4855` - for logs. */
export function maskNumber(n: string): string {
  return n.length > 4 ? `${n.slice(0, 2)}${"X".repeat(Math.max(0, n.length - 6))}${n.slice(-4)}` : "XXXX";
}

/**
 * A template parameter may not contain a newline, a tab or more than four
 * spaces in a row - Meta rejects the whole message (132018) - and an empty one
 * is refused too.
 */
function cleanParam(text: string): string {
  const t = String(text ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {4,}/g, "   ").trim();
  return t || "-";
}

/** What a customer reads for a failure, by Meta's error code. */
function explain(code: number | undefined, fallback: string): string {
  switch (code) {
    case 190:
      return "WhatsApp is temporarily unavailable.";
    case 131026:
      return "This number could not receive the message. Check that it uses WhatsApp.";
    case 131047:
      return "This message needs an approved template.";
    case 132000:
    case 132018:
      return "The WhatsApp message format was not accepted.";
    case 132001:
      return "WhatsApp alerts are waiting for approval from Meta. They will start automatically once approved.";
    case 130429:
    case 131056:
      return "WhatsApp is busy right now. Please try again in a minute.";
    case 131030:
      return "This number is not yet allowed to receive messages from Rahdari.";
    default:
      return fallback;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(body: unknown): Promise<{ ok: true; wamid: string | null } | { ok: false; code?: number; error: string; status: number | null }> {
  const url = `${env.whatsappApiUrl.replace(/\/+$/, "")}/${env.whatsappPhoneId}/messages`;
  let last: { ok: false; code?: number; error: string; status: number | null } = { ok: false, error: "Not sent", status: null };

  for (let attempt = 0; attempt < RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${env.whatsappToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal,
      });
      const json = (await response.json().catch(() => null)) as
        | { messages?: { id?: string }[]; error?: { message?: string; code?: number; error_data?: { details?: string } } }
        | null;
      if (response.ok) return { ok: true, wamid: json?.messages?.[0]?.id ?? null };

      const code = json?.error?.code;
      last = {
        ok: false,
        code,
        status: response.status,
        error: json?.error?.error_data?.details ?? json?.error?.message ?? `HTTP ${response.status}`,
      };
      // 4xx is final unless Meta says it is a rate limit; 5xx is worth retrying.
      const retry = response.status >= 500 || (code !== undefined && RETRYABLE.has(code));
      if (!retry) return last;
    } catch (error) {
      const aborted = error instanceof Error && error.name === "AbortError";
      last = { ok: false, status: null, error: aborted ? "WhatsApp did not respond in time." : (error as Error).message };
    } finally {
      clearTimeout(timer);
    }
    await sleep(500 * 2 ** attempt);
  }
  return last;
}

async function logSend(row: {
  wamid: string | null;
  userId: string | null;
  to: string;
  template: string;
  purpose: "alert" | "test" | "otp";
  errorCode?: number;
  errorMessage?: string;
}) {
  try {
    const { error } = await getSupabaseAdmin().from("whatsapp_messages").insert({
      wamid: row.wamid,
      user_id: row.userId,
      to_last4: row.to.slice(-4),
      template: row.template,
      purpose: row.purpose,
      status: row.errorMessage ? "failed" : "accepted",
      error_code: row.errorCode ?? null,
      error_message: row.errorMessage ?? null,
    });
    if (error) console.error("[whatsapp] log insert failed:", error.message);
  } catch (error) {
    console.error("[whatsapp] log insert failed:", (error as Error).message);
  }
}

/**
 * A message deliberately NOT sent - today only "not enough credits for
 * WhatsApp" (src/lib/whatsapp-charge.ts). Logged like a failed send so support
 * sees why a customer got no WhatsApp for an alert.
 */
export async function logWhatsAppSkipped({ userId, to, reason }: { userId: string; to: string; reason: string }) {
  const number = toWhatsAppNumber(to) ?? String(to ?? "");
  await logSend({ wamid: null, userId, to: number, template: "(not sent)", purpose: "alert", errorMessage: reason });
}

/**
 * Sends an approved template. `bodyParams` fill {{1}}, {{2}}… in order.
 */
export async function sendWhatsAppTemplate({
  to,
  template,
  bodyParams,
  purpose,
  userId = null,
  lang = env.whatsappTemplateLang,
}: {
  to: string;
  template: string;
  bodyParams: string[];
  purpose: "alert" | "test" | "otp";
  userId?: string | null;
  lang?: string;
}): Promise<WhatsAppResult> {
  if (!whatsappConfigured()) {
    return { ok: false, skipped: true, error: "WhatsApp alerts are not switched on yet." };
  }
  const number = toWhatsAppNumber(to);
  if (!number) return { ok: false, error: "No valid WhatsApp number saved for this account." };

  const result = await post({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: number,
    type: "template",
    template: {
      name: template,
      language: { code: lang },
      components: [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text: cleanParam(text) })) }],
    },
  });

  if (result.ok) {
    await logSend({ wamid: result.wamid, userId, to: number, template, purpose });
    return { ok: true, wamid: result.wamid };
  }

  console.warn(`[whatsapp] ${template} to ${maskNumber(number)} failed (${result.code ?? result.status}): ${result.error}`);
  await logSend({ wamid: null, userId, to: number, template, purpose, errorCode: result.code, errorMessage: result.error });
  return { ok: false, code: result.code, error: explain(result.code, "The WhatsApp message could not be sent.") };
}

/**
 * Plain text. Only allowed inside the 24-hour window after the customer last
 * messaged us; outside it Meta answers 131047 and the caller falls back to a
 * template.
 */
export async function sendWhatsAppText({
  to,
  text,
  purpose,
  userId = null,
}: {
  to: string;
  text: string;
  purpose: "alert" | "test";
  userId?: string | null;
}): Promise<WhatsAppResult> {
  if (!whatsappConfigured()) {
    return { ok: false, skipped: true, error: "WhatsApp alerts are not switched on yet." };
  }
  const number = toWhatsAppNumber(to);
  if (!number) return { ok: false, error: "No valid WhatsApp number saved for this account." };

  const result = await post({
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: number,
    type: "text",
    text: { preview_url: false, body: text.slice(0, 4000) },
  });
  if (result.ok) {
    await logSend({ wamid: result.wamid, userId, to: number, template: "(text)", purpose });
    return { ok: true, wamid: result.wamid };
  }
  console.warn(`[whatsapp] text to ${maskNumber(number)} failed (${result.code ?? result.status}): ${result.error}`);
  await logSend({ wamid: null, userId, to: number, template: "(text)", purpose, errorCode: result.code, errorMessage: result.error });
  return { ok: false, code: result.code, error: explain(result.code, "The WhatsApp message could not be sent.") };
}

/** Whether this number wrote to us within the last 24 hours (minus a safety margin). */
async function inReplyWindow(number: string): Promise<boolean> {
  try {
    const { data } = await getSupabaseAdmin()
      .from("whatsapp_inbound")
      .select("last_inbound_at")
      .eq("wa_id", number)
      .maybeSingle<{ last_inbound_at: string }>();
    if (!data) return false;
    return Date.now() - new Date(data.last_inbound_at).getTime() < 23.5 * 3600 * 1000;
  } catch {
    return false;
  }
}

/** Template not approved, paused or missing: worth trying the next one. */
const TEMPLATE_UNUSABLE = new Set([132001, 132015, 132016, 132007]);

/**
 * The one way alerts go out on WhatsApp:
 *   1. inside the 24-hour window -> plain `text` (richer, no template needed);
 *   2. otherwise -> the trip-update template, then each fallback template in
 *      turn (WA_TEMPLATE_FALLBACKS) until one is approved.
 */
export async function sendWhatsAppAlert({
  to,
  text,
  params,
  purpose,
  userId = null,
}: {
  to: string;
  text: string;
  params: string[];
  purpose: "alert" | "test";
  userId?: string | null;
}): Promise<WhatsAppResult> {
  if (!whatsappConfigured()) {
    return { ok: false, skipped: true, error: "WhatsApp alerts are not switched on yet." };
  }
  const number = toWhatsAppNumber(to);
  if (!number) return { ok: false, error: "No valid WhatsApp number saved for this account." };

  if (await inReplyWindow(number)) {
    const sent = await sendWhatsAppText({ to: number, text, purpose, userId });
    if (sent.ok || sent.code !== 131047) return sent;
  }

  const templates = [env.whatsappTripTemplate, ...env.whatsappTemplateFallbacks].filter(
    (t, i, all) => t && all.indexOf(t) === i,
  );
  let last: WhatsAppResult = { ok: false, error: "No WhatsApp template is configured." };
  for (const template of templates) {
    last = await sendWhatsAppTemplate({ to: number, template, bodyParams: params, purpose, userId });
    if (last.ok || last.skipped || !(last.code !== undefined && TEMPLATE_UNUSABLE.has(last.code))) return last;
  }
  return last;
}

/*
 * MESSAGE TEXTS
 *
 * Two shapes for every message:
 *   - free text, used inside the 24-hour window (free of charge): WhatsApp
 *     formatting (*bold*, _italic_), one emoji on the headline, and a link that
 *     opens the right page of the app;
 *   - three template parameters for rahdari_trip_update, used outside it.
 *     The approved body reads
 *       "Hello, your Rahdari trip {{1}} status has been updated to {{2}} on
 *        {{3}}. Open the Rahdari app for full trip details."
 *     so {{1}} is the truck, {{2}} a short phrase that reads after "updated
 *     to", {{3}} the IST time.
 */

const NL = "\n";
const SIGN = "_Rahdari_";

/** IST, e.g. "19 Nov 2026, 4:30 pm". */
export function whatsappTime(iso?: string | null): string {
  const date = iso ? new Date(iso) : new Date();
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** An absolute link into the site, e.g. https://rahdari.in/portal/trucks/<id>. */
export function siteLink(path: string): string {
  return `${env.siteUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function placeWithDirection(location: string | null | undefined, direction: string | null | undefined): string {
  const place = location?.trim() || "an unnamed plaza";
  return direction?.trim() ? `${place} (${direction.trim()})` : place;
}

/** What a truck alert needs to become a WhatsApp message. Mirrors AlertDraft. */
export type WhatsAppAlertInput = {
  kind: string;
  phase?: "halted" | "still_halted" | "moving_again";
  title: string;
  truckNumber: string;
  location?: string | null;
  direction?: string | null;
  eventTime?: string | null;
  previousLocation?: string | null;
  idleText?: string;
  watchedPlaza?: string | null;
  guessed?: boolean;
  /** Absolute link to open, normally the truck's page. */
  url: string;
};

/**
 * A truck alert as free text.
 *
 *   📍 *GJ02AT8546 reached Nadiad Toll Plaza*
 *
 *   *Plaza:* Nadiad Toll Plaza (Northbound)
 *   *Time:* 19 Nov 2026, 4:30 pm IST
 *
 *   Open truck: https://rahdari.in/portal/trucks/…
 *   _Rahdari_
 */
export function whatsappAlertText(a: WhatsAppAlertInput): string {
  const where = placeWithDirection(a.location, a.direction);
  const when = `${whatsappTime(a.eventTime)} IST`;
  let emoji = "🚚";
  let body: string[];

  if (a.kind === "plaza_crossing") {
    emoji = "📍";
    body = [`*Plaza:* ${where}`, `*Time:* ${when}`];
    if (a.guessed && a.watchedPlaza) {
      body.push("", `_You asked for "${a.watchedPlaza}". This is the closest plaza on record._`);
    }
  } else if (a.kind === "location_change") {
    body = [`*Plaza:* ${where}`];
    if (a.previousLocation) body.push(`*Previous:* ${a.previousLocation}`);
    body.push(`*Time:* ${when}`);
  } else if (a.kind === "halt" && a.phase === "moving_again") {
    emoji = "✅";
    body = [`*Crossed:* ${where}`, `*Time:* ${when}`];
  } else if (a.kind === "halt") {
    emoji = "⏸️";
    body = [
      `No toll crossing for *${a.idleText ?? "a while"}*.`,
      `*Last seen:* ${where}`,
      `*At:* ${when}`,
      "",
      "_We will message you here when it moves again._",
    ];
  } else {
    body = [`*Plaza:* ${where}`, `*Time:* ${when}`];
  }

  return [`${emoji} *${a.title}*`, "", ...body, "", `Open truck: ${a.url}`, SIGN].join(NL);
}

/** The same alert as the trip-update template's three parameters. */
export function whatsappAlertParams(a: WhatsAppAlertInput): string[] {
  const where = placeWithDirection(a.location, a.direction);
  let status: string;
  let when = a.eventTime ?? null;
  if (a.kind === "plaza_crossing") status = `reached ${where}`;
  else if (a.kind === "halt" && a.phase === "moving_again") status = `moving again, crossed ${where}`;
  else if (a.kind === "halt") {
    status = `halted, no toll crossing for ${a.idleText ?? "a while"} (last seen at ${where})`;
    when = null; // "now": the halt is the news, not the old crossing
  } else status = `crossed ${where}`;
  return [a.truckNumber, status.slice(0, 200), whatsappTime(when)];
}

/**
 * An account or truck notice ("Tracking paused: no credits left") as free text:
 *
 *   ⚠️ *Tracking paused: no credits left*
 *   🚚 GJ02AT8546            (when it is about one truck)
 *
 *   All tracked trucks are paused. …
 *
 *   Top up: https://rahdari.in/portal/plan
 *   _Rahdari_
 */
export function whatsappNoticeText({
  title,
  truckNumber,
  message,
  link,
}: {
  title: string;
  truckNumber: string | null;
  message: string;
  link: { label: string; url: string };
}): string {
  return [
    `⚠️ *${title}*`,
    ...(truckNumber ? [`🚚 ${truckNumber}`] : []),
    "",
    message,
    "",
    `${link.label}: ${link.url}`,
    SIGN,
  ].join(NL);
}

/** A notice in the trip-update template: "your Rahdari trip tracking status has been updated to …". */
export function noticeParams(truckNumber: string | null, title: string): string[] {
  return [truckNumber ?? "tracking", title.slice(0, 200), whatsappTime()];
}

/** The "Send test" message from the Notifications page. */
export function whatsappTestText(): string {
  return [
    "✅ *Rahdari WhatsApp alerts are on*",
    "",
    "This is a test. On WhatsApp you will get:",
    "• a truck reaching a plaza you named",
    "• a truck moving to a new plaza",
    "• a truck halting, and moving again",
    "",
    "_Every-check updates and hourly halt reminders come in the app and on Telegram._",
    "",
    `Manage alerts: ${siteLink("/portal/notifications")}`,
    SIGN,
  ].join(NL);
}
