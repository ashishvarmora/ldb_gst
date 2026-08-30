/**
 * One description of every limit, shared by the plan editor, the per-officer
 * override editor and the usage tables. Add a limit here and it shows up in
 * all three.
 *
 * A limit says what an account may REACH - trucks, case folders, how long
 * history is kept. What it may USE is paid for out of one credit balance, at
 * rates in credit_rates, so there are no per-day or per-month allowances here.
 *
 * Encoding reminder:  -1 = unlimited,  >= 0 = hard cap,  null in an override
 * row = inherit from the plan.
 */

export const UNLIMITED = -1;

export type NumericLimitKey =
  | "truck_limit"
  | "max_truck_groups"
  | "data_retention_days";

export type BooleanLimitKey =
  | "telegram_enabled"
  | "google_sheet_enabled"
  | "alerts_enabled";

type NumericLimitField = {
  key: NumericLimitKey;
  label: string;
  hint: string;
  unit: string;
  /** Not every limit has a sensible "unlimited" state. */
  allowUnlimited: boolean;
  min: number;
};

type BooleanLimitField = {
  key: BooleanLimitKey;
  label: string;
  hint: string;
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
  {
    key: "max_truck_groups",
    label: "Case folders",
    hint: "Saved truck groups for grouping an investigation.",
    unit: "folders",
    allowUnlimited: true,
    min: 0,
  },
  {
    key: "data_retention_days",
    label: "Keep history for",
    hint: "Days of crossings, calls and alerts kept in the database. The Google Sheet keeps everything, so this only trims the app's own copy.",
    unit: "days",
    allowUnlimited: true,
    min: 1,
  },
];

export const BOOLEAN_LIMITS: BooleanLimitField[] = [
  {
    key: "telegram_enabled",
    label: "Telegram alerts",
    hint: "Officer may receive alerts on Telegram.",
  },
  {
    key: "google_sheet_enabled",
    label: "Google Sheet sync",
    hint: "Officer may connect a sheet and mirror events into it.",
  },
  {
    key: "alerts_enabled",
    label: "Truck alerts",
    hint: "Officer may add alerts to their trucks. Off means nothing is checked and nothing is sent.",
  },
];

export const ALL_LIMIT_KEYS: (NumericLimitKey | BooleanLimitKey)[] = [
  ...NUMERIC_LIMITS.map((f) => f.key),
  ...BOOLEAN_LIMITS.map((f) => f.key),
];

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
