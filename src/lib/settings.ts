import { env } from "@/lib/env";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AppSettings } from "@/lib/types";

type Admin = ReturnType<typeof getSupabaseAdmin>;

export const SETTINGS_FALLBACK: AppSettings = {
  ldbApiUrl: "https://ldb.co.in/api/ldbv2/truck/search",
  trackingEnabled: true,
  globalPollingFloor: 5,
  noActivityHours: 6,
  excessiveTolls: 5,
  excessiveWindowHours: 2,
  nightFrom: "22:00",
  nightTo: "06:00",
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

  const night = map.get("night_window") as { from?: string; to?: string } | undefined;

  return {
    ldbApiUrl: text("ldb_api_url", env.ldbApiUrl || SETTINGS_FALLBACK.ldbApiUrl),
    trackingEnabled: map.get("tracking_enabled") !== false,
    globalPollingFloor: number("global_polling_floor", SETTINGS_FALLBACK.globalPollingFloor),
    noActivityHours: number("no_activity_hours", SETTINGS_FALLBACK.noActivityHours),
    excessiveTolls: number("excessive_tolls", SETTINGS_FALLBACK.excessiveTolls),
    excessiveWindowHours: number(
      "excessive_window_hours",
      SETTINGS_FALLBACK.excessiveWindowHours,
    ),
    nightFrom: night?.from ?? SETTINGS_FALLBACK.nightFrom,
    nightTo: night?.to ?? SETTINGS_FALLBACK.nightTo,
  };
}
