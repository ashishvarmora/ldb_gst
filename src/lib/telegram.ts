import { env } from "@/lib/env";

export type TelegramResult = { ok: true } | { ok: false; error: string };

const TIMEOUT_MS = 10_000;

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Sends one message. `botToken` is the officer's own bot when they insisted on
 * having one, otherwise the platform-wide bot from the environment.
 */
export async function sendTelegramMessage({
  chatId,
  text,
  botToken,
}: {
  chatId: string;
  text: string;
  botToken?: string | null;
}): Promise<TelegramResult> {
  const token = botToken?.trim() || env.telegramBotToken;
  if (!token) {
    return { ok: false, error: "No Telegram bot token configured on the platform." };
  }
  if (!chatId?.trim()) {
    return { ok: false, error: "No Telegram chat id saved for this officer." };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId.trim(),
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as
        | { description?: string }
        | null;
      const description = body?.description ?? `HTTP ${response.status}`;
      return {
        ok: false,
        error: /chat not found/i.test(description)
          ? "Chat not found — the officer must send /start to the bot first."
          : /bot was blocked/i.test(description)
            ? "The officer blocked the bot."
            : description,
      };
    }

    return { ok: true };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      ok: false,
      error: aborted ? "Telegram did not respond in time." : (error as Error).message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Formats a toll crossing the way it reads best on a phone. */
export function formatAlertMessage({
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

  const lines = [
    `<b>${escapeHtml(title)}</b>`,
    "",
    `🚚 <code>${escapeHtml(truckNumber)}</code>`,
  ];

  if (location) lines.push(`📍 ${escapeHtml(location)}`);
  if (direction) lines.push(`🧭 ${escapeHtml(direction)}`);
  if (when) lines.push(`🕒 ${escapeHtml(when)} IST`);
  if (extra) lines.push("", escapeHtml(extra));

  return lines.join("\n");
}
