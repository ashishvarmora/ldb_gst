/**
 * Alert intervals. Stored everywhere as a plain number of minutes.
 *
 * There used to be a row of preset buttons - 10, 20, 30 - and a custom box
 * behind them. Officers pick a number; the presets only added a decision about
 * which of two ways to enter it.
 */

export const MIN_INTERVAL_MINUTES = 1;
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60; // a week

/** 90 -> "1 h 30 min", 120 -> "2 hours", 30 -> "30 minutes". */
export function intervalLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "--";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${hours} hour${hours === 1 ? "" : "s"}`;
  return `${hours} h ${rest} min`;
}

/** Compact form for chips and table cells: "30m", "2h", "1h 30m". */
export function intervalShort(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "--";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}
