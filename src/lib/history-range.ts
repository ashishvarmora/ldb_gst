/**
 * The one date control on the account history pages (Payments, Credits,
 * Activity): All / Last 7 days / Custom (owner, 23 Nov 2026). Lives in the URL
 * as ?range=all|7d|custom (&from&to for custom); every date is an IST calendar
 * day (YYYY-MM-DD). 30d / 90d are still understood when a page lists them, but
 * no page offers them any more - an old link falls back to the page default.
 *
 * Pure and client-safe: the server parses it, the client control renders it.
 */

export type RangeKey = "7d" | "30d" | "90d" | "all" | "custom";

export type HistoryRange = {
  key: RangeKey;
  /** Inclusive IST day, or null for "all time". */
  from: string | null;
  /** Inclusive IST day, or null for "all time". */
  to: string | null;
};

export const RANGE_LABEL: Record<RangeKey, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
  custom: "Custom",
};

const PRESET_DAYS: Partial<Record<RangeKey, number>> = { "7d": 7, "30d": 30, "90d": 90 };

const IST = "Asia/Kolkata";

/** Today in IST as YYYY-MM-DD. */
export function istDay(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: IST });
}

export function isIsoDay(raw: unknown): raw is string {
  if (typeof raw !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  return !Number.isNaN(Date.parse(`${raw}T00:00:00+05:30`));
}

/** Adds whole days to an IST day string. */
export function addDays(day: string, days: number): string {
  const t = Date.parse(`${day}T12:00:00+05:30`) + days * 86_400_000;
  return new Date(t).toLocaleDateString("en-CA", { timeZone: IST });
}

/** Days from `from` to `to`, both inclusive. */
export function daySpan(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00+05:30`) - Date.parse(`${from}T12:00:00+05:30`)) / 86_400_000) + 1;
}

/** The instant an IST day starts, as an ISO timestamp. */
export function istDayStartIso(day: string): string {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

/** The instant after an IST day ends (start of the next day), as ISO. */
export function istDayEndIso(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00+05:30`) + 86_400_000).toISOString();
}

/** The IST day an instant falls on. */
export function istDayOf(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: IST });
}

export function parseHistoryRange(
  params: { range?: string; from?: string; to?: string },
  options: { fallback: RangeKey; allowAll: boolean; maxDays?: number; keys?: readonly RangeKey[] },
): HistoryRange {
  const raw = params.range as RangeKey | undefined;
  let key: RangeKey =
    raw && raw in RANGE_LABEL && (raw !== "all" || options.allowAll) && (!options.keys || options.keys.includes(raw))
      ? raw
      : options.fallback;

  if (key === "custom") {
    let from = isIsoDay(params.from) ? params.from : null;
    let to = isIsoDay(params.to) ? params.to : null;
    if (!from && !to) key = options.fallback;
    else {
      const today = istDay();
      to = to ?? today;
      from = from ?? to;
      if (from > to) [from, to] = [to, from];
      if (to > today) to = today;
      if (from > to) from = to;
      if (options.maxDays && daySpan(from, to) > options.maxDays) from = addDays(to, -(options.maxDays - 1));
      return { key, from, to };
    }
  }

  if (key === "all") return { key, from: null, to: null };
  const days = PRESET_DAYS[key] ?? 30;
  return { key, from: istDay(-(days - 1)), to: istDay() };
}

/** The three choices every history page offers. */
export const HISTORY_RANGE_KEYS = ["all", "7d", "custom"] as const satisfies readonly RangeKey[];

/** The URL parameters that reproduce a range (empty for the page default). */
export function rangeQuery(range: HistoryRange, fallback: RangeKey): Record<string, string> {
  if (range.key === "custom" && range.from && range.to) return { range: "custom", from: range.from, to: range.to };
  return range.key === fallback ? {} : { range: range.key };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Thu, 19 Nov" (year added when it is not this year). */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  const year = day.slice(0, 4) === istDay().slice(0, 4) ? "" : ` ${y}`;
  if (day === istDay()) return `Today, ${d} ${MONTHS[m - 1]}`;
  if (day === istDay(-1)) return `Yesterday, ${d} ${MONTHS[m - 1]}`;
  return `${weekday}, ${d} ${MONTHS[m - 1]}${year}`;
}

/** "12 Nov" (year added when it is not this year). */
export function shortDay(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}${day.slice(0, 4) === istDay().slice(0, 4) ? "" : ` ${y}`}`;
}

/** "12 Nov – 19 Nov" for a custom range, else the preset's name. */
export function rangeLabel(range: HistoryRange): string {
  if (range.key !== "custom" || !range.from || !range.to) return RANGE_LABEL[range.key];
  return range.from === range.to ? shortDay(range.from) : `${shortDay(range.from)} – ${shortDay(range.to)}`;
}
