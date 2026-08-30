export type UserRole = "super_admin" | "officer";
export type AccountStatus = "active" | "suspended";
export type QuerySource = "manual" | "tracking";
export type TruckStatus = "moving" | "idle" | "no_activity" | "unknown";

export type Plan = {
  id: string;
  name: string;
  description: string | null;
  truck_limit: number;
  manual_search_limit_per_day: number;
  tracking_queries_per_month: number;
  min_alert_interval_minutes: number;
  max_truck_groups: number;
  min_polling_interval_minutes: number;
  data_retention_days: number;
  telegram_enabled: boolean;
  google_sheet_enabled: boolean;
  alerts_enabled: boolean;
  price_per_month: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  designation: string | null;
  office: string | null;
  district: string | null;
  state: string | null;
  role: UserRole;
  status: AccountStatus;
  plan_id: string | null;
  plan_assigned_at: string | null;
  plan_expires_on: string | null;
  notes: string | null;
  last_active_at: string | null;
  created_at: string;
};

/** One row of public.officer_overview - profile + plan + effective limits + usage. */
export type OfficerOverview = Profile & {
  plan_name: string | null;
  plan_description: string | null;
  price_per_month: number | null;
  truck_limit: number;
  manual_search_limit_per_day: number;
  tracking_queries_per_month: number;
  min_alert_interval_minutes: number;
  max_truck_groups: number;
  min_polling_interval_minutes: number;
  data_retention_days: number;
  telegram_enabled: boolean;
  google_sheet_enabled: boolean;
  alerts_enabled: boolean;
  has_overrides: boolean;
  active_trucks: number;
  total_trucks: number;
  manual_searches_today: number;
  tracking_queries_today: number;
  manual_searches_month: number;
  tracking_queries_month: number;
  alerts_today: number;
  total_events: number;
  telegram_connected: boolean;
  sheet_connected: boolean;
  sheet_last_synced_at: string | null;
  last_event_at: string | null;
};

export type LimitOverrides = {
  user_id: string;
  truck_limit: number | null;
  manual_search_limit_per_day: number | null;
  tracking_queries_per_month: number | null;
  min_alert_interval_minutes: number | null;
  max_truck_groups: number | null;
  min_polling_interval_minutes: number | null;
  data_retention_days: number | null;
  telegram_enabled: boolean | null;
  google_sheet_enabled: boolean | null;
  alerts_enabled: boolean | null;
  reason: string | null;
  updated_at: string;
};

export type TrackedTruck = {
  id: string;
  user_id: string;
  truck_number: string;
  label: string | null;
  polling_interval_minutes: number;
  is_active: boolean;
  is_watchlist: boolean;
  last_polled_at: string | null;
  last_event_at: string | null;
  last_location: string | null;
  last_direction: string | null;
  status: TruckStatus;
  consecutive_errors: number;
  /** Alert 1 - report the current plaza every N minutes, changed or not. */
  location_alert_enabled: boolean;
  location_alert_minutes: number;
  location_alert_last_at: string | null;
  /** Alert 2 - every N minutes, speak up only if the plaza changed. */
  movement_alert_enabled: boolean;
  movement_alert_minutes: number;
  movement_alert_last_at: string | null;
  /** Plaza the last movement alert reported; the change test compares to it. */
  movement_alert_last_location: string | null;
  created_at: string;
};

export type SearchLog = {
  id: number;
  user_id: string;
  truck_number: string;
  source: QuerySource;
  ok: boolean;
  http_status: number | null;
  response_ms: number | null;
  events_found: number;
  new_events: number;
  error: string | null;
  created_at: string;
};

export type AlertLog = {
  id: number;
  user_id: string;
  truck_number: string | null;
  kind: string | null;
  title: string;
  message: string | null;
  delivered: boolean;
  delivery_error: string | null;
  created_at: string;
};

export type AuditLog = {
  id: number;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity: string | null;
  entity_id: string | null;
  entity_label: string | null;
  meta: Record<string, unknown>;
  created_at: string;
};

export type UsageCounter = {
  user_id: string;
  usage_date: string;
  manual_searches: number;
  tracking_queries: number;
  alerts_sent: number;
};

/** Server Action result shape used by every form in the admin panel. */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

export type TruckEvent = {
  id: number;
  user_id: string;
  tracked_truck_id: string | null;
  truck_number: string;
  seq_no: string;
  event_time: string | null;
  event_time_raw: string | null;
  loc_name: string | null;
  lat: number | null;
  lng: number | null;
  direction: string | null;
  event_name: string | null;
  fetched_at: string;
};

/**
 * The platform has exactly two alerts and they are built in. Nobody creates
 * them - an officer switches them on per truck and picks the interval, within
 * the floor the admin set on their plan.
 */
export type AlertKind = "location_update" | "location_change";

export type TruckGroup = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: string;
};

export type TruckGroupMember = {
  group_id: string;
  truck_number: string;
  added_at: string;
};

export type TelegramConfig = {
  user_id: string;
  chat_id: string | null;
  bot_token: string | null;
  is_enabled: boolean;
  verified_at: string | null;
  last_error: string | null;
  updated_at: string;
};

export type GoogleSheetConfig = {
  user_id: string;
  spreadsheet_id: string | null;
  sheet_url: string | null;
  is_enabled: boolean;
  last_synced_at: string | null;
  last_error: string | null;
  updated_at: string;
};

/** One row of public.officer_effective_limits. */
export type EffectiveLimits = {
  user_id: string;
  truck_limit: number;
  manual_search_limit_per_day: number;
  tracking_queries_per_month: number;
  min_alert_interval_minutes: number;
  max_truck_groups: number;
  min_polling_interval_minutes: number;
  data_retention_days: number;
  telegram_enabled: boolean;
  google_sheet_enabled: boolean;
  alerts_enabled: boolean;
  has_overrides: boolean;
};

/** Result of the consume_quota() RPC. */
export type QuotaVerdict = {
  allowed: boolean;
  reason?: "no_such_user" | "account_suspended" | "plan_expired" | "quota_exhausted";
  limit?: number;
  used?: number;
  remaining?: number;
};

/** Resolved global knobs from public.app_settings. */
export type AppSettings = {
  ldbApiUrl: string;
  trackingEnabled: boolean;
  globalPollingFloor: number;
  noActivityHours: number;
};
