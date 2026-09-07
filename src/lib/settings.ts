import { cache } from "react";
import { env } from "@/lib/env";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AppSettings } from "@/lib/types";

type Admin = ReturnType<typeof getSupabaseAdmin>;

export const SETTINGS_FALLBACK: AppSettings = {
  ldbApiUrl: "https://ldb.co.in/api/ldbv2/truck/search",
  trackingEnabled: true,
  noActivityHours: 6,
  trackingFailureCutoff: 10,
  inactivePauseHours: 72,
  signupFreeCredits: 0,
  revisitMinutes: 90,
  dataRetentionDays: 30,
  backupIntervalDays: 7,
  sheetExportIntervalDays: 1,
  backupSheetId: "",
  razorpayEnabled: false,
  razorpayKeyId: "",
  creditsPerRupee: 1,
  referralEnabled: true,
  referralPercent: 10,
  referralInviteePercent: 10,
  referralMinPayment: 0,
  referralMilestoneCount: 5,
  referralMilestoneBonus: 500,
  brandName: "Rahdari",
  signupEnabled: true,
  supportEmail: "",
  supportPhone: "",
  supportAddress: "",
  privacyUrl: "",
  termsUrl: "",
};

/**
 * Reads app_settings into a typed object, filling anything missing from the
 * fallback above so a half-seeded table can never crash the worker.
 */
/*
 * The one read, memoised for the length of a request.
 *
 * loadSettings takes the admin client as an argument, and cache() keys on its
 * arguments - so wrapping loadSettings itself would key on a client object that
 * is usually constructed fresh at each call site, and never hit. The query is
 * what is worth caching, so the cache goes here and loadSettings stays the same
 * shape for its twenty-odd callers.
 *
 * Three pages call loadSettings three times in one render (the plan page, the
 * referrals page, admin settings). app_settings is thirty small rows that
 * cannot change mid-render, and each of those calls was a separate round trip
 * to Tokyo.
 */
const readSettingRows = cache(async (admin: Admin) => {
  const { data } = await admin.from("app_settings").select("key, value");
  return (data ?? []) as { key: string; value: unknown }[];
});

export async function loadSettings(admin: Admin): Promise<AppSettings> {
  const map = new Map((await readSettingRows(admin)).map((row) => [row.key, row.value]));

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
    trackingFailureCutoff: number("tracking_failure_cutoff", SETTINGS_FALLBACK.trackingFailureCutoff),
    inactivePauseHours: number("inactive_pause_hours", SETTINGS_FALLBACK.inactivePauseHours),
    signupFreeCredits: number("signup_free_credits", SETTINGS_FALLBACK.signupFreeCredits),
    revisitMinutes: number("revisit_minutes", SETTINGS_FALLBACK.revisitMinutes),
    dataRetentionDays: number("data_retention_days", SETTINGS_FALLBACK.dataRetentionDays),
    backupIntervalDays: number("backup_interval_days", SETTINGS_FALLBACK.backupIntervalDays),
    sheetExportIntervalDays: number("sheet_export_interval_days", SETTINGS_FALLBACK.sheetExportIntervalDays),
    backupSheetId: text("backup_sheet_id", ""),
    razorpayEnabled: map.get("razorpay_enabled") === true,
    razorpayKeyId: text("razorpay_key_id", ""),
    creditsPerRupee: number("credits_per_rupee", SETTINGS_FALLBACK.creditsPerRupee),
    referralEnabled: map.get("referral_enabled") !== false,
    referralPercent: number("referral_percent", SETTINGS_FALLBACK.referralPercent),
    referralInviteePercent: number(
      "referral_invitee_percent",
      SETTINGS_FALLBACK.referralInviteePercent,
    ),
    referralMinPayment: number("referral_min_payment", SETTINGS_FALLBACK.referralMinPayment),
    referralMilestoneCount: number("referral_milestone_count", SETTINGS_FALLBACK.referralMilestoneCount),
    referralMilestoneBonus: number("referral_milestone_bonus", SETTINGS_FALLBACK.referralMilestoneBonus),
    brandName: text("brand_name", SETTINGS_FALLBACK.brandName),
    // Absent means open. Only an explicit false closes sign-up, so a
    // half-seeded settings table cannot lock everyone out of registering.
    signupEnabled: map.get("signup_enabled") !== false,
    supportEmail: text("support_email", ""),
    supportPhone: text("support_phone", ""),
    supportAddress: text("support_address", ""),
    privacyUrl: text("privacy_url", ""),
    termsUrl: text("terms_url", ""),
  };
}
