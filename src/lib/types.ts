export type UserRole = "super_admin" | "officer";
export type AccountStatus = "active" | "suspended";
export type QuerySource = "manual" | "tracking";
export type TruckStatus = "moving" | "idle" | "no_activity" | "unknown";

/**
 * A plan decides two things: how many trucks may be watched at once, and how
 * many credits the account opens with. Usage is paid for out of the credit
 * balance, so there is nothing else for a plan to cap.
 *
 * An account must have a live plan before it may buy credits.
 */
export type Plan = {
  id: string;
  name: string;
  description: string | null;
  /** How many trucks may be under automatic checking at once. */
  truck_limit: number;
  /** Credits handed over when the plan is assigned. */
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
  /** Shared to invite someone. Derived from the id, so it never collides. */
  referral_code: string | null;
  referred_by: string | null;
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
  has_overrides: boolean;
  /** Assigned, unexpired and not suspended - the gate on buying credits. */
  plan_active: boolean;
  active_trucks: number;
  total_trucks: number;
  manual_searches_today: number;
  tracking_queries_today: number;
  manual_searches_month: number;
  tracking_queries_month: number;
  credits_spent_today: number;
  credits_spent_month: number;
  credits_purchased: number;
  alerts_today: number;
  alerts_unread: number;
  active_alerts: number;
  total_events: number;
  telegram_connected: boolean;
  last_event_at: string | null;
};

export type LimitOverrides = {
  user_id: string;
  truck_limit: number | null;
  reason: string | null;
  updated_at: string;
};

/** One row of public.officer_effective_limits. */
export type EffectiveLimits = {
  user_id: string;
  truck_limit: number;
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
  /**
   * How many checks in a row may fail before this truck is paused. null means
   * the officer has not chosen, so the worker derives one from the truck's own
   * check interval - see resolveFailureBudget().
   */
  max_consecutive_failures: number | null;
  /**
   * When automatic checking should stop by itself, as an instant rather than a
   * duration. The officer types "6 hours" when they add the truck and the
   * server works out the moment that lands on - a stored duration would have
   * to be re-based against something, and both obvious candidates (added at,
   * edited at) are wrong the moment anybody touches the row for another
   * reason. null means it runs until something else stops it.
   */
  auto_pause_at: string | null;
  /**
   * Pause once no new crossing has been seen for this many hours. A duration
   * rather than an instant, because it is measured from a moving target - the
   * last crossing. null means the officer has not chosen, so the platform
   * setting applies - see resolveInactiveWindow().
   */
  inactive_pause_hours: number | null;
  /** Why is_active went false. null while it is running. */
  paused_reason: PausedReason | null;
  paused_at: string | null;
  /** Set when the "this truck keeps failing" warning went out, so it goes once. */
  failure_warned_at: string | null;
  created_at: string;
};

/** Why a truck stopped being checked. Mirrors the check on tracked_trucks. */
export type PausedReason =
  | "manual"
  | "repeated_failures"
  | "account_suspended"
  | "schedule"
  | "inactive";

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
  /**
   * The crossing this alert last reported. A truck can pass one plaza twice in
   * a day, so the plaza name alone cannot say whether something is new.
   */
  last_event_at: string | null;
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
  /** Set when the officer cleared the bell. The row stays; it is only hidden. */
  cleared_at: string | null;
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
  /** officer | super_admin - the audit page shows officer activity. */
  actor_role: string | null;
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

/** Resolved global knobs from public.app_settings. */
export type AppSettings = {
  ldbApiUrl: string;
  trackingEnabled: boolean;
  noActivityHours: number;
  /**
   * How many checks in a row may fail before a truck is paused, for trucks
   * whose officer has not set their own number. The admin's floor, not a
   * per-truck one - see tracked_trucks.max_consecutive_failures.
   */
  trackingFailureCutoff: number;
  /**
   * The platform-wide fallback for "stop checking once the lorry has not moved
   * for this long", in hours. Used for any truck whose owner did not set their
   * own. Generous on purpose: this stops a truck being watched, and a customer
   * whose lorry quietly went unchecked over a long weekend in a yard is a
   * worse outcome than some wasted credits.
   */
  inactivePauseHours: number;
  /**
   * Credits handed to a brand-new account so it can try a search before paying.
   * 0 switches the free tier off entirely.
   */
  signupFreeCredits: number;
  /**
   * How long a reading at the same plaza counts as the same crossing being
   * re-reported. Past it, the truck has come back and that is news.
   */
  revisitMinutes: number;
  /** Days of history kept in the database before a backup-and-purge. */
  dataRetentionDays: number;
  /** How often the backup-and-purge runs. */
  backupIntervalDays: number;
  /** How often rows are exported to sheets and then trimmed. */
  sheetExportIntervalDays: number;
  /** Where the backup is written. Empty means no backup is wanted. */
  backupSheetId: string;
  razorpayEnabled: boolean;
  razorpayKeyId: string;
  /** Base money-to-credits rate: 1 rupee buys this many credits. */
  creditsPerRupee: number;
  referralEnabled: boolean;
  /** Share of a referred person's first payment, paid to the referrer. */
  referralPercent: number;
  /**
   * The smallest payment that earns the inviter anything, in rupees, tested
   * against what was actually charged after any discount. 0 means no floor,
   * which is how this behaved before the setting existed.
   */
  referralMinPayment: number;
  referralMilestoneCount: number;
  referralMilestoneBonus: number;
  /** Shown wherever the product names itself. */
  brandName: string;
  /** False closes public registration; existing accounts are unaffected. */
  signupEnabled: boolean;
  supportEmail: string;
  supportPhone: string;
  supportAddress: string;
  privacyUrl: string;
  termsUrl: string;
};

/* -------------------------------------------------------------------------- */
/* money                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * What a rupee amount buys. Written as explicit rows rather than a formula,
 * because the ladder is not a smooth curve and an admin editing a number is
 * clearer than an admin editing a multiplier.
 */
export type CreditPack = {
  id: string;
  name: string;
  /** On an open-ended tier this is the minimum, not the price. */
  price_inr: number;
  /** What a fixed rung gives. Ignored when is_open_ended. */
  credits: number;
  /**
   * True: the buyer names any amount at or above price_inr, and the credits
   * are worked out from the base rate and credit_percent. The ladder ends in a
   * rule rather than a wall.
   */
  is_open_ended: boolean;
  /**
   * Open tiers only: what share of the money becomes credits, against the base
   * rate. 100 is one credit per rupee, 250 is two and a half. A fixed rung
   * states its credits outright and ignores this.
   */
  credit_percent: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type PaymentStatus = "created" | "paid" | "failed";

/** A payment buys credits, or it buys a plan. */
export type PaymentKind = "credits" | "plan";

/**
 * How money reached the business. Mirrors the payments_method_check constraint
 * in 0024_admin_analytics.sql; the labels a screen shows live in
 * @/lib/analytics, which is the only place that turns one of these into words.
 */
export type PaymentMethod =
  | "razorpay"
  | "cash"
  | "bank_transfer"
  | "upi"
  | "cheque"
  | "manual"
  | "other";

export type Payment = {
  id: string;
  user_id: string;
  pack_id: string | null;
  kind: PaymentKind;
  plan_id: string | null;
  months: number;
  /** Set when a code was used. amount_inr is already net of the discount. */
  coupon_id: string | null;
  discount_inr: number;
  razorpay_order_id: string;
  razorpay_payment_id: string | null;
  amount_inr: number;
  credits: number;
  status: PaymentStatus;
  failure_reason: string | null;
  created_at: string;
  paid_at: string | null;
  /**
   * How the money arrived. 'razorpay' for anything the gateway settled;
   * cash, bank_transfer, upi or cheque for a receipt an administrator entered
   * by hand. 'manual' is the historical bucket for payments recorded before
   * this column existed, where all that is honestly known is that no gateway
   * was involved.
   */
  method: PaymentMethod;
  /** The administrator who entered an offline receipt. Null for a gateway payment. */
  recorded_by: string | null;
  /** Free text on an offline receipt: a cheque number, who handed the cash over. */
  note: string | null;
};

/** One row of public.truck_directory - a truck with the officer watching it. */
export type TruckDirectoryRow = {
  tracked_truck_id: string;
  truck_number: string;
  label: string | null;
  is_active: boolean;
  status: TruckStatus;
  last_location: string | null;
  last_event_at: string | null;
  last_polled_at: string | null;
  created_at: string;
  /**
   * Why checking stopped, carried through so the admin fielding "my lorry
   * went quiet" can answer without opening the customer's own screen - which
   * they cannot do, because it is a portal page.
   */
  paused_reason: PausedReason | null;
  paused_at: string | null;
  auto_pause_at: string | null;
  officer_id: string;
  officer_name: string | null;
  officer_email: string;
  officer_phone: string | null;
  office: string | null;
  district: string | null;
  state: string | null;
  alert_count: number;
  event_count: number;
};


/** One row of the search_plazas() RPC. */
export type PlazaMatch = { name: string; seen_count: number; score: number };

/* -------------------------------------------------------------------------- */
/* referrals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * One person invited. Stays "pending", earning nothing, until their first
 * payment lands - a sign-up is free to manufacture, a payment is not.
 */
export type Referral = {
  id: string;
  referrer_id: string;
  referred_id: string;
  status: "pending" | "rewarded";
  reward_credits: number;
  first_amount: number | null;
  rewarded_at: string | null;
  created_at: string;
  /** Joined for display; absent on a bare select. */
  referred?: { email: string; full_name: string | null; created_at: string } | null;
};

/** One row of public.referral_summary. */
export type ReferralSummary = {
  referrer_id: string;
  email: string;
  full_name: string | null;
  referral_code: string | null;
  invited: number;
  paid: number;
  waiting: number;
  credits_earned: number;
};

/* -------------------------------------------------------------------------- */
/* coupons                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * What a coupon does.
 *
 * percent / flat reduce a price and are entered at a checkout. credit_bonus
 * reduces nothing - it is worth credits and is entered on its own, so `value`
 * means credits rather than rupees or a percentage.
 */
export type CouponKind = "percent" | "flat" | "credit_bonus";
/** Which purchases a code is good for. */
export type CouponScope = "all" | "credits" | "plan";

export type Coupon = {
  id: string;
  code: string;
  description: string | null;
  kind: CouponKind;
  /** A percentage when kind is percent, rupees when flat. */
  value: number;
  /** The "up to" cap on a percentage. Null is uncapped. */
  max_discount_inr: number | null;
  min_spend_inr: number;
  /** Claims across everyone. Null is unlimited. */
  max_claims: number | null;
  max_per_user: number;
  applies_to: CouponScope;
  starts_at: string | null;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

/** One row of public.coupon_usage - a coupon with how it is doing. */
export type CouponUsage = Coupon & {
  used: number;
  /** Reserved by a checkout that has not settled yet. */
  holding: number;
  discount_given: number;
  list_total: number;
  claims_left: number | null;
};

export type CouponRedemption = {
  id: string;
  coupon_id: string;
  user_id: string;
  payment_id: string | null;
  status: "reserved" | "applied" | "released";
  amount_inr: number;
  discount_inr: number;
  created_at: string;
  settled_at: string | null;
};

/**
 * What validate_coupon() answers. A refusal is an ordinary result with a
 * message worth showing, not an error - so both halves are always present.
 */
export type CouponVerdict =
  | {
      ok: true;
      coupon_id: string;
      code: string;
      kind: CouponKind;
      discount_inr: number;
      payable_inr: number;
      message: string;
    }
  | {
      ok: false;
      reason:
        | "empty"
        | "unknown"
        | "inactive"
        | "not_started"
        | "expired"
        | "wrong_kind"
        | "min_spend"
        | "exhausted"
        | "already_used"
        | "no_discount";
      message: string;
      min_spend_inr?: number;
    };

/* -------------------------------------------------------------------------- */
/* retention                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * How long one table is kept. `entity` is the table name, so the purge job
 * needs no mapping and cannot drift out of step with the schema.
 */
export type RetentionRule = {
  entity: string;
  label: string;
  description: string | null;
  /** -1 keeps everything. */
  keep_days: number;
  backup_before_delete: boolean;
  is_enabled: boolean;
  /**
   * The money record rather than a log. Balances are reconstructed from these,
   * so trimming them destroys the explanation for a balance instead of freeing
   * useful space.
   */
  is_protected: boolean;
  sort_order: number;
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

