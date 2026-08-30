/**
 * The one limit a plan still carries, shared by the plan editor and the
 * per-officer override editor.
 *
 * Everything else a plan used to cap is now either paid for out of the credit
 * balance or set once for the platform, so there is a single entry here. The
 * array shape stays because both editors iterate it, and because the next
 * limit worth having should slot in without touching either screen.
 *
 * Encoding reminder:  -1 = unlimited,  >= 0 = hard cap,  null in an override
 * row = inherit from the plan.
 */

export const UNLIMITED = -1;

export type NumericLimitKey = "truck_limit";

type NumericLimitField = {
  key: NumericLimitKey;
  label: string;
  hint: string;
  unit: string;
  /** Not every limit has a sensible "unlimited" state. */
  allowUnlimited: boolean;
  min: number;
};

export const NUMERIC_LIMITS: NumericLimitField[] = [
  {
    key: "truck_limit",
    label: "Tracked trucks",
    hint: "How many trucks may be under automatic checking at once.",
    unit: "trucks",
    allowUnlimited: true,
    min: 0,
  },
];

export const ALL_LIMIT_KEYS: NumericLimitKey[] = NUMERIC_LIMITS.map((f) => f.key);

/** Render a stored limit for humans. */
export function formatLimit(value: number | null | undefined): string {
  if (value === null || value === undefined) return "--";
  if (value === UNLIMITED) return "Unlimited";
  return value.toLocaleString("en-IN");
}

/** "17 / 50" or "17 / Unlimited". */
export function formatUsage(used: number, limit: number): string {
  return `${used.toLocaleString("en-IN")} / ${formatLimit(limit)}`;
}

/** 0..1 fill for a quota bar. Unlimited never fills. */
export function usageRatio(used: number, limit: number): number {
  if (limit === UNLIMITED) return 0;
  if (limit <= 0) return used > 0 ? 1 : 0;
  return Math.min(used / limit, 1);
}

export type UsageTone = "ok" | "warn" | "danger";

export function usageTone(used: number, limit: number): UsageTone {
  if (limit === UNLIMITED) return "ok";
  const ratio = usageRatio(used, limit);
  if (ratio >= 1) return "danger";
  if (ratio >= 0.8) return "warn";
  return "ok";
}


/**
 * Parse a limit field coming from a form. "" or "unlimited" -> UNLIMITED when
 * allowed, otherwise null so the caller can treat it as "inherit"/"missing".
 */
export function parseLimitInput(
  raw: FormDataEntryValue | null,
  opts: { allowUnlimited: boolean; allowBlank: boolean; min: number },
): number | null | undefined {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "" ) {
    return opts.allowBlank ? null : undefined;
  }
  if (value === "unlimited" || value === "-1" || value === "u") {
    return opts.allowUnlimited ? UNLIMITED : undefined;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < opts.min) return undefined;
  return n;
}
