const IST = "Asia/Kolkata";

/** "26 Aug 2026, 3:42 PM" in IST - the only timezone a GST officer cares about. */
export function fmtDateTime(value: string | Date | null | undefined): string {
  if (!value) return "--";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** "26 Aug 2026" */
export function fmtDate(value: string | Date | null | undefined): string {
  if (!value) return "--";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleDateString("en-IN", {
    timeZone: IST,
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/**
 * "12 Aug, 3:42 pm" - fmtDateTime with the year left off.
 *
 * For a dense list read against itself rather than against the calendar: the
 * credit ledger's rows all fall inside a sixty-day window, so the year is four
 * characters every row pays for and none of them needs, while the minute is
 * what tells one of a truck's ninety-six daily checks from the next. The full
 * instant, year and all, is one tap away in the row's own fold.
 *
 * Here rather than in the component that wants it, so the timezone is named in
 * one file. A local Intl call with "Asia/Kolkata" typed into it is how a screen
 * ends up an hour or a day out from the one beside it.
 */
export function fmtDayTime(value: string | Date | null | undefined): string {
  if (!value) return "--";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-IN", {
    timeZone: IST,
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** "3:42 PM" */
export function fmtTime(value: string | Date | null | undefined): string {
  if (!value) return "--";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleTimeString("en-IN", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** "4m ago", "3h ago", "6d ago", "never" */
export function fmtRelative(value: string | Date | null | undefined): string {
  if (!value) return "never";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "never";

  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 0) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function fmtNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return "--";
  return value.toLocaleString("en-IN");
}

export function fmtRupees(value: number | null | undefined): string {
  if (value === null || value === undefined) return "--";
  return `Rs ${value.toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
}

/** Today's date in IST as YYYY-MM-DD, the day boundary every daily figure is counted against. */
export function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: IST });
}

/** First day of the current IST month as YYYY-MM-DD. */
export function istMonthStart(): string {
  return `${istToday().slice(0, 7)}-01`;
}

/** YYYY-MM-DD, n days before today (IST). */
export function istDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toLocaleDateString("en-CA", { timeZone: IST });
}

/** Uppercase, strip spaces and dashes: "gj 02 at-8546" -> "GJ02AT8546". */
export function normalizeTruckNumber(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Two-letter avatar seed from a name or email. */
export function initials(name: string | null | undefined, email: string): string {
  const source = (name ?? "").trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
