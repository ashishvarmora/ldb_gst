import type { RetentionRule } from "@/lib/types";

/**
 * How a retention window is written, read and explained.
 *
 * Plain module with no directives on purpose: the card that edits a rule is a
 * Client Component and the action that saves it runs on the server, and the two
 * must agree exactly on what "forever" means. Anything they do not share is a
 * place where the form accepts a value the action then rejects.
 */

/** What the database stores for "keep everything". */
export const KEEP_FOREVER = -1;

/** Ten years. Past this a window is indistinguishable from keeping everything. */
export const MAX_KEEP_DAYS = 3650;

/**
 * The box takes words as well as numbers, because -1 is a magic number nobody
 * guesses. Everything here is checked lower-cased and trimmed.
 */
const FOREVER_WORDS = ["forever", "for ever", "for-ever", "never", "always", "∞", "-1"];

export const KEEP_DAYS_ERROR =
  `Type a whole number of days from 1 to ${MAX_KEEP_DAYS}, or the word "forever" to keep everything.`;

export type ParsedKeepDays = { ok: true; days: number } | { ok: false; error: string };

export function parseKeepDays(raw: string | null | undefined): ParsedKeepDays {
  const text = (raw ?? "").trim().toLowerCase();
  if (text === "") return { ok: false, error: KEEP_DAYS_ERROR };
  if (FOREVER_WORDS.includes(text)) return { ok: true, days: KEEP_FOREVER };

  const days = Number(text);
  // 0 is deliberately refused rather than treated as "delete everything": the
  // database constraint refuses it too, and it is one keystroke from 30.
  if (!Number.isInteger(days) || days < 1 || days > MAX_KEEP_DAYS) {
    return { ok: false, error: KEEP_DAYS_ERROR };
  }
  return { ok: true, days };
}

/** For prose: "kept for ever" or "30 days". */
export function keepDaysLabel(days: number): string {
  return days === KEEP_FOREVER ? "kept for ever" : `${days} day${days === 1 ? "" : "s"}`;
}

/** What goes in the text box, so a reload shows the word rather than -1. */
export function keepDaysInput(days: number): string {
  return days === KEEP_FOREVER ? "forever" : String(days);
}

/**
 * What is actually lost by giving a protected table a finite window.
 *
 * Written per table rather than as one sentence, because "are you sure" tells
 * an admin nothing and these three consequences are genuinely different: one
 * loses the explanation for a balance, one loses a financial record, and one
 * hands out a coupon claim a second time.
 */
const PROTECTED_CONSEQUENCE: Record<string, string> = {
  credit_transactions:
    "Every balance on the platform is reconstructed from this ledger — it is what spend_credits writes, and every historical total is derived from it. Trimming it does not free useful space; it leaves balances with nothing behind them and makes “where did that credit go” unanswerable.",
  payments:
    "This is the financial record of what was charged and what it bought. Deleting rows removes the evidence behind a refund, a dispute or a tax question, and the receipt the account can see.",
  coupon_redemptions:
    "A redemption row is what holds someone's claim on a code. Deleting one frees that claim, so a single-use or limited coupon can be redeemed again by somebody else.",
};

export function protectedConsequence(rule: RetentionRule): string {
  return (
    PROTECTED_CONSEQUENCE[rule.entity] ??
    "This table is a money record rather than a log. Deleting from it destroys the explanation for someone's balance instead of freeing useful space."
  );
}

/** Bytes as a size a person reads. table_sizes() gives a pretty string per
 *  table but no total, and the totals are the number that matters on a free
 *  tier. */
export function prettyBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";
  const units = ["bytes", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
