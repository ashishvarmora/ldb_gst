/**
 * How often an alert runs. Stored everywhere as a plain number of minutes; the
 * unit exists only so nobody has to type 720 when they mean twelve hours.
 *
 * The wording matters more than it looks. "Every 10 minutes" was read as "the
 * truck moves every 10 minutes" often enough to be a support question, so the
 * UI says what actually happens - we look, and you hear from us only when
 * there is something to say - and shows the daily count, because that is how
 * closely the truck is being followed. It is no longer what anything costs:
 * automatic checks are part of the plan, so a faster beat is free.
 */

export type IntervalUnit = "minutes" | "hours";

export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60; // a week

/** 90 -> "1 hour 30 minutes", 120 -> "2 hours", 30 -> "30 minutes". */
export function intervalLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "--";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const hourPart = `${hours} hour${hours === 1 ? "" : "s"}`;
  return rest === 0 ? hourPart : `${hourPart} ${rest} minute${rest === 1 ? "" : "s"}`;
}

/** Compact form for chips and table cells: "30m", "2h", "1h 30m". */
export function intervalShort(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "--";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** Split minutes into the friendliest {value, unit} pair for a form. */
export function splitInterval(minutes: number): { value: number; unit: IntervalUnit } {
  if (minutes >= 60 && minutes % 60 === 0) return { value: minutes / 60, unit: "hours" };
  return { value: minutes, unit: "minutes" };
}

/** Turn a form's {value, unit} back into minutes. Null when unusable. */
export function toMinutes(value: number, unit: IntervalUnit): number | null {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null;
  const minutes = unit === "hours" ? value * 60 : value;
  if (minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) return null;
  return minutes;
}

/** How many times a day this interval runs - how closely the truck is followed. */
export function checksPerDay(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.round((24 * 60) / minutes);
}

/**
 * The sentence shown under an interval field: what it does, and what it costs
 * in checks. "We look every 30 minutes - 48 times a day."
 */
export function describeCadence(minutes: number): string {
  const perDay = checksPerDay(minutes);
  return `We look every ${intervalLabel(minutes)} — ${perDay.toLocaleString("en-IN")} time${perDay === 1 ? "" : "s"} a day.`;
}
