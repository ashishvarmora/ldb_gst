/**
 * One description of every limit, shared by the plan editor, the per-officer
 * override editor and the usage tables. Add a limit here and it shows up in
 * all three.
 *
 * Encoding reminder:  -1 = unlimited,  >= 0 = hard cap,  null in an override
 * row = inherit from the plan.
 */

export const UNLIMITED = -1;

export type NumericLimitKey =
  | "truck_limit"
  | "manual_search_limit_per_day"
  | "tracking_queries_per_month"
  | "max_alert_rules"
  | "max_truck_groups"
  | "min_polling_interval_minutes"
  | "data_retention_days";

export type BooleanLimitKey =
  | "telegram_enabled"
  | "google_sheet_enabled"
  | "alert_rules_enabled";

type NumericLimitField = {
  key: NumericLimitKey;
  label: string;
  hint: string;
  unit: string;
  /** min_polling_interval_minutes has no "unlimited" state. */
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
    hint: "How many trucks may sit under background polling at once.",
    unit: "trucks",
    allowUnlimited: true,
    min: 0,
  },
  {
    key: "manual_search_limit_per_day",
    label: "Manual searches / day",
    hint: "Searches the officer runs by hand from the dashboard. Resets at IST midnight.",
    unit: "per day",
    allowUnlimited: true,
    min: 0,
  },
  {
    key: "tracking_queries_per_month",
    label: "Tracking queries / month",
    hint: "Background LDB calls. One tracked truck at 10 min burns ~4,300 a month.",
    unit: "per month",
    allowUnlimited: true,
    min: 0,
  },
  {
    key: "max_alert_rules",
    label: "Alert rules",
    hint: "Number of alert rules the officer may create.",
    unit: "rules",
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
    key: "min_polling_interval_minutes",
    label: "Fastest polling interval",
    hint: "Floor on how often a truck may be polled. Lower = more API load.",
    unit: "minutes",
    allowUnlimited: false,
    min: 1,
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
    key: "alert_rules_enabled",
    label: "Alert rules",
    hint: "Officer may configure alert rules at all.",
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
 * Estimated monthly tracking queries for a set of trucks at a given interval.
 * Used to warn the admin when a plan cannot physically support its truck limit.
 */
export function estimateMonthlyQueries(trucks: number, intervalMinutes: number): number {
  if (trucks <= 0 || intervalMinutes <= 0) return 0;
  const callsPerTruckPerDay = (24 * 60) / intervalMinutes;
  return Math.round(callsPerTruckPerDay * 30 * trucks);
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
