/**
 * Turns whatever went wrong into something the reader can act on.
 *
 * The failures here are mostly not the reader's fault and mostly not
 * interesting to them: a Postgres constraint name, an HTTP 502 from the toll
 * portal or a fetch timeout all mean "it did not work, and here is what to do
 * next". Showing the raw text asks the reader to translate machine language,
 * and occasionally leaks a column or table name.
 *
 * The original is still written to the server log by the caller, so nothing is
 * lost for debugging - it is just not shown to someone who cannot act on it.
 */

import { ALERT_BOT_USERNAME } from "@/lib/telegram-bot";

/** What is shown when nothing more specific fits. */
const FALLBACK = "Something went wrong at our end. Please try again in a moment.";

type Rule = { match: RegExp; message: string };

const RULES: Rule[] = [
  // The upstream toll portal, which is out of our control and often slow.
  {
    match: /abort|timed? ?out|etimedout|econnreset|network|fetch failed|socket hang up/i,
    message:
      "The toll portal did not respond in time. It is usually busy rather than down - try again in a minute.",
  },
  {
    match: /50[0234]|bad gateway|service unavailable|gateway timeout/i,
    message: "The toll portal is not responding right now. Please try again shortly.",
  },
  { match: /429|rate ?limit|too many requests/i,
    message: "Too many lookups at once. Wait a minute and try again." },
  {
    match: /\b40[13]\b|forbidden|unauthorized|not authorised|not authorized/i,
    message: "You do not have access to that.",
  },
  /*
   * TELEGRAM'S TWO REFUSALS, ABOVE THE 404 RULE ON PURPOSE.
   *
   * "chat not found" is what Telegram answers when the officer has never
   * pressed Start on our bot, and it is the single most common way alerts
   * silently do not arrive. It also contains the words "not found", so the
   * generic rule below used to claim it and the officer's own Settings page -
   * which renders telegram_configs.last_error through friendlyError() - showed
   * "That is no longer here. It may have been removed." for the one failure on
   * this platform with a thirty-second fix. Naming the bot is the fix, so the
   * message names it.
   *
   * Matched here rather than left to sendTelegramMessage()'s own wording,
   * because an officer running their own bot token gets Telegram's raw
   * description instead, and both paths land in this function.
   */
  /* Blocked first: it is the one where pressing Start is not enough on its
     own, so it must not be answered by the sentence below. */
  {
    match: /bot was blocked/i,
    message: `Our alerts bot is blocked on your Telegram. Open t.me/${ALERT_BOT_USERNAME}, unblock it, press Start, then send another test.`,
  },
  {
    match: /chat not found|bot can'?t initiate conversation/i,
    message: `Telegram has no conversation with our bot yet, so it refused the message. Open t.me/${ALERT_BOT_USERNAME}, press Start, then send another test.`,
  },
  { match: /\b404\b|not found/i, message: "That is no longer here. It may have been removed." },

  // Database shapes that should never reach a person.
  {
    match: /duplicate key|unique constraint|already exists/i,
    message: "That already exists, so nothing was added.",
  },
  // Order matters from here down. A row-level-security denial reads as
  // "new row violates row-level security policy", so the generic constraint
  // rule below would otherwise claim it and tell someone to check a form they
  // cannot fix.
  { match: /row-level security|permission denied/i,
    message: "You do not have access to that record." },
  {
    match: /foreign key|violates|constraint|null value in column/i,
    message: "Some of the details were not accepted. Check the form and try again.",
  },
  {
    match: /jwt|token|session|refresh_token|invalid login/i,
    message: "Your session has expired. Please sign in again.",
  },
];

/**
 * `error` is deliberately unknown: it may be an Error, a Supabase error object,
 * a string, or something thrown by a library that is none of those.
 */
export function friendlyError(error: unknown, fallback = FALLBACK): string {
  const raw = extract(error);
  if (!raw) return fallback;

  for (const rule of RULES) {
    if (rule.match.test(raw)) return rule.message;
  }

  // A short sentence that is already plain English is better than the
  // fallback: most of ours are written for a person in the first place.
  //
  // The status-code test is not redundant with the rules above. Those match
  // the codes worth explaining; this catches every other one - "refused the
  // order (HTTP 400)" is a sentence a person can read and still learns them
  // nothing.
  const technical = /[{}<>]|\bat \w+\.|::|\bERROR\b|\bHTTP\b|\b[45]\d{2}\b/;
  if (raw.length <= 140 && !technical.test(raw)) return raw;

  return fallback;
}

function extract(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const shape = error as { message?: unknown; error?: unknown; details?: unknown };
    for (const value of [shape.message, shape.error, shape.details]) {
      if (typeof value === "string" && value) return value;
    }
  }
  return "";
}

/**
 * Logs the real failure and returns the version to show. Keeps the two halves
 * together so a caller cannot swallow the detail by accident.
 */
export function reportError(context: string, error: unknown, fallback?: string): string {
  console.error(`${context}:`, error);
  return friendlyError(error, fallback);
}
