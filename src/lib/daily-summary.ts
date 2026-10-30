import { loadPivotTotals, methodLabel, shiftDate } from "@/lib/analytics";
import { CREDIT_ACTIONS, formatCredits } from "@/lib/credits";
import { accountUrl, esc, notifyTarget, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { fmtDate, fmtDayTime, fmtNumber, fmtRelative, fmtRupees, fmtTime, istToday } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The owner's end-of-day mail.
 *
 * One message, at daily_summary_hour IST, to the Notify admin list: what came
 * in, who arrived, what was used, and - first, above everything - what needs
 * somebody to pick up the phone. Read on a phone at nine at night, so it leads
 * with four numbers and a short to-do list and only then the detail.
 *
 * Every figure is counted the way the admin console counts it, so the mail and
 * the dashboard never disagree about one number:
 *   - revenue is payments at status 'paid', dated by coalesce(paid_at,
 *     created_at), customers (role 'officer') only - admin_revenue_series();
 *   - credits used is admin_credit_pivot() with kind 'spend', limited to the
 *     charged actions (searches and checks) so an admin deduction is not usage;
 *   - an active plan is officer_overview.plan_active;
 *   - a failed check is a search_logs row with ok = false.
 *
 * Never throws. The callers are a cron tick and the tracking tick, and neither
 * should fall over because a summary could not be put together.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

const MARKER_KEY = "daily_summary_last_sent";
/** A checkout open longer than this is not in flight any more. Matches the dashboard. */
const CHECKOUT_STUCK_MINUTES = 30;
/** Rows per list before "and N more". */
const LIST_CAP = 10;
/** Days ahead a plan expiry is worth a renewal call. */
const EXPIRY_WINDOW_DAYS = 3;
/** Razorpay's words when the site the checkout ran on is not registered with it. */
const RAZORPAY_SITE_BLOCK = /does not match registered website/i;

/* -------------------------------------------------------------------------- */
/* Sending, once a day                                                         */
/* -------------------------------------------------------------------------- */

export async function maybeSendDailySummary(
  admin: Admin,
  opts: { force?: boolean } = {},
): Promise<{ sent: boolean; reason: string }> {
  try {
    const settings = await loadSettings(admin);
    if (!settings.adminNotifyDailySummary && !opts.force) {
      return { sent: false, reason: "The daily summary is switched off." };
    }

    const today = istToday();
    const hour = clampHour(settings.dailySummaryHour);

    if (!opts.force && istHourNow() < hour) {
      return { sent: false, reason: `Not ${hourLabel(hour)} IST yet.` };
    }

    if (opts.force) {
      /* The "send a test now" button: no hour, no once-a-day, and the marker is
         left alone so tonight's real one still goes out. */
      const target = await notifyTarget(admin, "daily_summary");
      if (!target) return { sent: false, reason: noTargetReason() };
      const mail = await buildDailySummary(admin, today);
      const sent = await sendEmail({ to: target.to, ...mail });
      if (!sent.ok) {
        console.error("daily summary (test) not sent:", sent.error);
        return { sent: false, reason: sent.error };
      }
      return { sent: true, reason: `Sent to ${target.to.join(", ")}.` };
    }

    /* Cheap check first: after the hour this runs every minute until midnight,
       and on all but one of those ticks the answer is "already sent". */
    const marker = await readMarker(admin);
    if (!marker.ok) return { sent: false, reason: marker.reason };
    if (marker.value === today) return { sent: false, reason: "Already sent today." };

    const target = await notifyTarget(admin, "daily_summary");
    if (!target) return { sent: false, reason: noTargetReason() };

    const claim = await claimDay(admin, today, marker);
    if (!claim.ok) return { sent: false, reason: claim.reason };

    let failure: string | null = null;
    try {
      const mail = await buildDailySummary(admin, today);
      const sent = await sendEmail({ to: target.to, ...mail });
      if (!sent.ok) failure = sent.error;
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }

    if (failure) {
      /* Hand the day back, so the next tick tries again rather than the owner
         silently getting nothing tonight. */
      await releaseDay(admin, claim.stamp, marker.value);
      console.error("daily summary not sent:", failure);
      return { sent: false, reason: failure };
    }
    return { sent: true, reason: `Sent to ${target.to.join(", ")}.` };
  } catch (error) {
    console.error("daily summary crashed:", error);
    return { sent: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function noTargetReason(): string {
  return "Nobody to send to: no Notify admin address, the daily summary is off, or this deployment cannot send email.";
}

type Marker =
  | { ok: true; value: string; updatedAt: string | null }
  | { ok: false; reason: string };

/** The last IST day a summary went out, creating the row on first use. */
async function readMarker(admin: Admin): Promise<Marker> {
  const read = () =>
    admin.from("app_settings").select("value, updated_at").eq("key", MARKER_KEY).maybeSingle();

  let { data, error } = await read();
  if (error) return { ok: false, reason: `Could not read ${MARKER_KEY}: ${error.message}` };

  if (!data) {
    /* A date long past, so the first claim below has something to move off.
       ignoreDuplicates: two ticks creating it at once is fine, one wins. */
    const { error: insertError } = await admin
      .from("app_settings")
      .upsert({ key: MARKER_KEY, value: "1970-01-01" }, { onConflict: "key", ignoreDuplicates: true });
    if (insertError) {
      return { ok: false, reason: `Could not create ${MARKER_KEY}: ${insertError.message}` };
    }
    ({ data, error } = await read());
    if (error || !data) {
      return { ok: false, reason: `Could not read ${MARKER_KEY}: ${error?.message ?? "row missing"}` };
    }
  }

  const row = data as { value: unknown; updated_at: string | null };
  return {
    ok: true,
    value: typeof row.value === "string" ? row.value : "",
    updatedAt: row.updated_at,
  };
}

/**
 * Take today for this caller, or learn that somebody else already has.
 *
 * Optimistic: the update only matches while updated_at is still what we read,
 * so of two ticks that read the same row, the second one's UPDATE re-checks
 * the row after the first commits, finds a new updated_at, and matches
 * nothing. Only the caller that got a row back sends.
 */
async function claimDay(
  admin: Admin,
  today: string,
  marker: Extract<Marker, { ok: true }>,
): Promise<{ ok: true; stamp: string } | { ok: false; reason: string }> {
  const stamp = new Date().toISOString();
  let query = admin
    .from("app_settings")
    .update({ value: today, updated_at: stamp })
    .eq("key", MARKER_KEY);
  query = marker.updatedAt === null ? query.is("updated_at", null) : query.eq("updated_at", marker.updatedAt);

  const { data, error } = await query.select("key");
  if (error) return { ok: false, reason: `Could not claim today: ${error.message}` };
  if (!data || data.length === 0) {
    return { ok: false, reason: "Another tick is sending today's summary." };
  }
  return { ok: true, stamp };
}

/** Put the previous day back after a failed send, unless something moved it since. */
async function releaseDay(admin: Admin, stamp: string, previous: string): Promise<void> {
  const { error } = await admin
    .from("app_settings")
    .update({ value: previous || "1970-01-01", updated_at: new Date().toISOString() })
    .eq("key", MARKER_KEY)
    .eq("updated_at", stamp);
  if (error) console.error("daily summary: could not release today's claim:", error.message);
}

/* -------------------------------------------------------------------------- */
/* Time, in IST                                                                */
/* -------------------------------------------------------------------------- */

function clampHour(value: number): number {
  const hour = Math.floor(Number(value));
  return Number.isFinite(hour) ? Math.min(23, Math.max(0, hour)) : 21;
}

function istHourNow(): number {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(
      new Date(),
    ),
  );
  return Number.isFinite(hour) ? hour : 0;
}

/** 21 -> "9 pm", 0 -> "12 am". */
function hourLabel(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "am" : "pm"}`;
}

/** The instant an IST calendar day starts, as an ISO string. */
function istDayStart(date: string): string {
  return new Date(`${date}T00:00:00+05:30`).toISOString();
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Thu 30 Oct 2026". Spelled out by hand: en-GB writes "Sept", en-US adds commas. */
function longDay(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  return `${WEEKDAYS[at.getUTCDay()]} ${shortDay(date)} ${at.getUTCFullYear()}`;
}

/** "30 Oct" */
function shortDay(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]}`;
}

/* -------------------------------------------------------------------------- */
/* Reading the day                                                             */
/* -------------------------------------------------------------------------- */

type Person = { id: string; full_name: string | null; email: string; phone: string | null; role: string };

type PaymentRow = {
  id: string;
  user_id: string;
  kind: string;
  status: string;
  amount_inr: number;
  discount_inr: number | null;
  credits: number | null;
  topup_credits: number | null;
  method: string;
  plan_id: string | null;
  failure_reason: string | null;
  created_at: string;
  paid_at: string | null;
};

type OverviewRow = {
  id: string;
  full_name: string | null;
  email: string;
  phone: string | null;
  created_at: string;
  plan_name: string | null;
  plan_is_trial: boolean | null;
  plan_active: boolean | null;
  plan_expires_on: string | null;
  credits: number | null;
};

type Lead = {
  userId: string;
  attempts: number;
  latest: PaymentRow;
  state: "failed" | "open" | "abandoned";
};

type Day = {
  date: string;
  live: boolean;
  /** When the window closes: now for today, midnight for a past day. */
  until: Date;
  compareLabel: string;
  people: Map<string, Person>;
  planNames: Map<string, string>;
  paid: PaymentRow[];
  prevRevenue: number;
  prevPlans: number;
  prevTopups: number;
  leads: Lead[];
  failedAttempts: number;
  failureReasons: [string, number][];
  recovered: number;
  stuckCheckouts: number;
  razorpayBlocked: number;
  signups: OverviewRow[];
  prevSignups: number;
  activePlans: number;
  activeTrials: number;
  expiring: OverviewRow[];
  trucksActive: number;
  trucksTotal: number;
  autoChecks: number;
  autoFailed: number;
  manualSearches: number;
  manualFailed: number;
  prevChecks: number;
  crossings: number;
  alertsDelivered: number;
  alertsFailed: number;
  alertErrors: [string, number][];
  creditsUsed: number;
  creditAccounts: number;
  checkErrors: [string, number][];
  pausedToday: { truck: string; reason: string; userId: string }[];
  chatsToday: number;
  chatCustomers: number;
  unread: { userId: string; count: number; oldest: string; latestBody: string }[];
  problems: string[];
};

/** Run a query, and on failure note it and carry on with the fallback. */
async function attempt<T>(
  problems: string[],
  label: string,
  run: () => PromiseLike<{ data: unknown; error: { message: string } | null; count?: number | null }>,
  pick: (res: { data: unknown; count?: number | null }) => T,
  fallback: T,
): Promise<T> {
  try {
    const res = await run();
    if (res.error) {
      problems.push(`${label}: ${res.error.message}`);
      console.error(`daily summary: ${label} failed`, res.error.message);
      return fallback;
    }
    return pick(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    problems.push(`${label}: ${message}`);
    console.error(`daily summary: ${label} crashed`, message);
    return fallback;
  }
}

const rowsOf = <T>(res: { data: unknown }): T[] => (Array.isArray(res.data) ? (res.data as T[]) : []);
const countOf = (res: { count?: number | null }): number => res.count ?? 0;

function tally(values: string[]): [string, number][] {
  const map = new Map<string, number>();
  for (const value of values) map.set(value, (map.get(value) ?? 0) + 1);
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
}

/** Group an error message: no ids, no long tails, so the same fault counts once. */
function errorKey(message: string | null | undefined): string {
  const text = (message ?? "").trim().replace(/\s+/g, " ");
  if (!text) return "No reason given";
  return truncate(text, 90);
}

function truncate(value: string, length: number): string {
  return value.length > length ? `${value.slice(0, length - 1).trimEnd()}…` : value;
}

const isPaidIn = (row: PaymentRow, from: string, to: string) => {
  const at = row.paid_at ?? row.created_at;
  return row.status === "paid" && at >= from && at < to;
};

async function readDay(admin: Admin, date: string): Promise<Day> {
  const problems: string[] = [];

  const live = date === istToday();
  const from = istDayStart(date);
  const midnight = istDayStart(shiftDate(date, 1));
  const until = live ? new Date() : new Date(midnight);
  const to = until.toISOString();

  /* Yesterday up to the same minute, while the day is still running - a
     9 pm total against yesterday's whole day would read as a bad day every
     evening. A finished day is compared with the whole of the one before. */
  const prevFrom = istDayStart(shiftDate(date, -1));
  const prevTo = live ? new Date(until.getTime() - 86_400_000).toISOString() : from;
  const compareLabel = live ? "this time yesterday" : "the day before";

  const paymentCols =
    "id, user_id, kind, status, amount_inr, discount_inr, credits, topup_credits, method, plan_id, failure_reason, created_at, paid_at";
  const inWindow = (a: string, b: string) =>
    `and(paid_at.gte."${a}",paid_at.lt."${b}"),and(created_at.gte."${a}",created_at.lt."${b}")`;

  const searchCount = (source: "manual" | "tracking", a: string, b: string, failedOnly = false) => () => {
    let q = admin
      .from("search_logs")
      .select("id", { count: "exact", head: true })
      .eq("source", source)
      .gte("created_at", a)
      .lt("created_at", b);
    if (failedOnly) q = q.eq("ok", false);
    return q;
  };

  const [
    payments,
    prevPayments,
    signups,
    prevSignups,
    activePlans,
    activeTrials,
    expiring,
    trucksActive,
    trucksTotal,
    autoChecks,
    autoFailed,
    manualSearches,
    manualFailed,
    prevAuto,
    prevManual,
    crossings,
    alertsDelivered,
    alertFailures,
    spend,
    failedChecks,
    paused,
    chatsToday,
    unreadRows,
  ] = await Promise.all([
    attempt(problems, "payments", () =>
      admin.from("payments").select(paymentCols).or(inWindow(from, to)).order("created_at").limit(1000),
      rowsOf<PaymentRow>, [] as PaymentRow[]),
    attempt(problems, "yesterday's payments", () =>
      admin.from("payments").select(paymentCols).eq("status", "paid").or(inWindow(prevFrom, prevTo)).limit(1000),
      rowsOf<PaymentRow>, [] as PaymentRow[]),
    attempt(problems, "sign-ups", () =>
      admin
        .from("officer_overview")
        .select("id, full_name, email, phone, created_at, plan_name, plan_is_trial, plan_active, plan_expires_on, credits")
        .eq("role", "officer")
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at", { ascending: false })
        .limit(500),
      rowsOf<OverviewRow>, [] as OverviewRow[]),
    attempt(problems, "yesterday's sign-ups", () =>
      admin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "officer")
        .gte("created_at", prevFrom)
        .lt("created_at", prevTo),
      countOf, 0),
    attempt(problems, "active plans", () =>
      admin
        .from("officer_overview")
        .select("id", { count: "exact", head: true })
        .eq("role", "officer")
        .eq("plan_active", true),
      countOf, 0),
    attempt(problems, "active trials", () =>
      admin
        .from("officer_overview")
        .select("id", { count: "exact", head: true })
        .eq("role", "officer")
        .eq("plan_active", true)
        .eq("plan_is_trial", true),
      countOf, 0),
    attempt(problems, "expiring plans", () =>
      admin
        .from("officer_overview")
        .select("id, full_name, email, phone, created_at, plan_name, plan_is_trial, plan_active, plan_expires_on, credits")
        .eq("role", "officer")
        .eq("plan_active", true)
        .gte("plan_expires_on", date)
        .lte("plan_expires_on", shiftDate(date, EXPIRY_WINDOW_DAYS))
        .order("plan_expires_on")
        .limit(200),
      rowsOf<OverviewRow>, [] as OverviewRow[]),
    attempt(problems, "active trucks", () =>
      admin.from("tracked_trucks").select("id", { count: "exact", head: true }).eq("is_active", true),
      countOf, 0),
    attempt(problems, "trucks", () =>
      admin.from("tracked_trucks").select("id", { count: "exact", head: true }),
      countOf, 0),
    attempt(problems, "automatic checks", searchCount("tracking", from, to), countOf, 0),
    attempt(problems, "failed automatic checks", searchCount("tracking", from, to, true), countOf, 0),
    attempt(problems, "manual searches", searchCount("manual", from, to), countOf, 0),
    attempt(problems, "failed manual searches", searchCount("manual", from, to, true), countOf, 0),
    attempt(problems, "yesterday's checks", searchCount("tracking", prevFrom, prevTo), countOf, 0),
    attempt(problems, "yesterday's searches", searchCount("manual", prevFrom, prevTo), countOf, 0),
    attempt(problems, "toll crossings", () =>
      admin
        .from("truck_events")
        .select("id", { count: "exact", head: true })
        .gte("fetched_at", from)
        .lt("fetched_at", to),
      countOf, 0),
    attempt(problems, "alerts delivered", () =>
      admin
        .from("alert_logs")
        .select("id", { count: "exact", head: true })
        .eq("delivered", true)
        .gte("created_at", from)
        .lt("created_at", to),
      countOf, 0),
    attempt(problems, "failed alerts", () =>
      admin
        .from("alert_logs")
        .select("delivery_error")
        .eq("delivered", false)
        .gte("created_at", from)
        .lt("created_at", to)
        .limit(1000),
      rowsOf<{ delivery_error: string | null }>, [] as { delivery_error: string | null }[]),
    loadPivotTotals(admin, {
      from: date,
      to: date,
      kind: "spend",
      /* Searches and checks only. The dashboard's "credits spent today" also
         counts an admin taking credits back, which is not usage. */
      reasons: Object.values(CREDIT_ACTIONS),
    }).catch((error: unknown) => {
      problems.push(`credits used: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }),
    attempt(problems, "failed checks", () =>
      admin
        .from("search_logs")
        .select("error, http_status")
        .eq("ok", false)
        .gte("created_at", from)
        .lt("created_at", to)
        .limit(1000),
      rowsOf<{ error: string | null; http_status: number | null }>,
      [] as { error: string | null; http_status: number | null }[]),
    attempt(problems, "paused trucks", () =>
      admin
        .from("tracked_trucks")
        .select("truck_number, paused_reason, user_id")
        .gte("paused_at", from)
        .lt("paused_at", to)
        .limit(200),
      rowsOf<{ truck_number: string; paused_reason: string | null; user_id: string }>,
      [] as { truck_number: string; paused_reason: string | null; user_id: string }[]),
    attempt(problems, "chat messages", () =>
      admin
        .from("chat_messages")
        .select("user_id")
        .eq("sender_role", "customer")
        .gte("created_at", from)
        .lt("created_at", to)
        .limit(1000),
      rowsOf<{ user_id: string }>, [] as { user_id: string }[]),
    attempt(problems, "unread chats", () =>
      admin
        .from("chat_messages")
        .select("user_id, body, created_at")
        .eq("sender_role", "customer")
        .is("read_at", null)
        .order("created_at", { ascending: false })
        .limit(1000),
      rowsOf<{ user_id: string; body: string; created_at: string }>,
      [] as { user_id: string; body: string; created_at: string }[]),
  ]);

  /* Who everyone is, in one read: buyers, people who tried to pay, chatters. */
  const ids = new Set<string>();
  for (const row of [...payments, ...prevPayments]) ids.add(row.user_id);
  for (const row of unreadRows) ids.add(row.user_id);
  for (const row of paused) ids.add(row.user_id);

  const people = new Map<string, Person>();
  if (ids.size > 0) {
    const found = await attempt(problems, "customers", () =>
      admin.from("profiles").select("id, full_name, email, phone, role").in("id", [...ids]),
      rowsOf<Person>, [] as Person[]);
    for (const person of found) people.set(person.id, person);
  }
  /* The dashboard counts customers' money only - an admin's own test purchase
     is not revenue. Unknown ids are kept: a missing profile read must not make
     money vanish from the mail. */
  const isCustomer = (userId: string) => (people.get(userId)?.role ?? "officer") === "officer";

  const paid = payments.filter((row) => isPaidIn(row, from, to) && isCustomer(row.user_id));
  const prevPaid = prevPayments.filter((row) => isPaidIn(row, prevFrom, prevTo) && isCustomer(row.user_id));

  const planIds = [...new Set(payments.map((row) => row.plan_id).filter((id): id is string => Boolean(id)))];
  const planNames = new Map<string, string>();
  if (planIds.length > 0) {
    const plans = await attempt(problems, "plans", () =>
      admin.from("plans").select("id, name").in("id", planIds),
      rowsOf<{ id: string; name: string }>, [] as { id: string; name: string }[]);
    for (const plan of plans) planNames.set(plan.id, plan.name);
  }

  /* Checkouts that did not end in money. A customer who failed and then paid
     is a rescue, not a lead - they are counted, not listed. */
  const paidUsers = new Set(payments.filter((row) => row.status === "paid").map((row) => row.user_id));
  const unfinished = payments.filter(
    (row) =>
      (row.status === "failed" || row.status === "created") &&
      row.created_at >= from &&
      row.created_at < to &&
      isCustomer(row.user_id),
  );
  const stuckBefore = new Date(until.getTime() - CHECKOUT_STUCK_MINUTES * 60_000).toISOString();

  const byUser = new Map<string, PaymentRow[]>();
  for (const row of unfinished) byUser.set(row.user_id, [...(byUser.get(row.user_id) ?? []), row]);

  const leads: Lead[] = [];
  let recovered = 0;
  for (const [userId, rows] of byUser) {
    if (paidUsers.has(userId)) {
      recovered += 1;
      continue;
    }
    const latest = rows[rows.length - 1];
    const state =
      latest.status === "failed" ? "failed" : latest.created_at >= stuckBefore ? "open" : "abandoned";
    leads.push({ userId, attempts: rows.length, latest, state });
  }
  leads.sort((a, b) => (a.latest.created_at < b.latest.created_at ? 1 : -1));

  const failed = unfinished.filter((row) => row.status === "failed");

  const unreadByUser = new Map<string, { userId: string; count: number; oldest: string; latestBody: string }>();
  for (const row of unreadRows) {
    const entry = unreadByUser.get(row.user_id);
    if (entry) {
      entry.count += 1;
      entry.oldest = row.created_at; // rows arrive newest first
    } else {
      unreadByUser.set(row.user_id, { userId: row.user_id, count: 1, oldest: row.created_at, latestBody: row.body });
    }
  }

  return {
    date,
    live,
    until,
    compareLabel,
    people,
    planNames,
    paid,
    prevRevenue: prevPaid.reduce((sum, row) => sum + Number(row.amount_inr || 0), 0),
    prevPlans: prevPaid.filter((row) => row.kind === "plan").length,
    prevTopups: prevPaid.filter((row) => row.kind !== "plan").length,
    leads,
    failedAttempts: failed.length,
    failureReasons: tally(failed.map((row) => errorKey(row.failure_reason))),
    recovered,
    stuckCheckouts: unfinished.filter((row) => row.status === "created" && row.created_at < stuckBefore).length,
    razorpayBlocked: failed.filter((row) => RAZORPAY_SITE_BLOCK.test(row.failure_reason ?? "")).length,
    signups,
    prevSignups,
    activePlans,
    activeTrials,
    expiring,
    trucksActive,
    trucksTotal,
    autoChecks,
    autoFailed,
    manualSearches,
    manualFailed,
    prevChecks: prevAuto + prevManual,
    crossings,
    alertsDelivered,
    alertsFailed: alertFailures.length,
    alertErrors: tally(alertFailures.map((row) => errorKey(row.delivery_error))),
    creditsUsed: Math.abs(Number(spend?.credits ?? 0)),
    creditAccounts: Number(spend?.accounts ?? 0),
    checkErrors: tally(
      failedChecks.map((row) => errorKey(row.error ?? (row.http_status ? `HTTP ${row.http_status}` : null))),
    ),
    pausedToday: paused.map((row) => ({
      truck: row.truck_number,
      reason: row.paused_reason ?? "paused",
      userId: row.user_id,
    })),
    chatsToday: chatsToday.length,
    chatCustomers: new Set(chatsToday.map((row) => row.user_id)).size,
    unread: [...unreadByUser.values()].sort((a, b) => (a.oldest < b.oldest ? -1 : 1)),
    problems,
  };
}

/* -------------------------------------------------------------------------- */
/* The mail                                                                    */
/* -------------------------------------------------------------------------- */

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const BRAND = "#1d4ed8";
const INK = "#1f2933";
const MUTED = "#5b6b7b";
const LINE = "#e3e8ef";
const BG = "#f4f6f9";
const GOOD = "#15803d";
const BAD = "#b91c1c";

type Tone = "bad" | "warn" | "info";
type Attention = { tone: Tone; html: string; text: string; url: string };

const link = (url: string, label: string, color = BRAND) =>
  `<a href="${esc(url)}" style="color:${color};text-decoration:none">${label}</a>`;

/** A phone the owner can ring from the mail. Blank when we hold none. */
function phoneLink(phone: string | null | undefined): string {
  if (!phone) return "";
  return `<a href="tel:${esc(phone.replace(/[^\d+]/g, ""))}" style="color:${BRAND};text-decoration:none;white-space:nowrap">${esc(phone)}</a>`;
}

/** "Mini", "Free trial", or "Starter (trial)" - never "Free trial (trial)". */
function planLabel(name: string | null, trial: boolean | null): string {
  const plan = name?.trim() || "Plan";
  return trial && !/trial/i.test(plan) ? `${plan} (trial)` : plan;
}

function who(day: Day, userId: string, fallback?: { full_name: string | null; email: string }): string {
  const person = day.people.get(userId) ?? fallback;
  return person?.full_name?.trim() || person?.email || "Unknown customer";
}

function whatBought(day: Day, row: PaymentRow): string {
  if (row.kind === "plan") {
    const plan = (row.plan_id && day.planNames.get(row.plan_id)) || "Plan";
    const topup = Number(row.topup_credits) || 0;
    return topup > 0 ? `${plan} + ${formatCredits(topup)} credits` : plan;
  }
  return `${formatCredits(Number(row.credits) || 0)} credits`;
}

function howPaid(row: PaymentRow): string {
  return row.method === "razorpay" ? "Online" : `Offline · ${methodLabel(row.method)}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${fmtNumber(n)} ${n === 1 ? one : many}`;
}

/** "▲ Rs 400 (40%) vs this time yesterday", coloured; flat and no-history read grey. */
function delta(
  current: number,
  previous: number,
  format: (n: number) => string,
  label: string,
): { html: string; text: string } {
  const diff = current - previous;
  if (diff === 0) {
    const text = `Same as ${label}`;
    return { html: `<span style="color:${MUTED}">${esc(text)}</span>`, text };
  }
  const up = diff > 0;
  const pct = previous > 0 ? ` (${up ? "+" : "−"}${Math.round(Math.abs(diff / previous) * 100)}%)` : "";
  const text = `${up ? "▲" : "▼"} ${format(Math.abs(diff))}${pct} vs ${label}`;
  return { html: `<span style="color:${up ? GOOD : BAD}">${esc(text)}</span>`, text };
}

function tile(label: string, value: string, hint: string, change: string): string {
  return `<div class="kpi" style="display:inline-block;width:100%;max-width:280px;vertical-align:top">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="padding:6px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:10px"><tr><td style="padding:14px 16px;text-align:left;font-family:${FONT}">
<div style="font-size:11px;line-height:16px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:${MUTED}">${esc(label)}</div>
<div style="font-size:24px;line-height:32px;font-weight:700;color:${INK};padding-top:2px">${esc(value)}</div>
<div style="font-size:13px;line-height:18px;color:${MUTED}">${esc(hint)}</div>
<div style="font-size:12px;line-height:18px;padding-top:6px">${change}</div>
</td></tr></table>
</td></tr></table>
</div>`;
}

/** Two tiles side by side on a wide screen, stacked on a phone - no media query needed. */
function tilePair(a: string, b: string): string {
  return `<tr><td align="center" style="padding:0 18px;font-size:0;text-align:center">
<!--[if mso]><table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"><tr><td width="280" valign="top"><![endif]-->
${a}
<!--[if mso]></td><td width="280" valign="top"><![endif]-->
${b}
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>`;
}

function section(title: string, body: string, more?: { label: string; url: string }): string {
  const action = more
    ? `<td align="right" style="font-family:${FONT};font-size:12px;line-height:16px;white-space:nowrap">${link(more.url, `${esc(more.label)} &rarr;`)}</td>`
    : "";
  return `<tr><td style="padding:22px 24px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};padding:0 2px 8px">${esc(title)}</td>${action}
</tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid ${LINE};border-radius:10px;border-collapse:separate">
${body}
</table>
</td></tr>`;
}

/** One line of a list: who on the left, the figure on the right. */
function row(
  first: boolean,
  left: string,
  sub: string,
  right = "",
  rightSub = "",
): string {
  const border = first ? "" : `border-top:1px solid ${LINE};`;
  return `<tr>
<td valign="top" style="${border}padding:11px 16px;font-family:${FONT};font-size:14px;line-height:20px;color:${INK}">${left}${
    sub ? `<div style="font-size:12px;line-height:17px;color:${MUTED};padding-top:1px">${sub}</div>` : ""
  }</td>
<td valign="top" align="right" style="${border}padding:11px 16px 11px 0;font-family:${FONT};font-size:14px;line-height:20px;color:${INK};text-align:right;white-space:nowrap">${right}${
    rightSub ? `<div style="font-size:12px;line-height:17px;color:${MUTED};padding-top:1px">${rightSub}</div>` : ""
  }</td>
</tr>`;
}

/** A label and its figure - the usage and health panels. */
function stat(first: boolean, label: string, value: string, note = ""): string {
  return row(first, `<span style="color:${MUTED}">${esc(label)}</span>`, "", `<strong>${esc(value)}</strong>`, note ? esc(note) : "");
}

function quiet(message: string): string {
  return `<tr><td colspan="2" style="padding:14px 16px;font-family:${FONT};font-size:14px;line-height:20px;color:${MUTED}">${esc(message)}</td></tr>`;
}

function moreRow(hidden: number, url: string): string {
  return `<tr><td colspan="2" style="border-top:1px solid ${LINE};padding:10px 16px;font-family:${FONT};font-size:13px;line-height:18px">${link(
    url,
    `and ${esc(plural(hidden, "more"))} &rarr;`,
  )}</td></tr>`;
}

function subheading(text: string, first: boolean): string {
  return `<tr><td colspan="2" style="${first ? "" : `border-top:1px solid ${LINE};`}padding:12px 16px 4px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:600;color:${INK}">${esc(text)}</td></tr>`;
}

function expiryWords(day: Day, expiresOn: string | null): string {
  if (!expiresOn) return "";
  const date = expiresOn.slice(0, 10);
  if (date === day.date) return "Ends today";
  if (date === shiftDate(day.date, 1)) return "Ends tomorrow";
  return `Ends ${shortDay(date)}`;
}

export async function buildDailySummary(
  admin: Admin,
  istDate: string,
): Promise<{ subject: string; html: string; text: string }> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(istDate) ? istDate : istToday();
  const [settings, day] = await Promise.all([loadSettings(admin), readDay(admin, date)]);

  const brand = settings.brandName || "Rahdari";
  const site = env.siteUrl;
  const sendHour = hourLabel(clampHour(settings.dailySummaryHour));
  /* "today" in a live mail; a past day (a re-run, a test) names its date. */
  const when = day.live ? "today" : `on ${shortDay(date)}`;

  const url = {
    finance: day.live
      ? `${site}/admin/finance?range=today`
      : `${site}/admin/finance?range=custom&from=${date}&to=${date}`,
    users: `${site}/admin/users`,
    chat: `${site}/admin/chat`,
    usage: `${site}/admin/usage`,
    trucks: `${site}/admin/trucks`,
    logs: `${site}/admin/logs`,
    alerts: `${site}/admin/alerts/log`,
    settings: `${site}/admin/settings?section=notify`,
    admin: `${site}/admin`,
  };

  /* ----- the headline figures ---------------------------------------------- */

  const revenue = day.paid.reduce((sum, p) => sum + Number(p.amount_inr || 0), 0);
  const plans = day.paid.filter((p) => p.kind === "plan").length;
  const topups = day.paid.length - plans;
  const checks = day.autoChecks + day.manualSearches;
  const label = day.compareLabel;

  const revenueDelta = delta(revenue, day.prevRevenue, fmtRupees, label);
  const signupDelta = delta(day.signups.length, day.prevSignups, fmtNumber, label);
  const purchaseDelta = delta(plans + topups, day.prevPlans + day.prevTopups, fmtNumber, label);
  const checksDelta = delta(checks, day.prevChecks, fmtNumber, label);

  const kpis = [
    {
      label: "Revenue",
      value: fmtRupees(revenue),
      hint: day.paid.length ? plural(day.paid.length, "payment") : day.live ? "No payments yet" : "No payments",
      change: revenueDelta,
    },
    {
      label: "New sign-ups",
      value: fmtNumber(day.signups.length),
      hint:
        day.signups.length === 0
          ? "Nobody new yet"
          : `${fmtNumber(day.signups.filter((s) => !s.plan_name).length)} without a plan`,
      change: signupDelta,
    },
    {
      label: "Plans & top-ups",
      value: fmtNumber(plans + topups),
      hint: `${plural(plans, "plan")} · ${plural(topups, "top-up")}`,
      change: purchaseDelta,
    },
    {
      label: "Truck checks",
      value: fmtNumber(checks),
      hint: `${formatCredits(day.creditsUsed)} credits used`,
      change: checksDelta,
    },
  ];

  /* ----- what to act on first ---------------------------------------------- */

  const attention: Attention[] = [];

  if (day.razorpayBlocked > 0) {
    const t = `Razorpay refused ${plural(day.razorpayBlocked, "payment")} because the website is not registered with it. Add ${site.replace(/^https?:\/\//, "")} in Razorpay → Settings → Website and app.`;
    attention.push({ tone: "bad", html: esc(t), text: t, url: url.finance });
  }
  const failedLeads = day.leads.filter((l) => l.state === "failed").length;
  const abandonedLeads = day.leads.filter((l) => l.state === "abandoned").length;
  if (failedLeads > 0) {
    const t = `${plural(failedLeads, "customer")} tried to pay and it failed — worth a call.`;
    attention.push({ tone: "bad", html: esc(t), text: t, url: url.finance });
  }
  if (abandonedLeads > 0) {
    const t = `${plural(abandonedLeads, "checkout")} opened and never paid (over ${CHECKOUT_STUCK_MINUTES} min).`;
    attention.push({ tone: "warn", html: esc(t), text: t, url: url.finance });
  }
  if (day.unread.length > 0) {
    const t = `${plural(day.unread.length, "conversation")} waiting for a reply, oldest ${fmtRelative(day.unread[0].oldest)}.`;
    attention.push({ tone: "warn", html: esc(t), text: t, url: url.chat });
  }
  if (day.expiring.length > 0) {
    const t = `${plural(day.expiring.length, "plan")} end${day.expiring.length === 1 ? "s" : ""} in the next ${EXPIRY_WINDOW_DAYS} days — renewal calls.`;
    attention.push({ tone: "info", html: esc(t), text: t, url: url.users });
  }
  const failedChecks = day.autoFailed + day.manualFailed;
  if (failedChecks >= 10 || (checks > 0 && failedChecks / checks >= 0.1 && failedChecks > 0)) {
    const t = `${plural(failedChecks, "truck check")} failed ${when} (${Math.round((failedChecks / Math.max(1, checks)) * 100)}%).`;
    attention.push({ tone: "warn", html: esc(t), text: t, url: url.logs });
  }
  if (day.alertsFailed > 0) {
    const t = `${plural(day.alertsFailed, "alert")} could not be delivered to the customer.`;
    attention.push({ tone: "warn", html: esc(t), text: t, url: url.alerts });
  }
  if (day.problems.length > 0) {
    const t = `Some figures could not be read (${day.problems.length}) — numbers below may be low.`;
    attention.push({ tone: "warn", html: esc(t), text: t, url: url.admin });
  }

  const dot: Record<Tone, string> = { bad: BAD, warn: "#b45309", info: BRAND };
  const attentionHtml =
    attention.length === 0
      ? ""
      : `<tr><td style="padding:20px 24px 0">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff8eb;border:1px solid #f3d19c;border-radius:10px;border-collapse:separate">
<tr><td style="padding:14px 16px 4px;font-family:${FONT};font-size:13px;line-height:18px;font-weight:700;color:#8a5a00">Needs attention</td></tr>
${attention
  .map(
    (item) => `<tr><td style="padding:4px 16px 8px;font-family:${FONT};font-size:14px;line-height:20px;color:${INK}">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td valign="top" style="padding:7px 10px 0 0"><div style="width:8px;height:8px;border-radius:4px;background:${dot[item.tone]};font-size:0;line-height:0">&nbsp;</div></td>
<td valign="top" style="font-family:${FONT};font-size:14px;line-height:20px;color:${INK}">${link(item.url, item.html, INK)}</td>
</tr></table>
</td></tr>`,
  )
  .join("")}
<tr><td style="padding:0 0 6px;font-size:0;line-height:0">&nbsp;</td></tr>
</table>
</td></tr>`;

  /* ----- money ----------------------------------------------------------- */

  let money = "";
  if (day.paid.length === 0) {
    money += quiet(`No payments ${when}.`);
  } else {
    money += day.paid
      .slice(0, LIST_CAP)
      .map((p, i) => {
        const discount = Number(p.discount_inr) || 0;
        return row(
          i === 0,
          link(accountUrl(p.user_id), esc(who(day, p.user_id))),
          esc(`${whatBought(day, p)} · ${howPaid(p)} · ${fmtTime(p.paid_at ?? p.created_at)}`),
          `<strong>${esc(fmtRupees(Number(p.amount_inr)))}</strong>`,
          discount > 0 ? esc(`${fmtRupees(discount)} off`) : "",
        );
      })
      .join("");
    if (day.paid.length > LIST_CAP) money += moreRow(day.paid.length - LIST_CAP, url.finance);
  }

  if (day.leads.length > 0) {
    money += subheading("Tried to pay, didn't finish — leads worth a call", false);
    money += day.leads
      .slice(0, LIST_CAP)
      .map((lead, i) => {
        const p = lead.latest;
        const person = day.people.get(lead.userId);
        const state =
          lead.state === "failed"
            ? `Failed: ${truncate(p.failure_reason?.trim() || "no reason given", 70)}`
            : lead.state === "open"
              ? "Checkout open right now"
              : "Opened checkout, never paid";
        const phone = phoneLink(person?.phone);
        return row(
          i === 0,
          link(accountUrl(lead.userId), esc(who(day, lead.userId))) + (phone ? ` <span style="font-size:13px">· ${phone}</span>` : ""),
          esc(`${whatBought(day, p)} · ${state}${lead.attempts > 1 ? ` · ${lead.attempts} tries` : ""}`),
          esc(fmtRupees(Number(p.amount_inr))),
          esc(fmtTime(p.created_at)),
        );
      })
      .join("");
    if (day.leads.length > LIST_CAP) money += moreRow(day.leads.length - LIST_CAP, url.finance);
  }

  if (day.failedAttempts > 0) {
    money += subheading(
      `${plural(day.failedAttempts, "failed attempt")}${day.recovered > 0 ? ` · ${plural(day.recovered, "customer")} retried and paid` : ""}`,
      false,
    );
    money += day.failureReasons
      .slice(0, 4)
      .map(([reason, n], i) => row(i === 0, `<span style="font-size:13px;color:${MUTED}">${esc(reason)}</span>`, "", esc(`× ${n}`)))
      .join("");
  }

  /* ----- customers ------------------------------------------------------- */

  let customers = "";
  customers += subheading(`New sign-ups (${fmtNumber(day.signups.length)})`, true);
  if (day.signups.length === 0) {
    customers += quiet(`Nobody new signed up ${when}.`);
  } else {
    customers += day.signups
      .slice(0, LIST_CAP)
      .map((s, i) => {
        const phone = phoneLink(s.phone);
        const standing = s.plan_name ? planLabel(s.plan_name, s.plan_is_trial) : "No plan yet";
        return row(
          i === 0,
          link(accountUrl(s.id), esc(s.full_name?.trim() || s.email)),
          [phone, esc(s.email)].filter(Boolean).join(" · "),
          `<span style="font-size:13px;color:${s.plan_name ? INK : MUTED}">${esc(standing)}</span>`,
          esc(fmtTime(s.created_at)),
        );
      })
      .join("");
    if (day.signups.length > LIST_CAP) customers += moreRow(day.signups.length - LIST_CAP, url.users);
  }

  customers += subheading(`Plans ending in the next ${EXPIRY_WINDOW_DAYS} days (${fmtNumber(day.expiring.length)})`, false);
  if (day.expiring.length === 0) {
    customers += quiet("No plans run out in the next few days.");
  } else {
    customers += day.expiring
      .slice(0, LIST_CAP)
      .map((e, i) => {
        const phone = phoneLink(e.phone);
        return row(
          i === 0,
          link(accountUrl(e.id), esc(e.full_name?.trim() || e.email)),
          [esc(planLabel(e.plan_name, e.plan_is_trial)), phone].filter(Boolean).join(" · "),
          `<strong style="font-size:13px">${esc(expiryWords(day, e.plan_expires_on))}</strong>`,
          esc(`${formatCredits(Number(e.credits) || 0)} credits left`),
        );
      })
      .join("");
    if (day.expiring.length > LIST_CAP) customers += moreRow(day.expiring.length - LIST_CAP, url.users);
  }
  customers += stat(
    false,
    "Active plans right now",
    fmtNumber(day.activePlans),
    day.activeTrials > 0 ? `${fmtNumber(day.activeTrials)} of them trials` : "",
  );

  /* ----- usage ----------------------------------------------------------- */

  const usage = [
    stat(true, "Trucks being tracked", fmtNumber(day.trucksActive), `${fmtNumber(day.trucksTotal)} added in all`),
    stat(false, "Automatic checks", fmtNumber(day.autoChecks), day.autoFailed ? `${fmtNumber(day.autoFailed)} failed` : ""),
    stat(false, "Manual searches", fmtNumber(day.manualSearches), day.manualFailed ? `${fmtNumber(day.manualFailed)} failed` : ""),
    stat(false, "Toll crossings recorded", fmtNumber(day.crossings)),
    stat(false, "Alerts delivered", fmtNumber(day.alertsDelivered), day.alertsFailed ? `${fmtNumber(day.alertsFailed)} failed` : ""),
    stat(
      false,
      "Credits used",
      formatCredits(day.creditsUsed),
      day.creditAccounts ? `by ${plural(day.creditAccounts, "account")}` : "",
    ),
  ].join("");

  /* ----- support --------------------------------------------------------- */

  let support = stat(
    true,
    `Customer messages ${when}`,
    fmtNumber(day.chatsToday),
    day.chatCustomers ? `from ${plural(day.chatCustomers, "customer")}` : "",
  );
  if (day.unread.length === 0) {
    support += row(false, `<span style="color:${MUTED}">Waiting for a reply</span>`, "", `<strong style="color:${GOOD}">None</strong>`);
  } else {
    support += subheading(`Waiting for a reply (${fmtNumber(day.unread.length)})`, false);
    support += day.unread
      .slice(0, LIST_CAP)
      .map((u, i) =>
        row(
          i === 0,
          link(accountUrl(u.userId), esc(who(day, u.userId))),
          `“${esc(truncate(u.latestBody.replace(/\s+/g, " ").trim(), 80))}”`,
          link(`${site}/admin/chat/${u.userId}`, "Reply &rarr;"),
          esc(`${plural(u.count, "unread")} · since ${fmtDayTime(u.oldest)}`),
        ),
      )
      .join("");
    if (day.unread.length > LIST_CAP) support += moreRow(day.unread.length - LIST_CAP, url.chat);
  }

  /* ----- health ---------------------------------------------------------- */

  let health = "";
  let first = true;
  const healthText: string[] = [];
  if (day.checkErrors.length > 0) {
    health += subheading(`Failed LDB calls (${fmtNumber(failedChecks)})`, first);
    first = false;
    health += day.checkErrors
      .slice(0, 4)
      .map(([reason, n], i) => row(i === 0, `<span style="font-size:13px;color:${MUTED}">${esc(reason)}</span>`, "", esc(`× ${n}`)))
      .join("");
    healthText.push(`Failed LDB calls: ${failedChecks}`, ...day.checkErrors.slice(0, 4).map(([r, n]) => `  ${n} × ${r}`));
  }
  if (day.alertErrors.length > 0) {
    health += subheading(`Alerts not delivered (${fmtNumber(day.alertsFailed)})`, first);
    first = false;
    health += day.alertErrors
      .slice(0, 4)
      .map(([reason, n], i) => row(i === 0, `<span style="font-size:13px;color:${MUTED}">${esc(reason)}</span>`, "", esc(`× ${n}`)))
      .join("");
    healthText.push(`Alerts not delivered: ${day.alertsFailed}`, ...day.alertErrors.slice(0, 4).map(([r, n]) => `  ${n} × ${r}`));
  }
  if (day.pausedToday.length > 0) {
    health += subheading(`Trucks paused ${when} (${fmtNumber(day.pausedToday.length)})`, first);
    first = false;
    health += day.pausedToday
      .slice(0, LIST_CAP)
      .map((p, i) =>
        row(i === 0, esc(p.truck), link(accountUrl(p.userId), esc(who(day, p.userId)), MUTED), `<span style="font-size:13px;color:${MUTED}">${esc(p.reason.replace(/_/g, " "))}</span>`),
      )
      .join("");
    if (day.pausedToday.length > LIST_CAP) health += moreRow(day.pausedToday.length - LIST_CAP, url.trucks);
    healthText.push(`Trucks paused ${when}: ${day.pausedToday.length}`);
  }
  if (day.problems.length > 0) {
    health += subheading("Figures this mail could not read", first);
    first = false;
    health += day.problems
      .slice(0, 6)
      .map((p, i) => row(i === 0, `<span style="font-size:13px;color:${BAD}">${esc(truncate(p, 140))}</span>`, ""))
      .join("");
    healthText.push("Figures this mail could not read:", ...day.problems.slice(0, 6).map((p) => `  ${p}`));
  }
  if (first) health = quiet(`Nothing failed ${when}.`);

  /* ----- put together ---------------------------------------------------- */

  const dayLong = longDay(date);
  const asOf = day.live ? `up to ${fmtTime(day.until)} IST` : "the whole day, IST";
  const subject =
    `${brand} daily · ${fmtRupees(revenue)} · ${plural(day.signups.length, "sign-up")} · ${shortDay(date)}` +
    (attention.length > 0 ? ` · ${attention.length} to act on` : "");
  const preheader = `${fmtRupees(revenue)} from ${plural(day.paid.length, "payment")}, ${plural(day.signups.length, "sign-up")}, ${plural(checks, "truck check")}.${
    attention.length ? ` ${attention.length} thing${attention.length === 1 ? "" : "s"} need${attention.length === 1 ? "s" : ""} attention.` : " Nothing needs attention."
  }`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(`${brand} daily summary — ${dayLong}`)}</title>
<style>
/* The one rule not inlined: on a phone the KPI tiles stack full width. A
   client that drops <style> still stacks them, just centred at 280px. */
@media only screen and (max-width:620px){.kpi{max-width:100%!important}}
</style>
</head>
<body style="margin:0;padding:0;background:${BG};-webkit-text-size-adjust:100%">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${esc(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BG}">
<tr><td align="center" style="padding:20px 10px">
<!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:${BG}">

<tr><td style="background:${BRAND};border-radius:12px 12px 0 0;padding:22px 24px 20px">
<div style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#c7d7fe">${esc(brand)}</div>
<div style="font-family:${FONT};font-size:22px;line-height:30px;font-weight:700;color:#ffffff;padding-top:4px">Daily summary</div>
<div style="font-family:${FONT};font-size:14px;line-height:20px;color:#dbe5ff">${esc(dayLong)} · ${esc(asOf)}</div>
</td></tr>

<tr><td style="background:#ffffff;border:1px solid ${LINE};border-top:0;border-radius:0 0 12px 12px;padding:0 0 24px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${attentionHtml}
<tr><td style="padding:18px 0 0;font-size:0;line-height:0">&nbsp;</td></tr>
${tilePair(tile(kpis[0].label, kpis[0].value, kpis[0].hint, kpis[0].change.html), tile(kpis[1].label, kpis[1].value, kpis[1].hint, kpis[1].change.html))}
${tilePair(tile(kpis[2].label, kpis[2].value, kpis[2].hint, kpis[2].change.html), tile(kpis[3].label, kpis[3].value, kpis[3].hint, kpis[3].change.html))}
${section("Money", money, { label: "Finance", url: url.finance })}
${section("Customers", customers, { label: "Users", url: url.users })}
${section("Usage", usage, { label: "Usage", url: url.usage })}
${section("Support", support, { label: "Chat", url: url.chat })}
${section("Health", health, { label: "Logs", url: url.logs })}
</table>
</td></tr>

<tr><td style="padding:18px 24px 8px;font-family:${FONT};font-size:12px;line-height:18px;color:${MUTED};text-align:center">
Sent at ${esc(sendHour)} IST to the Notify admin list. Change this in ${link(url.settings, "Admin → Settings → Notify admin")}.<br>
Figures match the ${link(url.admin, "admin console")}; customers only, times in IST.
</td></tr>

</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body></html>`;

  /* ----- plain text ------------------------------------------------------ */

  const t: string[] = [];
  const cap = <T>(items: T[], render: (item: T) => string, more: string) => {
    for (const item of items.slice(0, LIST_CAP)) t.push(render(item));
    if (items.length > LIST_CAP) t.push(`  ...and ${items.length - LIST_CAP} more: ${more}`);
  };

  t.push(`${brand} daily summary`, `${dayLong} · ${asOf}`, "");
  if (attention.length > 0) {
    t.push("NEEDS ATTENTION");
    for (const item of attention) t.push(`- ${item.text} ${item.url}`);
    t.push("");
  }
  t.push("HEADLINES");
  for (const k of kpis) t.push(`${k.label}: ${k.value} (${k.hint}) ${k.change.text}`);
  t.push("");

  t.push("MONEY");
  if (day.paid.length === 0) t.push(`No payments ${when}.`);
  cap(
    day.paid,
    (p) =>
      `- ${fmtRupees(Number(p.amount_inr))} · ${who(day, p.user_id)} · ${whatBought(day, p)} · ${howPaid(p)} · ${fmtTime(p.paid_at ?? p.created_at)}\n  ${accountUrl(p.user_id)}`,
    url.finance,
  );
  if (day.leads.length > 0) {
    t.push("", "Tried to pay, didn't finish:");
    cap(
      day.leads,
      (l) => {
        const phone = day.people.get(l.userId)?.phone;
        const state =
          l.state === "failed"
            ? `failed: ${l.latest.failure_reason?.trim() || "no reason given"}`
            : l.state === "open"
              ? "checkout open right now"
              : "opened checkout, never paid";
        return `- ${who(day, l.userId)}${phone ? ` (${phone})` : ""} · ${fmtRupees(Number(l.latest.amount_inr))} · ${whatBought(day, l.latest)} · ${state} · ${fmtTime(l.latest.created_at)}\n  ${accountUrl(l.userId)}`;
      },
      url.finance,
    );
  }
  if (day.failedAttempts > 0) {
    t.push(
      "",
      `Failed attempts: ${day.failedAttempts}${day.recovered > 0 ? ` (${day.recovered} customer${day.recovered === 1 ? "" : "s"} retried and paid)` : ""}`,
    );
    for (const [reason, n] of day.failureReasons.slice(0, 4)) t.push(`  ${n} × ${reason}`);
  }
  t.push("");

  t.push("CUSTOMERS", `New sign-ups: ${day.signups.length}`);
  if (day.signups.length === 0) t.push(`Nobody new signed up ${when}.`);
  cap(
    day.signups,
    (s) =>
      `- ${s.full_name?.trim() || s.email}${s.phone ? ` (${s.phone})` : ""} · ${s.email} · ${s.plan_name ? planLabel(s.plan_name, s.plan_is_trial) : "no plan yet"}\n  ${accountUrl(s.id)}`,
    url.users,
  );
  t.push("", `Plans ending in the next ${EXPIRY_WINDOW_DAYS} days: ${day.expiring.length}`);
  cap(
    day.expiring,
    (e) =>
      `- ${e.full_name?.trim() || e.email}${e.phone ? ` (${e.phone})` : ""} · ${planLabel(e.plan_name, e.plan_is_trial)} · ${expiryWords(day, e.plan_expires_on)} (${fmtDate(e.plan_expires_on)})\n  ${accountUrl(e.id)}`,
    url.users,
  );
  t.push(`Active plans right now: ${day.activePlans}${day.activeTrials ? ` (${day.activeTrials} trials)` : ""}`, "");

  t.push(
    "USAGE",
    `Trucks being tracked: ${day.trucksActive} (${day.trucksTotal} added in all)`,
    `Automatic checks: ${day.autoChecks}${day.autoFailed ? ` (${day.autoFailed} failed)` : ""}`,
    `Manual searches: ${day.manualSearches}${day.manualFailed ? ` (${day.manualFailed} failed)` : ""}`,
    `Toll crossings recorded: ${day.crossings}`,
    `Alerts delivered: ${day.alertsDelivered}${day.alertsFailed ? ` (${day.alertsFailed} failed)` : ""}`,
    `Credits used: ${formatCredits(day.creditsUsed)}${day.creditAccounts ? ` by ${day.creditAccounts} account${day.creditAccounts === 1 ? "" : "s"}` : ""}`,
    "",
  );

  t.push("SUPPORT", `Customer messages ${when}: ${day.chatsToday}${day.chatCustomers ? ` from ${day.chatCustomers} customer${day.chatCustomers === 1 ? "" : "s"}` : ""}`);
  if (day.unread.length === 0) t.push("Waiting for a reply: none");
  else {
    t.push(`Waiting for a reply: ${day.unread.length}`);
    cap(
      day.unread,
      (u) =>
        `- ${who(day, u.userId)} · ${u.count} unread since ${fmtDayTime(u.oldest)}: "${truncate(u.latestBody.replace(/\s+/g, " ").trim(), 80)}"\n  ${site}/admin/chat/${u.userId}`,
      url.chat,
    );
  }
  t.push("");

  t.push("HEALTH");
  if (healthText.length === 0) t.push(`Nothing failed ${when}.`);
  else t.push(...healthText);
  t.push(
    "",
    "--",
    `Sent at ${sendHour} IST to the Notify admin list. Change this in Admin → Settings → Notify admin:`,
    url.settings,
  );

  return { subject, html, text: t.join("\n") };
}
