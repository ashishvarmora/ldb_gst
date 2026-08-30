import { env } from "@/lib/env";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AppSettings } from "@/lib/types";

type Admin = ReturnType<typeof getSupabaseAdmin>;

export const SETTINGS_FALLBACK: AppSettings = {
  ldbApiUrl: "https://ldb.co.in/api/ldbv2/truck/search",
  trackingEnabled: true,
  noActivityHours: 6,
  dataRetentionDays: 30,
  backupIntervalDays: 7,
  backupSheetId: "",
  razorpayEnabled: false,
  razorpayKeyId: "",
};

/**
 * Reads app_settings into a typed object, filling anything missing from the
 * fallback above so a half-seeded table can never crash the worker.
 */
export async function loadSettings(admin: Admin): Promise<AppSettings> {
  const { data } = await admin.from("app_settings").select("key, value");
  const map = new Map((data ?? []).map((row) => [row.key, row.value as unknown]));

  const number = (key: string, fallback: number): number => {
    const value = map.get(key);
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  };
  const text = (key: string, fallback: string): string => {
    const value = map.get(key);
    return typeof value === "string" && value.trim() !== "" ? value : fallback;
  };

  return {
    ldbApiUrl: text("ldb_api_url", env.ldbApiUrl || SETTINGS_FALLBACK.ldbApiUrl),
    trackingEnabled: map.get("tracking_enabled") !== false,
    noActivityHours: number("no_activity_hours", SETTINGS_FALLBACK.noActivityHours),
    dataRetentionDays: number("data_retention_days", SETTINGS_FALLBACK.dataRetentionDays),
    backupIntervalDays: number("backup_interval_days", SETTINGS_FALLBACK.backupIntervalDays),
    backupSheetId: text("backup_sheet_id", ""),
    razorpayEnabled: map.get("razorpay_enabled") === true,
    razorpayKeyId: text("razorpay_key_id", ""),
  };
}
