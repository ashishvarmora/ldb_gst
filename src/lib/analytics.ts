import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PaymentMethod } from "@/lib/types";

/**
 * The reporting layer the admin console reads.
 *
 * Every figure here comes back already grouped from the database, through the
 * admin_* functions in 0024_admin_analytics.sql. Nothing on this side sums a
 * month of rows in JavaScript any more: that capped silently at the project's
 * max-rows, could only group by whatever the screen thought of in advance, and
 * gave two screens two chances to disagree about one number.
 *
 * A date range is the one argument every reader takes, and it lives in the URL
 * like the rest of this codebase's state - so a report can be linked to, kept
 * open in a second tab beside another range, and survives a refresh.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

const IST = "Asia/Kolkata";

/* -------------------------------------------------------------------------- */
/* The date range                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The ranges worth one click.
 *
 * "This month" and "Last month" are separate from the rolling windows on
 * purpose: a rolling 30 days is the right shape for spotting a trend, and a
 * calendar month is the only shape an invoice or a GST return recognises.
 * Reading one when you meant the other is the classic way to mis-state
 * revenue, so both are offered and neither is called "monthly".
 */
export const RANGE_PRESETS = [
  { key: "today", label: "Today" },
  { key: "7d", label: "Last 7 days" },
  { key: "30d", label: "Last 30 days" },
  { key: "90d", label: "Last 90 days" },
  { key: "mtd", label: "This month" },
  { key: "lastmonth", label: "Last month" },
  { key: "12m", label: "Last 12 months" },
  { key: "all", label: "All time" },
] as const;

export type RangeKey = (typeof RANGE_PRESETS)[number]["key"] | "custom";

/** Buckets a series can be grouped into. The database accepts these verbatim. */
export const BUCKETS = [
  { key: "day", label: "Daily" },
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
] as const;

export type Bucket = (typeof BUCKETS)[number]["key"];

export type DateRange = {
  /** Inclusive IST dates, YYYY-MM-DD - the form the database functions take. */
  from: string;
  to: string;
  key: RangeKey;
  bucket: Bucket;
  /** How the current selection reads in a sentence. */
  label: string;
  /** Whole days covered, inclusive. Used to size a chart and pick a bucket. */
  days: number;
};

/** Today in IST as YYYY-MM-DD. Every range is anchored to this, never to UTC. */
function istDate(at: Date = new Date()): string {
  return at.toLocaleDateString("en-CA", { timeZone: IST });
}

/** Shift a YYYY-MM-DD by whole days, staying in date space rather than time. */
export function shiftDate(date: string, days: number): string {
  const shifted = new Date(`${date}T12:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

/** Accepts only a real YYYY-MM-DD, so a hand-edited URL cannot reach the database. */
function isDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * The earliest date any report reaches back to when "All time" is chosen.
 *
 * A fixed floor rather than the first row's date: finding that date is a query
 * of its own on every page load, and the platform has no data before this.
 */
const EPOCH = "2024-01-01";

/**
 * Turn the URL's parameters into a range.
 *
 * Anything unrecognised falls back to the last 30 days rather than erroring -
 * a report is a read-only screen, and refusing to render one because a query
 * string was mistyped helps nobody.
 */
export function resolveRange(params: {
  range?: string;
  from?: string;
  to?: string;
  bucket?: string;
}): DateRange {
  const today = istDate();
  let key = (RANGE_PRESETS.find((p) => p.key === params.range)?.key ??
    (params.range === "custom" ? "custom" : "30d")) as RangeKey;

  let from = today;
  let to = today;

  switch (key) {
    case "today":
      break;
    case "7d":
      from = shiftDate(today, -6);
      break;
    case "90d":
      from = shiftDate(today, -89);
      break;
    case "mtd":
      from = `${today.slice(0, 7)}-01`;
      break;
    case "lastmonth": {
      // The first of this month, stepped back one day, gives the last day of
      // the previous month without any month-length arithmetic.
      const lastDay = shiftDate(`${today.slice(0, 7)}-01`, -1);
      from = `${lastDay.slice(0, 7)}-01`;
      to = lastDay;
      break;
    }
    case "12m":
      from = shiftDate(today, -364);
      break;
    case "all":
      from = EPOCH;
      break;
    case "custom": {
      // A custom range needs both ends. With only one, there is nothing
      // sensible to assume, so it degrades to the default window.
      if (isDate(params.from) && isDate(params.to)) {
        from = params.from;
        to = params.to;
        // Backwards is a typo, not an empty report: swapping is what the person
        // meant, and showing nothing would look like the data is missing.
        if (from > to) [from, to] = [to, from];
      } else {
        key = "30d";
        from = shiftDate(today, -29);
      }
      break;
    }
    default:
      key = "30d";
      from = shiftDate(today, -29);
  }

  const days = daysBetween(from, to);

  /*
   * The bucket is chosen from the span unless the reader overrides it. 366
   * daily bars is an unreadable smear and 12 monthly ones hide a bad week, so
   * the thresholds are where the bars stop being individually legible.
   */
  const auto: Bucket = days <= 92 ? "day" : days <= 550 ? "week" : "month";
  const bucket = (BUCKETS.find((b) => b.key === params.bucket)?.key ?? auto) as Bucket;

  const preset = RANGE_PRESETS.find((p) => p.key === key);
  const label = preset ? preset.label : `${from} to ${to}`;

  return { from, to, key, bucket, label, days };
}

/** The same window, immediately before itself - what a change figure compares against. */
export function previousRange(range: DateRange): { from: string; to: string } {
  return {
    from: shiftDate(range.from, -range.days),
    to: shiftDate(range.from, -1),
  };
}

/**
 * Percentage change, or null when there is nothing to compare against.
 *
 * Null rather than 100% for a rise from zero: "up 100%" on a first sale is
 * arithmetic that means nothing, and a screen should say "no comparison"
 * instead of inventing one.
 */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * Carry the current range through a link, so a filter or a section change never
 * resets the dates.
 *
 * The bucket rides along too. It is derived from the span when nobody has
 * chosen one, so leaving it out looks harmless - but once a reader has switched
 * a 90-day report to weekly, dropping it on the way to the next section quietly
 * puts them back on 90 daily bars and reads as the page having forgotten.
 */
export function rangeParams(range: DateRange): Record<string, string> {
  const params: Record<string, string> = { range: range.key, bucket: range.bucket };
  if (range.key === "custom") {
    params.from = range.from;
    params.to = range.to;
  }
  return params;
}

/* -------------------------------------------------------------------------- */
/* What the database returns                                                   */
/* -------------------------------------------------------------------------- */

export type RevenueRow = {
  bucket: string;
  method: PaymentMethod;
  kind: "credits" | "plan";
  gross_inr: number;
  discount_inr: number;
  payments: number;
  credits_sold: number;
  accounts: number;
};

export type CreditRow = {
  bucket: string;
  source: CreditSource;
  reason: string;
  credits: number;
  entries: number;
  accounts: number;
};

export type SignupRow = {
  bucket: string;
  signups: number;
  referred: number;
  converted: number;
};

export type AccountActivity = {
  id: string;
  email: string;
  full_name: string | null;
  district: string | null;
  stage: LifecycleStage;
  status: "active" | "suspended";
  plan_name: string | null;
  credits: number;
  signed_up_on: string;
  last_active_at: string | null;
  paid_inr: number;
  payments: number;
  credits_bought: number;
  credits_free: number;
  credits_admin: number;
  credits_spent: number;
  searches: number;
  auto_checks: number;
};

export type Funnel = {
  total: number;
  active: number;
  never_bought: number;
  credits_only: number;
  expired: number;
  dormant: number;
  never_signed_in: number;
  suspended: number;
  paying: number;
  on_plan: number;
  lifetime_inr: number;
  credits_held: number;
};

const EMPTY_FUNNEL: Funnel = {
  total: 0,
  active: 0,
  never_bought: 0,
  credits_only: 0,
  expired: 0,
  dormant: 0,
  never_signed_in: 0,
  suspended: 0,
  paying: 0,
  on_plan: 0,
  lifetime_inr: 0,
  credits_held: 0,
};

/* -------------------------------------------------------------------------- */
/* How money arrived, and where credits came from                              */
/* -------------------------------------------------------------------------- */

/**
 * Every way money can reach the business.
 *
 * 'manual' is the historical bucket: payments that predate this column and had
 * no Razorpay id, so all that is honestly known is that somebody entered them.
 * New offline receipts pick a real method, so that bucket only ever shrinks.
 */
export const PAYMENT_METHODS = [
  { key: "razorpay", label: "Razorpay", hint: "Card, UPI or netbanking through the gateway" },
  { key: "cash", label: "Cash", hint: "Handed over in person" },
  { key: "bank_transfer", label: "Bank transfer", hint: "NEFT, RTGS or IMPS into the account" },
  { key: "upi", label: "UPI (direct)", hint: "Paid to a UPI id without the gateway" },
  { key: "cheque", label: "Cheque", hint: "Recorded once it has cleared" },
  { key: "manual", label: "Recorded by hand", hint: "Entered before methods were tracked" },
  { key: "other", label: "Other", hint: "Anything that fits none of the above" },
] as const satisfies readonly { key: PaymentMethod; label: string; hint: string }[];

/** The methods an administrator may choose when recording a receipt themselves. */
export const OFFLINE_METHODS = PAYMENT_METHODS.filter((m) => m.key !== "razorpay");

export function methodLabel(method: string): string {
  return PAYMENT_METHODS.find((m) => m.key === method)?.label ?? method;
}

/** Credit buckets, matching credit_source() in the database exactly. */
export const CREDIT_SOURCES = [
  { key: "paid", label: "Bought", hint: "Credits that followed money through the gateway or a receipt" },
  { key: "admin", label: "Given by an admin", hint: "Top-ups and adjustments made from this console" },
  { key: "free", label: "Free", hint: "Sign-up bonus, referral rewards and bonus codes" },
  { key: "other", label: "Unclassified", hint: "A reason no bucket recognises — worth investigating" },
] as const;

export type CreditSource = (typeof CREDIT_SOURCES)[number]["key"] | "spend";

/* -------------------------------------------------------------------------- */
/* Lifecycle stages                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Where an account stands, in the words the owner used to ask for it.
 *
 * The order is the order they are worth acting on: a plan that has run out is
 * a renewal conversation, someone who signed up and never bought is a sales
 * one, and a dormant paying account is the one that churns next month.
 */
export const LIFECYCLE_STAGES = [
  {
    key: "active",
    label: "Active",
    tone: "good",
    hint: "On a plan that has not expired, and seen in the last 30 days",
  },
  {
    key: "expired",
    label: "Plan expired",
    tone: "bad",
    hint: "Was on a plan, the plan has run out — the renewal list",
  },
  {
    key: "never_bought",
    label: "Never bought",
    tone: "warn",
    hint: "Registered, no plan and no payment — the sales list",
  },
  {
    key: "credits_only",
    label: "Credits, no plan",
    tone: "brand",
    hint: "Has paid for credits but is not on a plan",
  },
  {
    key: "dormant",
    label: "Dormant",
    tone: "warn",
    hint: "On a plan but not seen for over 30 days — churns next",
  },
  {
    key: "never_signed_in",
    label: "Never signed in",
    tone: "neutral",
    hint: "Account created and never used once",
  },
  { key: "suspended", label: "Suspended", tone: "neutral", hint: "Switched off by an administrator" },
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number]["key"];

export function stageOf(key: string) {
  return LIFECYCLE_STAGES.find((s) => s.key === key);
}

/* -------------------------------------------------------------------------- */
/* Readers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Every reader swallows its own error and returns an empty result.
 *
 * These pages fetch six or seven series at once with Promise.all. One rejection
 * would blank the whole screen, which turns a missing chart into a missing
 * report - so a failed series renders as an empty chart beside six that worked,
 * and the console log says which one failed.
 */
async function callRpc<T>(admin: Admin, fn: string, args: Record<string, unknown>): Promise<T[]> {
  const { data, error } = await admin.rpc(fn, args);
  if (error) {
    console.error(`analytics: ${fn} failed`, error.message);
    return [];
  }
  return (data ?? []) as T[];
}

export function loadRevenueSeries(admin: Admin, range: { from: string; to: string; bucket: Bucket }) {
  return callRpc<RevenueRow>(admin, "admin_revenue_series", {
    p_from: range.from,
    p_to: range.to,
    p_bucket: range.bucket,
  });
}

/**
 * Credits in and out. Pass `userId` for one account, leave it out for the
 * platform - the same function either way, so an account's own chart and the
 * platform chart can never be counted differently.
 */
export function loadCreditSeries(
  admin: Admin,
  range: { from: string; to: string; bucket: Bucket },
  userId?: string,
) {
  return callRpc<CreditRow>(admin, "admin_credit_series", {
    p_from: range.from,
    p_to: range.to,
    p_bucket: range.bucket,
    p_user: userId ?? null,
  });
}

export function loadSignupSeries(admin: Admin, range: { from: string; to: string; bucket: Bucket }) {
  return callRpc<SignupRow>(admin, "admin_signup_series", {
    p_from: range.from,
    p_to: range.to,
    p_bucket: range.bucket,
  });
}

export function loadAccountActivity(admin: Admin, range: { from: string; to: string }) {
  return callRpc<AccountActivity>(admin, "admin_account_activity", {
    p_from: range.from,
    p_to: range.to,
  });
}

export async function loadFunnel(admin: Admin): Promise<Funnel> {
  const { data, error } = await admin.rpc("admin_user_funnel");
  if (error) {
    console.error("analytics: admin_user_funnel failed", error.message);
    return EMPTY_FUNNEL;
  }
  return { ...EMPTY_FUNNEL, ...((data ?? {}) as Partial<Funnel>) };
}

/* -------------------------------------------------------------------------- */
/* The pivot                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The dimensions the ledger can be sliced by.
 *
 * Every Analyse screen used to have its own grouping baked into its own
 * database function, so the console could only answer the questions somebody
 * had already written SQL for - "what did this account spend per truck last
 * week" had no answer at all. One function takes these instead, and the screen
 * says which it wants.
 */
export const PIVOT_DIMENSIONS = [
  { key: "bucket", label: "Period", hint: "By day, week or month" },
  { key: "account", label: "Customer", hint: "One row per account" },
  { key: "truck", label: "Truck", hint: "Which lorry the charge was against" },
  { key: "reason", label: "Action", hint: "Manual search, automatic check, top-up, bonus" },
  { key: "source", label: "Source", hint: "Bought, added by an admin, or given free" },
] as const;

export type PivotDimension = (typeof PIVOT_DIMENSIONS)[number]["key"];

export function isPivotDimension(value: string): value is PivotDimension {
  return PIVOT_DIMENSIONS.some((d) => d.key === value);
}

/** Which half of the ledger. Spending is a sign test, not a named source. */
export type LedgerKind = "all" | "spend" | "grant";

/**
 * One grouped row. Every dimension the caller did not ask for comes back null,
 * so a row's shape tells you what it is a total OF.
 */
export type PivotRow = {
  bucket: string | null;
  user_id: string | null;
  account: string | null;
  truck_number: string | null;
  reason: string | null;
  source: string | null;
  entries: number;
  /** Signed: negative for spending, positive for credits added. */
  credits: number;
  accounts: number;
  trucks: number;
  first_at: string | null;
  last_at: string | null;
};

export type PivotQuery = {
  from: string;
  to: string;
  dims: PivotDimension[];
  bucket?: Bucket;
  kind?: LedgerKind;
  users?: string[];
  trucks?: string[];
  reasons?: string[];
  sources?: string[];
};

/**
 * Read the ledger, grouped however the screen asked.
 *
 * Passing no dimensions is the totals row - one line for the whole window -
 * which is how a screen gets a figure that is guaranteed to agree with the
 * table under it, because both came out of the same function.
 */
export function loadPivot(admin: Admin, query: PivotQuery) {
  return callRpc<PivotRow>(admin, "admin_credit_pivot", {
    p_from: query.from,
    p_to: query.to,
    p_dims: query.dims,
    p_bucket: query.bucket ?? "day",
    p_kind: query.kind ?? "all",
    p_users: query.users?.length ? query.users : null,
    p_trucks: query.trucks?.length ? query.trucks : null,
    p_reasons: query.reasons?.length ? query.reasons : null,
    p_sources: query.sources?.length ? query.sources : null,
  });
}

export type Facet = { label: string; entries: number };
export type AccountFacet = { id: string; label: string; entries: number };
export type Facets = {
  accounts: AccountFacet[];
  trucks: Facet[];
  reasons: Facet[];
  sources: Facet[];
};

const EMPTY_FACETS: Facets = { accounts: [], trucks: [], reasons: [], sources: [] };

/**
 * What a filter control can offer.
 *
 * Built from the whole window rather than from the rows on screen: a dropdown
 * assembled from what is already visible can only ever narrow to something the
 * reader can already see, which is not narrowing.
 */
export async function loadFacets(
  admin: Admin,
  range: { from: string; to: string },
  kind: LedgerKind = "all",
): Promise<Facets> {
  const { data, error } = await admin.rpc("admin_credit_facets", {
    p_from: range.from,
    p_to: range.to,
    p_kind: kind,
  });
  if (error) {
    console.error("analytics: admin_credit_facets failed", error.message);
    return EMPTY_FACETS;
  }
  return { ...EMPTY_FACETS, ...((data ?? {}) as Partial<Facets>) };
}

/** The one total a screen should quote, read from the same function as its table. */
export async function loadPivotTotals(
  admin: Admin,
  query: Omit<PivotQuery, "dims">,
): Promise<PivotRow | null> {
  const rows = await loadPivot(admin, { ...query, dims: [] });
  return rows[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Folding series into what a screen draws                                     */
/* -------------------------------------------------------------------------- */

/** Sum one numeric column across rows. */
export function sumBy<T>(rows: T[], pick: (row: T) => number | null | undefined): number {
  return rows.reduce((total, row) => total + (Number(pick(row)) || 0), 0);
}

/** Total per key, in one pass - the shape every breakdown panel wants. */
export function groupSum<T>(
  rows: T[],
  key: (row: T) => string,
  value: (row: T) => number | null | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    out.set(k, (out.get(k) ?? 0) + (Number(value(row)) || 0));
  }
  return out;
}

/**
 * Collapse a series to one point per bucket and fill in the buckets nothing
 * happened in.
 *
 * The filling is the point: a chart drawn only from the buckets that have rows
 * silently closes the gaps, so a fortnight with no sales looks like a
 * continuous line rather than the hole it is.
 */
export function fillBuckets<T extends { bucket: string }>(
  rows: T[],
  range: DateRange,
  value: (row: T) => number,
): { bucket: string; value: number }[] {
  const totals = groupSum(rows, (row) => row.bucket, value);
  const points: { bucket: string; value: number }[] = [];

  const step = range.bucket === "day" ? 1 : range.bucket === "week" ? 7 : 0;

  if (step === 0) {
    // Months, walked as calendar months so a 31-day step cannot skip February.
    let cursor = `${range.from.slice(0, 7)}-01`;
    const last = `${range.to.slice(0, 7)}-01`;
    let guard = 0;
    while (cursor <= last && guard < 240) {
      points.push({ bucket: cursor, value: totals.get(cursor) ?? 0 });
      const [y, m] = cursor.split("-").map(Number);
      cursor = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
      guard += 1;
    }
    return points;
  }

  /*
   * Weeks are anchored to the Monday the range starts inside, not to the
   * range's first day, because that is where date_trunc('week') puts them. An
   * unanchored walk would ask for buckets the database never emits and draw a
   * chart of zeroes beside the real one.
   */
  let cursor = range.bucket === "week" ? mondayOf(range.from) : range.from;
  let guard = 0;
  while (cursor <= range.to && guard < 800) {
    points.push({ bucket: cursor, value: totals.get(cursor) ?? 0 });
    cursor = shiftDate(cursor, step);
    guard += 1;
  }
  return points;
}

/** The Monday of the week a date falls in, matching date_trunc('week'). */
function mondayOf(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  // getUTCDay is 0 for Sunday; Monday-based weeks want Sunday to step back six.
  const offset = (at.getUTCDay() + 6) % 7;
  return shiftDate(date, -offset);
}

/** How a bucket reads on an axis: "12 Mar", "Wk 12 Mar", "Mar 2026". */
export function bucketLabel(bucket: string, grain: Bucket): string {
  const at = new Date(`${bucket}T12:00:00Z`);
  if (Number.isNaN(at.getTime())) return bucket;
  if (grain === "month") {
    return at.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  const day = at.toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return grain === "week" ? `Wk ${day}` : day;
}
