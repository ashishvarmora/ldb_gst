export type UserRole = "super_admin" | "officer";
export type AccountStatus = "active" | "suspended";
export type QuerySource = "manual" | "tracking";
export type TruckStatus = "moving" | "idle" | "no_activity" | "unknown";

/**
 * A plan says what an account may reach - trucks, case folders, integrations.
 * It no longer says how much it may use: that is paid for out of one credit
 * balance, at rates the admin sets in credit_rates.
 */
export type Plan = {
  id: string;
  name: string;
  description: string | null;
  truck_limit: number;
  max_truck_groups: number;
  data_retention_days: number;
  telegram_enabled: boolean;
  google_sheet_enabled: boolean;
  alerts_enabled: boolean;
  included_credits: number;
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
  credits: number;
  last_active_at: string | null;
  created_at: string;
};

/** One row of public.officer_overview - profile + plan + limits + usage. */
export type OfficerOverview = Profile & {
  plan_name: string | null;
  plan_description: string | null;
  price_per_month: number | null;
  included_credits: number | null;
  truck_limit: number;
  max_truck_groups: number;
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
  credits_spent_today: number;
  credits_spent_month: number;
  alerts_today: number;
  alerts_unread: number;
  active_alerts: number;
  total_events: number;
  telegram_connected: boolean;
  sheet_connected: boolean;
  sheet_last_synced_at: string | null;
  last_event_at: string | null;
};

export type LimitOverrides = {
  user_id: string;
  truck_limit: number | null;
  max_truck_groups: number | null;
  data_retention_days: number | null;
  telegram_enabled: boolean | null;
  google_sheet_enabled: boolean | null;
  alerts_enabled: boolean | null;
  reason: string | null;
  updated_at: string;
};

/** One row of public.officer_effective_limits. */
export type EffectiveLimits = {
  user_id: string;
  truck_limit: number;
  max_truck_groups: number;
  data_retention_days: number;
  telegram_enabled: boolean;
  google_sheet_enabled: boolean;
  alerts_enabled: boolean;
  has_overrides: boolean;
};

/**
 * A truck under automatic checking. It has no interval of its own: it is
 * checked when one of its alerts is due, which is the only reason to check it.
 */
export type TrackedTruck = {
  id: string;
  user_id: string;
  truck_number: string;
  label: string | null;
  is_active: boolean;
  last_polled_at: string | null;
  last_event_at: string | null;
  last_location: string | null;
  last_direction: string | null;
  status: TruckStatus;
  consecutive_errors: number;
  created_at: string;
};

/* -------------------------------------------------------------------------- */
/* credits                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What one chargeable action costs, stored the way it is spoken about:
 * "1 credit = 2 automatic checks" is units_per_credit = 2.
 */
export type CreditRate = {
  action: string;
  label: string;
  description: string | null;
  units_per_credit: number;
  updated_at: string;
};

export type CreditTransaction = {
  id: number;
  user_id: string;
  delta: number;
  balance_after: number;
  reason: string;
  truck_number: string | null;
  note: string | null;
  actor_id: string | null;
  created_at: string;
};

/** Result of the spend_credits() RPC. */
export type CreditVerdict = {
  allowed: boolean;
  reason?: "no_such_user" | "account_suspended" | "unknown_action" | "out_of_credits";
  cost?: number;
  balance?: number;
};

/* -------------------------------------------------------------------------- */
/* alerts                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The alert kinds the worker knows how to evaluate. The admin composes rules
 * out of these; an officer picks a rule and sets its interval.
 */
export type AlertRuleKind = "periodic_location" | "location_change" | "plaza_crossing";

/** A rule in the admin's catalogue. Officers choose from these; they never write one. */
export type AlertRuleTemplate = {
  id: string;
  name: string;
  kind: AlertRuleKind;
  description: string | null;
  is_active: boolean;
  min_interval_minutes: number;
  default_interval_minutes: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

/** One alert an officer switched on for one truck. A truck may have several. */
export type TruckAlert = {
  id: string;
  user_id: string;
  tracked_truck_id: string;
  template_id: string;
  is_enabled: boolean;
  interval_minutes: number;
  /** plaza_crossing only: the plaza being watched. */
  plaza: string | null;
  last_run_at: string | null;
  last_location: string | null;
  created_at: string;
  updated_at: string;
};

/** A truck alert with its template joined, which is how the UI always needs it. */
export type TruckAlertWithTemplate = TruckAlert & { template: AlertRuleTemplate };

export type TollPlaza = {
  name: string;
  seen_count: number;
  last_seen_at: string;
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
  read_at: string | null;
  created_at: string;
};

/* -------------------------------------------------------------------------- */
/* logs and misc                                                               */
/* -------------------------------------------------------------------------- */

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

/** Server Action result shape used by every form in the app. */
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

/** Resolved global knobs from public.app_settings. */
export type AppSettings = {
  ldbApiUrl: string;
  trackingEnabled: boolean;
  noActivityHours: number;
  /** Rupees per credit, shown on the officer's buy-credits page. */
  creditPriceInr: number;
  razorpayEnabled: boolean;
  razorpayKeyId: string;
};
