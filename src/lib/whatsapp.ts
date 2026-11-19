import { env } from "@/lib/env";
import { indianMobileDigits } from "@/lib/phone";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * WhatsApp alerts through Meta's WhatsApp Cloud API.
 *
 * Sender: "Rahdari", +91 92134 34855 (WHATSAPP_PHONE_ID). Every alert is
 * business-initiated, which WhatsApp only allows through a pre-approved
 * template, so alerts go out as WA_TEMPLATE_TRIP_UPDATE with three body
 * parameters: {{1}} the truck, {{2}} what happened, {{3}} when. Free text is
 * only accepted inside the 24-hour window after the customer messages us, so
 * nothing here sends free text.
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

/**
 * A toll crossing (or a system notice) as the trip-update template's three
 * parameters: {{1}} truck, {{2}} what happened, {{3}} when.
 */
export function tripUpdateParams({
  title,
  truckNumber,
  location,
  direction,
  eventTime,
}: {
  title: string;
  truckNumber: string;
  location?: string | null;
  direction?: string | null;
  eventTime?: string | null;
}): string[] {
  const where = [location, direction ? `(${direction})` : null].filter(Boolean).join(" ");
  const status = where ? `${title}: ${where}` : title;
  return [truckNumber, status.slice(0, 200), whatsappTime(eventTime)];
}
