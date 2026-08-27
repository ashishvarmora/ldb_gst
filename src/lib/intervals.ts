/**
 * Polling intervals offered in the UI, in minutes. The officer's own floor
 * (plan or override) plus the global floor filter this list down.
 *
 * Kept out of the Server Action files: a "use server" module may only export
 * async functions.
 */
export const INTERVAL_CHOICES = [5, 10, 15, 30, 60, 120, 240, 480] as const;

export function intervalLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/** Roughly how many background calls a month at this interval, per truck. */
export function monthlyCallsAt(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.round((24 * 60 * 30) / minutes);
}
