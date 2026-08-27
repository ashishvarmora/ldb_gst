/**
 * Checking intervals. Stored everywhere as a plain number of minutes; the unit
 * (minutes / hours) only exists so people can type "2 hours" instead of "120".
 *
 * Kept out of the Server Action files: a "use server" module may only export
 * async functions.
 */

export type IntervalUnit = "minutes" | "hours";

/** Quick picks. Anything else goes through the custom box. */
export const INTERVAL_PRESETS_MINUTES = [5, 10, 20, 30, 45] as const;
export const INTERVAL_PRESETS_HOURS = [1, 2, 3, 4, 6, 12, 24] as const;

/** Every preset as minutes, ascending. */
export const INTERVAL_CHOICES: number[] = [
  ...INTERVAL_PRESETS_MINUTES,
  ...INTERVAL_PRESETS_HOURS.map((h) => h * 60),
];

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

/** Split minutes back into the friendliest {value, unit} pair for a form. */
export function splitInterval(minutes: number): { value: number; unit: IntervalUnit } {
  if (minutes >= 60 && minutes % 60 === 0) {
    return { value: minutes / 60, unit: "hours" };
  }
  return { value: minutes, unit: "minutes" };
}

/** Turn a form's {value, unit} back into minutes. Returns null when unusable. */
export function toMinutes(value: number, unit: IntervalUnit): number | null {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) return null;
  const minutes = unit === "hours" ? value * 60 : value;
  if (minutes < MIN_INTERVAL_MINUTES || minutes > MAX_INTERVAL_MINUTES) return null;
  return minutes;
}

/** Roughly how many background calls a month at this interval, per truck. */
export function monthlyCallsAt(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round((24 * 60 * 30) / minutes);
}

/**
 * The presets an officer may pick, given the floor their administrator set.
 * Always includes the floor itself, so there is at least one valid choice even
 * when the floor sits between two presets (e.g. 25 min).
 */
export function allowedPresets(floorMinutes: number): number[] {
  const floor = Math.max(floorMinutes, MIN_INTERVAL_MINUTES);
  const presets = INTERVAL_CHOICES.filter((m) => m >= floor);
  if (!presets.includes(floor)) presets.unshift(floor);
  return [...new Set(presets)].sort((a, b) => a - b);
}
