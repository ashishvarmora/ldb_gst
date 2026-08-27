import type { ActionResult } from "@/lib/types";

/** Trimmed string, or null when the field is absent or blank. */
export function str(fd: FormData, name: string): string | null {
  const raw = fd.get(name);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Checkbox helper. Our Checkbox component posts a hidden "false" alongside the
 * real input, so a present-but-unchecked box is distinguishable from a missing
 * field.
 */
export function bool(fd: FormData, name: string): boolean {
  return fd.getAll(name).includes("true");
}

/** TriState select: "inherit" -> null. */
export function tri(fd: FormData, name: string): boolean | null {
  const raw = fd.get(name);
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/** Whole number within bounds, or null when blank/invalid. */
export function int(
  fd: FormData,
  name: string,
  opts: { min?: number; max?: number } = {},
): number | null {
  const raw = str(fd, name);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isInteger(value)) return null;
  if (opts.min !== undefined && value < opts.min) return null;
  if (opts.max !== undefined && value > opts.max) return null;
  return value;
}

/** Comma-separated list -> trimmed array. */
export function list(fd: FormData, name: string): string[] {
  const raw = str(fd, name);
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function fail(error: string): ActionResult {
  return { ok: false, error };
}

export function done(message?: string): ActionResult {
  return { ok: true, message };
}

/** "gj 02 at-8546" -> "GJ02AT8546" */
export function normalizeTruck(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Indian commercial plates are 2 letters + 1-2 digits + 1-3 letters + 4 digits,
 * with older and BH-series formats varying. Kept deliberately loose: rejecting a
 * legitimate plate is worse than passing an odd one through to the portal.
 */
export function looksLikeTruckNumber(value: string): boolean {
  return /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{3,4}$/.test(value);
}
