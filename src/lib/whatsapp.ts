import { env } from "@/lib/env";

/**
 * WhatsApp as a second alert channel. Built, wired to nothing, and switched off
 * until credentials exist.
 *
 * There is no WhatsApp Business account yet, so nothing here has ever spoken to
 * a live endpoint. It is written now so the shape is settled - the same
 * arguments and the same result type as telegram.ts, so a caller can send on
 * both without knowing which is which - and so the only work left on the day the
 * account is approved is filling in three environment variables and correcting
 * one function if the payload is wrong.
 *
 * Outbound only, like Telegram: no webhook, nothing received, no replies read.
 */

export type WhatsAppResult =
  | { ok: true }
  /**
   * `skipped` separates "there is no WhatsApp account" from "the send failed".
   * A caller must be able to stay quiet about the first and complain about the
   * second, or every alert on a platform with no WhatsApp credentials reports
   * an error it cannot act on.
   */
  | { ok: false; error: string; skipped?: boolean };

const TIMEOUT_MS = 10_000;

/**
 * Whether a send can even be attempted. Both the token and the phone number id
 * are needed - the API url has a working default, so its absence is not a
 * reason to call this unconfigured.
 */
export function whatsappConfigured(): boolean {
  return Boolean(env.whatsappToken && env.whatsappPhoneId);
}

/**
 * The one function to correct against real documentation.
 *
 * This is the WhatsApp Cloud API shape - POST to /<phone-number-id>/messages
 * with a bearer token - and it is UNVERIFIED: it has never been run against a
 * live account, and it is copied from the published Cloud API format rather
 * than observed. Everything vendor-specific is deliberately in this one small
 * function, so a wrong url, header or body is a single edit and not a hunt.
 *
 * Also unverified, and more likely to bite than the payload: business-initiated
 * messages outside a 24-hour customer service window need a pre-approved
 * template, which is exactly what an unprompted toll alert is. Plain text may
 * well be refused until a template is approved, in which case the `type` and
 * `text` fields below become `template`.
 */
function buildRequest({ to, text }: { to: string; text: string }): {
  url: string;
  init: RequestInit;
} {
  const base = env.whatsappApiUrl.replace(/\/+$/, "");
  return {
    url: `${base}/${env.whatsappPhoneId}/messages`,
    init: {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.whatsappToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { preview_url: false, body: text },
      }),
      cache: "no-store" as RequestCache,
    },
  };
}

/**
 * Sends one message. `to` is a phone number in international format without a
 * plus or spaces, which is what the Cloud API expects.
 *
 * Never throws. An alert usually goes out on more than one channel, and a
 * channel nobody has bought yet must not be able to take Telegram down with it -
 * so a missing configuration is a logged no-op that returns `skipped`, and a
 * genuine failure comes back as a value rather than an exception.
 */
export async function sendWhatsAppMessage({
  to,
  text,
}: {
  to: string;
  text: string;
}): Promise<WhatsAppResult> {
  if (!whatsappConfigured()) {
    // Logged rather than silent: on the day the credentials land, this line is
    // how you tell whether anything was actually trying to use the channel.
    console.info("[whatsapp] not configured — message not sent");
    return {
      ok: false,
      skipped: true,
      error: "WhatsApp alerts are not switched on yet.",
    };
  }
  if (!to?.trim()) {
    return { ok: false, error: "No WhatsApp number saved for this officer." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const { url, init } = buildRequest({ to: to.trim().replace(/[^\d]/g, ""), text });
    const response = await fetch(url, { ...init, signal: controller.signal });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { error?: { message?: string } }
        | null;
      return {
        ok: false,
        error: body?.error?.message ?? `HTTP ${response.status}`,
      };
    }

    return { ok: true };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "WhatsApp did not respond in time." : (error as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The same crossing as formatAlertMessage in telegram.ts, in the only markup
 * WhatsApp understands: *bold*, and no HTML at all. Nothing is escaped because
 * nothing can be - a plaza name containing an asterisk loses its asterisk, and
 * that is the whole of the damage.
 */
export function formatWhatsAppAlert({
  title,
  truckNumber,
  location,
  direction,
  eventTime,
  extra,
}: {
  title: string;
  truckNumber: string;
  location?: string | null;
  direction?: string | null;
  eventTime?: string | null;
  extra?: string | null;
}): string {
  const when = eventTime
    ? new Date(eventTime).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : null;

  const lines = [`*${title}*`, "", `🚚 ${truckNumber}`];

  if (location) lines.push(`📍 ${location}`);
  if (direction) lines.push(`🧭 ${direction}`);
  if (when) lines.push(`🕒 ${when} IST`);
  if (extra) lines.push("", extra);

  return lines.join("\n");
}
