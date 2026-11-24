import "server-only";

import { CREDIT_REASON_LABEL } from "@/lib/credits";
import { istDayEndIso, istDayOf, istDayStartIso } from "@/lib/history-range";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The customer's view of the credit ledger: what came in, what was used, and
 * where - with failed manual searches taken out.
 *
 * FAILED SEARCHES (owner, 20 Nov 2026). The owner wants hold/release
 * semantics: a credit is held when a search starts, consumed when it succeeds
 * and released when it fails. The database does not work that way yet - a
 * search is charged up front by spend_credits() ('manual_search', -cost) and a
 * failure is given back by runManualLookup() as a separate grant
 * ('search_refund', +cost, see src/lib/manual-search.ts and 0062). Until the
 * real hold exists (docs/CREDIT-HOLD-DESIGN.md) this module NETS EACH PAIR OUT
 * at read time:
 *
 *   - every 'search_refund' row is excluded from every list and total, so a
 *     refund is never shown as credits added;
 *   - the 'manual_search' charge it gave back is found (pairFailedSearches) and
 *     excluded too, so "used" counts successfully consumed credits only.
 *
 * Nothing is written. The ledger itself, the balance and every admin screen
 * are untouched; this is presentation only.
 *
 * WHY THE TOTALS STILL RECONCILE. A refund is written only after spend_credits
 * allowed the search, for exactly verdict.cost - the amount that charge took -
 * so  sum(charges) - sum(refunds) = sum(charges that were not refunded). The
 * totals use the left-hand side (exact, no pairing needed); the per-day and
 * per-truck rows use the right-hand side (pairing), and the two agree whenever
 * every refund pairs - which the code path guarantees. Any refund that cannot
 * be paired is still subtracted (from its own day) and reported, so the
 * figures can never drift from the balance silently.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

export const CHARGE_REASONS = ["auto_check", "manual_search"] as const;
export const REFUND_REASON = "search_refund";
/**
 * A WhatsApp message to the customer (0076). Usage, but not a check: counted
 * in the Credits page's "used" figures, not in Activity (which lists checks).
 */
export const WHATSAPP_REASON = "whatsapp_alert";
/** Every reason that is spending, or the reversal of spending. */
const NOT_ADDITIONS = "(auto_check,manual_search,search_refund,whatsapp_alert)";

/**
 * How far before its refund a failed search's charge can be. The refund is
 * written in the same request as the charge, after at most two portal calls
 * (15 s timeout each, one retry) - so seconds in practice. Ten minutes is a
 * generous bound that still cannot reach an unrelated search.
 */
export const PAIR_WINDOW_MS = 10 * 60_000;

/** Supabase's row cap per request. Larger reads are paged. */
const CHUNK = 1000;

type Fetched<T> = { rows: T[]; capped: boolean; error: string | null };

/** Reads a query in 1,000-row pages, up to `cap` rows. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
  cap: number,
): Promise<Fetched<T>> {
  const rows: T[] = [];
  for (let from = 0; from < cap; from += CHUNK) {
    const { data, error } = await build(from, Math.min(from + CHUNK, cap) - 1);
    if (error) return { rows, capped: false, error: error.message };
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < CHUNK) return { rows, capped: false, error: null };
  }
  return { rows, capped: true, error: null };
}

/* -------------------------------------------------------------------------- */
/* Pairing a failed search's refund with its charge                           */
/* -------------------------------------------------------------------------- */

export type ChargeRow = { id: number; created_at: string; delta: number; truck_number: string | null };
export type RefundRow = { id: number; created_at: string; delta: number; note: string | null };
export type SearchPair = { refund: RefundRow; charge: ChargeRow };

/**
 * The number a refund was for. grant_credits() has no truck column, so
 * refundSearch() writes it into the note: "Refund: search for GJ01AB1234
 * failed (...)". Null when the note is not in that shape.
 */
export function refundTruck(note: string | null): string | null {
  const match = /^Refund: search for (\S+) failed/.exec(note ?? "");
  return match ? match[1] : null;
}

const cents = (value: number) => Math.round(Math.abs(Number(value) || 0) * 100);

/**
 * Pairs every refund with the charge it gave back.
 *
 * A refund's charge is a 'manual_search' row that
 *   - is for the same number (from the refund's note),
 *   - took exactly the amount the refund returned,
 *   - was written BEFORE the refund (lower id: both are bigserial inserts and
 *     the charge's transaction commits before the refund's starts), and
 *   - no more than PAIR_WINDOW_MS earlier;
 * the latest such unpaired charge wins. Two overlapping searches for the same
 * number can only swap which of the two is marked failed - same number, same
 * amount, seconds apart - so every count and total is unaffected.
 */
export function pairFailedSearches(
  charges: ChargeRow[],
  refunds: RefundRow[],
): { pairs: SearchPair[]; unpaired: RefundRow[] } {
  const newestFirst = [...charges].sort((a, b) => b.id - a.id);
  const taken = new Set<number>();
  const pairs: SearchPair[] = [];
  const unpaired: RefundRow[] = [];

  for (const refund of [...refunds].sort((a, b) => a.id - b.id)) {
    const truck = refundTruck(refund.note);
    const at = Date.parse(refund.created_at);
    const amount = cents(refund.delta);
    const charge = newestFirst.find((row) => {
      if (taken.has(row.id) || row.id >= refund.id) return false;
      if (cents(row.delta) !== amount) return false;
      if (truck !== null && row.truck_number !== truck) return false;
      const gap = at - Date.parse(row.created_at);
      return gap >= 0 && gap <= PAIR_WINDOW_MS;
    });
    if (charge) {
      taken.add(charge.id);
      pairs.push({ refund, charge });
    } else {
      unpaired.push(refund);
    }
  }
  return { pairs, unpaired };
}

export type FailedSearches = {
  pairs: SearchPair[];
  unpaired: RefundRow[];
  /** Ids of the charges that were refunded - exclude these. */
  chargeIds: Set<number>;
  error: string | null;
};

/**
 * Every failed-search pair whose REFUND falls in [fromIso, toIso + window).
 * Omit a bound for "from the beginning" / "until now". Two small reads: the
 * refunds (about one search in seven fails), then only the charges for those
 * numbers in the minutes before them.
 */
export async function loadFailedSearches(
  admin: Admin,
  userId: string,
  window: { fromIso?: string | null; toIso?: string | null } = {},
): Promise<FailedSearches> {
  const empty: FailedSearches = { pairs: [], unpaired: [], chargeIds: new Set(), error: null };

  const refunds = await fetchAll<RefundRow>((from, to) => {
    let query = admin
      .from("credit_transactions")
      .select("id,created_at,delta,note")
      .eq("user_id", userId)
      .eq("reason", REFUND_REASON);
    if (window.fromIso) query = query.gte("created_at", window.fromIso);
    if (window.toIso) {
      query = query.lt("created_at", new Date(Date.parse(window.toIso) + PAIR_WINDOW_MS).toISOString());
    }
    return query.order("id").range(from, to);
  }, 20_000);
  if (refunds.error) return { ...empty, error: refunds.error };
  if (refunds.rows.length === 0) return empty;

  const times = refunds.rows.map((row) => Date.parse(row.created_at));
  const earliest = new Date(Math.min(...times) - PAIR_WINDOW_MS).toISOString();
  const latest = new Date(Math.max(...times) + 1000).toISOString();
  const trucks = [...new Set(refunds.rows.map((row) => refundTruck(row.note)))];
  const byTruck = !trucks.includes(null) && trucks.length <= 100;

  const charges = await fetchAll<ChargeRow>((from, to) => {
    let query = admin
      .from("credit_transactions")
      .select("id,created_at,delta,truck_number")
      .eq("user_id", userId)
      .eq("reason", "manual_search")
      .gte("created_at", earliest)
      .lte("created_at", latest);
    if (byTruck) query = query.in("truck_number", trucks as string[]);
    return query.order("id").range(from, to);
  }, 100_000);
  if (charges.error) return { ...empty, error: charges.error };

  const { pairs, unpaired } = pairFailedSearches(charges.rows, refunds.rows);
  return { pairs, unpaired, chargeIds: new Set(pairs.map((pair) => pair.charge.id)), error: null };
}

/* -------------------------------------------------------------------------- */
/* Credits added: one entry per ledger row, with its source named             */
/* -------------------------------------------------------------------------- */

type AdditionRow = {
  id: number;
  created_at: string;
  delta: number;
  reason: string;
  note: string | null;
  actor_id: string | null;
  payment_id: string | null;
  payment: {
    razorpay_order_id: string;
    kind: string;
    plan: { name: string } | null;
    pack: { name: string } | null;
  } | null;
};

export type Addition = {
  id: number;
  at: string;
  credits: number;
  /** "Payment", "Coupon code", "Referral reward"... */
  source: string;
  /** What it was for: "Gold plan", "Credit top-up", a note from our team. */
  detail: string | null;
  /** The thing to quote: an order id or a code. */
  reference: string | null;
  referenceLabel: string | null;
  /** Payment order id, for a link to its receipt. */
  orderId: string | null;
};

function orderFromNote(note: string | null): string | null {
  return /order (\S+)/.exec(note ?? "")?.[1]?.replace(/[.,)]$/, "") ?? null;
}

/** Names the source of one addition, from the ledger row alone. */
export function describeAddition(row: AdditionRow): Addition {
  const credits = Number(row.delta) || 0;
  const order = row.payment?.razorpay_order_id ?? orderFromNote(row.note);
  const base = { id: row.id, at: row.created_at, credits, orderId: null as string | null };
  const ref = (value: string | null, label: string) => ({ reference: value, referenceLabel: value ? label : null });
  const note = row.note?.trim() || null;

  switch (row.reason) {
    case "purchase":
      if (row.payment || order) {
        const withPlan = row.payment?.kind === "plan" || /with the plan/i.test(row.note ?? "");
        return {
          ...base,
          orderId: order,
          source: "Payment",
          detail: withPlan ? "Top-up with plan" : row.payment?.pack?.name ?? "Credit top-up",
          ...ref(order, "Order"),
        };
      }
      return { ...base, source: "Payment", detail: row.actor_id ? "Recorded by our team" : "Credit top-up", ...ref(note, "Note") };
    case "plan_grant":
      if (row.payment) {
        return {
          ...base,
          orderId: order,
          source: "Payment",
          detail: `${row.payment.plan?.name ?? "Plan"} plan credits`,
          ...ref(order, "Order"),
        };
      }
      if (row.actor_id) return { ...base, source: "Admin added", detail: "Plan credits", ...ref(null, "") };
      return { ...base, orderId: order, source: "Plan credits", detail: null, ...ref(order, "Order") };
    case "admin_topup":
      return { ...base, source: "Admin added", detail: note, ...ref(null, "") };
    case "admin_adjust":
      /* 0050 cleared unused trial credits with a system (actor-less) negative
         adjustment; name it for what it was. */
      if (!row.actor_id && /trial ended/i.test(note ?? "")) {
        return { ...base, source: "Trial credits expired", detail: null, ...ref(null, "") };
      }
      return {
        ...base,
        source: credits < 0 ? "Admin correction" : row.actor_id ? "Admin added" : "Balance adjustment",
        detail: note,
        ...ref(null, ""),
      };
    case "coupon_bonus": {
      const code = note?.replace(/^Coupon\s+/i, "") ?? null;
      return { ...base, source: "Coupon code", detail: null, ...ref(code, "Code") };
    }
    case "referral":
    case "referral_milestone":
      return { ...base, source: "Referral reward", detail: row.reason === "referral_milestone" ? "Milestone bonus" : null, ...ref(null, "") };
    case "referral_welcome":
      return { ...base, source: "Referral welcome bonus", detail: null, ...ref(null, "") };
    case "signup_bonus":
      return { ...base, source: "Sign-up bonus", detail: null, ...ref(null, "") };
    case "trial_grant":
      return { ...base, source: "Trial credits", detail: null, ...ref(null, "") };
    default:
      return { ...base, source: CREDIT_REASON_LABEL[row.reason] ?? "Other", detail: note, ...ref(null, "") };
  }
}

const ADDITION_SELECT =
  "id,created_at,delta,reason,note,actor_id,payment_id,payment:payments(razorpay_order_id,kind,plan:plans(name),pack:credit_packs(name))";

/** An inclusive IST day window; a null bound is open (all time). */
export type DayWindow = { from: string | null; to: string | null };

/** One page of additions in a window, newest first. Refunds and spending never appear. */
export async function loadAdditions(
  admin: Admin,
  userId: string,
  page: number,
  pageSize: number,
  window: DayWindow = { from: null, to: null },
): Promise<{ rows: Addition[]; total: number; error: string | null }> {
  const fromIso = window.from ? istDayStartIso(window.from) : null;
  const toIso = window.to ? istDayEndIso(window.to) : null;
  const start = (page - 1) * pageSize;
  let query = admin
    .from("credit_transactions")
    .select(ADDITION_SELECT, { count: "exact" })
    .eq("user_id", userId)
    .not("reason", "in", NOT_ADDITIONS);
  if (fromIso) query = query.gte("created_at", fromIso);
  if (toIso) query = query.lt("created_at", toIso);
  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + pageSize - 1);
  if (error) {
    /* PostgREST refuses a range past the end; land on the last page instead. */
    if (page > 1) {
      let head = admin
        .from("credit_transactions")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .not("reason", "in", NOT_ADDITIONS);
      if (fromIso) head = head.gte("created_at", fromIso);
      if (toIso) head = head.lt("created_at", toIso);
      const { count: all } = await head;
      const last = Math.max(1, Math.ceil((all ?? 0) / pageSize));
      if (last < page) return loadAdditions(admin, userId, last, pageSize, window);
    }
    return { rows: [], total: 0, error: error.message };
  }
  return {
    rows: ((data ?? []) as unknown as AdditionRow[]).map(describeAddition),
    total: count ?? 0,
    error: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Totals and credits used per day                                            */
/* -------------------------------------------------------------------------- */

type DailyRow = {
  ist_date: string;
  reason: string;
  truck_number: string | null;
  entries: number;
  credits: number;
  first_at?: string;
  last_at?: string;
};

export type UsageDay = {
  day: string;
  credits: number;
  autoChecks: number;
  autoCredits: number;
  manualSearches: number;
  manualCredits: number;
  whatsappAlerts: number;
  whatsappCredits: number;
};

export type CreditStatement = {
  /** Every addition, net of administrator corrections. Refunds excluded. */
  added: number;
  additionsCount: number;
  /** Successfully consumed credits: charges minus failed-search refunds. */
  used: number;
  usedAuto: number;
  usedManual: number;
  usedWhatsApp: number;
  /** balance - (added - used). Zero when the ledger reconciles. */
  unexplained: number;
  /** The same figures inside the chosen date window (all time = the above). */
  period: { added: number; additions: number; used: number; days: number };
  /** One page of usage days in the window, newest first. */
  days: UsageDay[];
  totalDays: number;
  /** Refunds that could not be matched to a charge (should be none). */
  unpairedRefunds: number;
  capped: boolean;
  error: string | null;
};

/**
 * The Credits page: totals over all time, the same figures for the chosen
 * date window, and one page of usage days inside that window.
 *
 * Totals are read from credit_ledger_daily (the database sums the rows) and
 * the addition amounts; a day's usage nets out the failed searches of that day
 * by pairing.
 */
export async function loadCreditStatement(
  admin: Admin,
  userId: string,
  balance: number,
  usagePage: number,
  daysPerPage: number,
  window: DayWindow = { from: null, to: null },
): Promise<CreditStatement> {
  const inWindow = (day: string) => (!window.from || day >= window.from) && (!window.to || day <= window.to);
  const [additions, daily] = await Promise.all([
    fetchAll<{ delta: number; created_at: string }>(
      (from, to) =>
        admin
          .from("credit_transactions")
          .select("delta,created_at")
          .eq("user_id", userId)
          .not("reason", "in", NOT_ADDITIONS)
          .order("id")
          .range(from, to),
      50_000,
    ),
    fetchAll<DailyRow>(
      (from, to) =>
        admin
          .from("credit_ledger_daily")
          .select("ist_date,reason,truck_number,entries,credits")
          .eq("user_id", userId)
          .in("reason", [...CHARGE_REASONS, REFUND_REASON, WHATSAPP_REASON])
          .order("ist_date", { ascending: false })
          .order("reason")
          .order("truck_number")
          .range(from, to),
      60_000,
    ),
  ]);

  const added = additions.rows.reduce((sum, row) => sum + (Number(row.delta) || 0), 0);
  const periodAdditions = additions.rows.filter((row) => inWindow(istDayOf(row.created_at)));
  const periodAdded = periodAdditions.reduce((sum, row) => sum + (Number(row.delta) || 0), 0);

  type Acc = { autoN: number; autoC: number; manN: number; manC: number; refN: number; refC: number; waN: number; waC: number };
  const byDay = new Map<string, Acc>();
  for (const row of daily.rows) {
    const acc = byDay.get(row.ist_date) ?? { autoN: 0, autoC: 0, manN: 0, manC: 0, refN: 0, refC: 0, waN: 0, waC: 0 };
    const credits = Math.abs(Number(row.credits) || 0);
    const n = Number(row.entries) || 0;
    if (row.reason === "auto_check") {
      acc.autoN += n;
      acc.autoC += credits;
    } else if (row.reason === "manual_search") {
      acc.manN += n;
      acc.manC += credits;
    } else if (row.reason === WHATSAPP_REASON) {
      acc.waN += n;
      acc.waC += credits;
    } else {
      acc.refN += n;
      acc.refC += credits;
    }
    byDay.set(row.ist_date, acc);
  }

  let usedAuto = 0;
  let usedManual = 0;
  let usedWhatsApp = 0;
  let periodUsed = 0;
  for (const [day, acc] of byDay) {
    usedAuto += acc.autoC;
    usedManual += acc.manC - acc.refC;
    usedWhatsApp += acc.waC;
    if (inWindow(day)) periodUsed += acc.autoC + acc.manC - acc.refC + acc.waC;
  }
  const used = usedAuto + usedManual + usedWhatsApp;

  /* Days with real use, in the window. A day whose only charges were refunded
     searches nets to nothing and is not a day of usage. */
  const allDays = [...byDay.entries()]
    .filter(([day]) => inWindow(day))
    .filter(([, acc]) => acc.autoN > 0 || acc.waN > 0 || round2(acc.manC - acc.refC) > 0 || acc.manN - acc.refN > 0)
    .map(([day]) => day)
    .sort((a, b) => (a < b ? 1 : -1));

  const lastPage = Math.max(1, Math.ceil(allDays.length / daysPerPage));
  const onPage = Math.min(Math.max(1, usagePage), lastPage);
  const pageDays = allDays.slice((onPage - 1) * daysPerPage, onPage * daysPerPage);
  let days: UsageDay[] = [];
  let unpairedRefunds = 0;
  let pairError: string | null = null;

  if (pageDays.length > 0) {
    const newest = pageDays[0];
    const oldest = pageDays[pageDays.length - 1];
    const failed = await loadFailedSearches(admin, userId, {
      fromIso: istDayStartIso(oldest),
      toIso: istDayEndIso(newest),
    });
    pairError = failed.error;
    unpairedRefunds = failed.unpaired.length;

    const minus = new Map<string, { n: number; c: number }>();
    const take = (day: string, n: number, c: number) => {
      const cur = minus.get(day) ?? { n: 0, c: 0 };
      minus.set(day, { n: cur.n + n, c: cur.c + c });
    };
    for (const pair of failed.pairs) take(istDayOf(pair.charge.created_at), 1, Math.abs(Number(pair.charge.delta)));
    for (const refund of failed.unpaired) take(istDayOf(refund.created_at), 0, Math.abs(Number(refund.delta)));

    days = pageDays
      .map((day) => {
        const acc = byDay.get(day)!;
        const off = minus.get(day) ?? { n: 0, c: 0 };
        const manualSearches = Math.max(acc.manN - off.n, 0);
        const manualCredits = Math.max(round2(acc.manC - off.c), 0);
        return {
          day,
          autoChecks: acc.autoN,
          autoCredits: round2(acc.autoC),
          manualSearches,
          manualCredits,
          whatsappAlerts: acc.waN,
          whatsappCredits: round2(acc.waC),
          credits: round2(acc.autoC + manualCredits + acc.waC),
        };
      })
      .filter((day) => day.autoChecks > 0 || day.manualSearches > 0 || day.whatsappAlerts > 0 || day.credits > 0);
  }

  return {
    added: round2(added),
    additionsCount: additions.rows.length,
    used: round2(used),
    usedAuto: round2(usedAuto),
    usedManual: round2(usedManual),
    usedWhatsApp: round2(usedWhatsApp),
    unexplained: round2(balance - (added - used)),
    period: {
      added: round2(periodAdded),
      additions: periodAdditions.length,
      used: round2(periodUsed),
      days: allDays.length,
    },
    days,
    totalDays: allDays.length,
    unpairedRefunds,
    capped: additions.capped || daily.capped,
    error: additions.error ?? daily.error ?? pairError,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* -------------------------------------------------------------------------- */
/* Activity: checks per day per truck                                          */
/* -------------------------------------------------------------------------- */

/** The pseudo-truck that holds searches of numbers you do not track. */
export const SEARCHES_KEY = "searches";

export type ActivityMode = "all" | "auto" | "manual";

export type Cell = {
  day: string;
  /** A truck number, or SEARCHES_KEY. */
  key: string;
  auto: number;
  manual: number;
  credits: number;
  crossings: number;
  /** For the searches group: successful searches per number searched. */
  numbers: Map<string, number>;
  firstAt: string | null;
  lastAt: string | null;
};

export type ActivityData = {
  cells: Cell[];
  /** Tracked (or formerly tracked) trucks, with their labels. */
  trucks: { number: string; label: string | null }[];
  capped: boolean;
  error: string | null;
};

type SearchLogRow = { truck_number: string; created_at: string; new_events: number; source: string };

/**
 * Everything the Activity page sums, for one IST date window (a null bound is
 * open: "All" is the whole history), already netted
 * of failed searches. Server-side work: credit_ledger_daily sums the charges
 * per day per truck in the database; search_logs supplies crossings found
 * (rows exist only for checks that found something new).
 */
export async function loadActivity(
  admin: Admin,
  userId: string,
  filter: { from: string | null; to: string | null; mode: ActivityMode; truck: string | null },
): Promise<ActivityData> {
  const fromIso = filter.from ? istDayStartIso(filter.from) : null;
  const toIso = filter.to ? istDayEndIso(filter.to) : null;

  const [tracked, removed, ledger, logs, failed] = await Promise.all([
    admin.from("tracked_trucks").select("truck_number,label").eq("user_id", userId).order("truck_number"),
    /* Trucks deleted from My trucks keep their history under their number
       (0072). Fails quietly until 0072 is applied. */
    admin.from("truck_activity").select("truck_number").eq("user_id", userId).eq("kind", "deleted").limit(500),
    fetchAll<DailyRow>((from, to) => {
      let query = admin
        .from("credit_ledger_daily")
        .select("ist_date,reason,truck_number,entries,credits,first_at,last_at")
        .eq("user_id", userId)
        .in("reason", CHARGE_REASONS as unknown as string[]);
      if (filter.from) query = query.gte("ist_date", filter.from);
      if (filter.to) query = query.lte("ist_date", filter.to);
      return query.order("ist_date", { ascending: false }).order("reason").order("truck_number").range(from, to);
    }, 30_000),
    fetchAll<SearchLogRow>((from, to) => {
      let query = admin
        .from("search_logs")
        .select("truck_number,created_at,new_events,source")
        .eq("user_id", userId)
        .eq("ok", true)
        .gt("new_events", 0);
      if (fromIso) query = query.gte("created_at", fromIso);
      if (toIso) query = query.lt("created_at", toIso);
      return query.order("id").range(from, to);
    }, 30_000),
    loadFailedSearches(admin, userId, { fromIso, toIso }),
  ]);

  const trackedRows = (tracked.data ?? []) as { truck_number: string; label: string | null }[];
  const truckSet = new Set<string>(trackedRows.map((row) => row.truck_number));
  for (const row of (removed.data ?? []) as { truck_number: string }[]) truckSet.add(row.truck_number);
  for (const row of ledger.rows) if (row.reason === "auto_check" && row.truck_number) truckSet.add(row.truck_number);

  const keyOf = (number: string | null) => (number && truckSet.has(number) ? number : SEARCHES_KEY);
  const wantAuto = filter.mode !== "manual";
  const wantManual = filter.mode !== "auto";
  const wantKey = (key: string) => !filter.truck || filter.truck === key;

  const cells = new Map<string, Cell>();
  const cell = (day: string, key: string): Cell => {
    const id = `${day}|${key}`;
    let found = cells.get(id);
    if (!found) {
      found = { day, key, auto: 0, manual: 0, credits: 0, crossings: 0, numbers: new Map(), firstAt: null, lastAt: null };
      cells.set(id, found);
    }
    return found;
  };
  const stamp = (target: Cell, first?: string, last?: string) => {
    if (first && (!target.firstAt || first < target.firstAt)) target.firstAt = first;
    if (last && (!target.lastAt || last > target.lastAt)) target.lastAt = last;
  };

  for (const row of ledger.rows) {
    const isAuto = row.reason === "auto_check";
    if (isAuto ? !wantAuto : !wantManual) continue;
    const key = keyOf(row.truck_number);
    if (!wantKey(key)) continue;
    const target = cell(row.ist_date, key);
    if (isAuto) target.auto += Number(row.entries) || 0;
    else target.manual += Number(row.entries) || 0;
    target.credits += Math.abs(Number(row.credits) || 0);
    if (key === SEARCHES_KEY && row.truck_number && !isAuto) {
      target.numbers.set(row.truck_number, (target.numbers.get(row.truck_number) ?? 0) + (Number(row.entries) || 0));
    }
    stamp(target, row.first_at, row.last_at);
  }

  /* Failed searches out: the charge's day, number and amount. */
  if (wantManual) {
    for (const { charge } of failed.pairs) {
      const day = istDayOf(charge.created_at);
      if ((filter.from && day < filter.from) || (filter.to && day > filter.to)) continue;
      const key = keyOf(charge.truck_number);
      if (!wantKey(key)) continue;
      const target = cells.get(`${day}|${key}`);
      if (!target) continue;
      target.manual = Math.max(target.manual - 1, 0);
      target.credits = Math.max(round2(target.credits - Math.abs(Number(charge.delta))), 0);
      if (key === SEARCHES_KEY && charge.truck_number) {
        const left = (target.numbers.get(charge.truck_number) ?? 0) - 1;
        if (left > 0) target.numbers.set(charge.truck_number, left);
        else target.numbers.delete(charge.truck_number);
      }
    }
    for (const refund of failed.unpaired) {
      const day = istDayOf(refund.created_at);
      const target = cells.get(`${day}|${keyOf(refundTruck(refund.note))}`);
      if (target) target.credits = Math.max(round2(target.credits - Math.abs(Number(refund.delta))), 0);
    }
  }

  for (const log of logs.rows) {
    const isAuto = log.source === "tracking";
    if (isAuto ? !wantAuto : !wantManual) continue;
    const key = keyOf(log.truck_number);
    if (!wantKey(key)) continue;
    const target = cell(istDayOf(log.created_at), key);
    target.crossings += Number(log.new_events) || 0;
    if (key === SEARCHES_KEY && !target.numbers.has(log.truck_number)) target.numbers.set(log.truck_number, 1);
  }

  const out = [...cells.values()].filter((c) => c.auto > 0 || c.manual > 0 || c.crossings > 0);
  for (const c of out) c.credits = round2(c.credits);

  const labels = new Map(trackedRows.map((row) => [row.truck_number, row.label]));
  const trucks = [...truckSet]
    .sort()
    .map((number) => ({ number, label: labels.get(number) ?? null }));

  return {
    cells: out,
    trucks,
    capped: ledger.capped || logs.capped,
    error: ledger.error ?? logs.error ?? failed.error,
  };
}

/* -------------------------------------------------------------------------- */
/* Activity: individual entries (one check or search, or a truck event)        */
/* -------------------------------------------------------------------------- */

export type EntrySort = "newest" | "oldest" | "most" | "fewest";

export type ActivityEntry = {
  key: string;
  at: string;
  kind: "check" | "event";
  /** The truck number (or number searched); null for an event without one. */
  truck: string | null;
  /** Auto check, manual check of a tracked truck, or search of another number. */
  check: "auto" | "manual" | "search" | null;
  credits: number;
  /** Crossings the check returned / of which new; null when not known. */
  found: number | null;
  fresh: number | null;
  /** Events only: what happened. */
  title: string | null;
  sub: string | null;
  tone: "good" | "warn" | "bad" | "brand" | "neutral";
  code: string | null;
};

export type EntryScope = {
  /** Inclusive IST days; null = open. */
  from: string | null;
  to: string | null;
  /** A truck number, SEARCHES_KEY, or null for everything. */
  key: string | null;
  mode: ActivityMode;
  /** ActivityData.trucks: numbers that are trucks, not searches. */
  tracked: Set<string>;
};

export type EntryPage = {
  rows: ActivityEntry[];
  total: number;
  /** The page actually served (clamped to the last one). */
  page: number;
  /** Truck events are merged in only when sorted by time. */
  withEvents: boolean;
  error: string | null;
};

/** Most truck events merged into one list (they are a few a day per truck). */
const EVENT_CAP = 1000;

const quoteList = (values: string[]) => `(${values.map((v) => `"${v.replace(/["\\]/g, "")}"`).join(",")})`;

/**
 * One page of individual entries in a scope - the leaves of the Activity
 * page, whatever the grouping.
 *
 *   Checks    one ledger charge each (auto_check / manual_search), failed
 *             searches EXCLUDED by id (pairFailedSearches), paged and sorted
 *             by the database. Crossings found come from the check's own
 *             search_logs row (written only when an auto check found news,
 *             always for a successful search).
 *   Events    truck_activity rows (added, paused, alert changed...). Merged in
 *             time order only - they cost nothing, so a credits sort lists
 *             checks alone. A "Check now" event is the manual check's charge
 *             row already, so it is not listed twice.
 *
 * Merging two sorted sources under one pager without reading everything: all
 * events in scope are read (a few per truck per day, capped), then only the
 * window of checks that can land on this page - offset max(0, start - E) for
 * at most E + pageSize rows. Every check's rank is exact (all events are
 * known); an event that sorts before that window ranks below `start` and an
 * event after a full window ranks past the page, so neither is shown.
 */
export async function loadActivityEntries(
  admin: Admin,
  userId: string,
  scope: EntryScope,
  sort: EntrySort,
  page: number,
  pageSize: number,
): Promise<EntryPage> {
  const fromIso = scope.from ? istDayStartIso(scope.from) : null;
  const toIso = scope.to ? istDayEndIso(scope.to) : null;
  const isSearches = scope.key === SEARCHES_KEY;
  const reasons = (["auto_check", "manual_search"] as const).filter((reason) =>
    reason === "auto_check" ? scope.mode !== "manual" && !isSearches : scope.mode !== "auto",
  );
  const byTime = sort === "newest" || sort === "oldest";
  const ascending = sort === "oldest";
  const withEvents = byTime && !isSearches;
  const empty: EntryPage = { rows: [], total: 0, page: 1, withEvents, error: null };

  const tracked = [...scope.tracked];
  const inScope = (truck: string | null) =>
    scope.key === null ? true : isSearches ? !(truck && scope.tracked.has(truck)) : truck === scope.key;

  /* Failed searches: their charges never appear. */
  let excluded: number[] = [];
  let pairError: string | null = null;
  if (reasons.includes("manual_search")) {
    const failed = await loadFailedSearches(admin, userId, { fromIso, toIso });
    pairError = failed.error;
    excluded = failed.pairs
      .map((pair) => pair.charge)
      .filter((charge) => !fromIso || Date.parse(charge.created_at) >= Date.parse(fromIso))
      .filter((charge) => !toIso || Date.parse(charge.created_at) < Date.parse(toIso))
      .filter((charge) => inScope(charge.truck_number))
      .map((charge) => charge.id);
  }

  const checks = (select: string, head = false) => {
    let query = admin
      .from("credit_transactions")
      .select(select, { count: "exact", head })
      .eq("user_id", userId)
      .in("reason", reasons as unknown as string[]);
    if (fromIso) query = query.gte("created_at", fromIso);
    if (toIso) query = query.lt("created_at", toIso);
    if (isSearches) {
      if (tracked.length > 0) query = query.or(`truck_number.is.null,truck_number.not.in.${quoteList(tracked)}`);
    } else if (scope.key) {
      query = query.eq("truck_number", scope.key);
    }
    if (excluded.length > 0) query = query.not("id", "in", `(${excluded.join(",")})`);
    return query;
  };

  const eventsQuery = async (): Promise<{ id: number; kind: string; detail: Record<string, unknown> | null; created_at: string; truck_number: string }[]> => {
    if (!withEvents) return [];
    let query = admin
      .from("truck_activity")
      .select("id,kind,detail,created_at,truck_number")
      .eq("user_id", userId)
      .neq("kind", "manual_check");
    if (fromIso) query = query.gte("created_at", fromIso);
    if (toIso) query = query.lt("created_at", toIso);
    if (scope.key) query = query.eq("truck_number", scope.key);
    const { data, error } = await query
      .order("created_at", { ascending })
      .order("id", { ascending })
      .limit(EVENT_CAP);
    /* truck_activity arrived in 0068; a missing table just means no events. */
    return error ? [] : ((data ?? []) as never[]);
  };

  const [counted, eventRows] = await Promise.all([
    reasons.length > 0 ? checks("id", true) : Promise.resolve({ count: 0, error: null }),
    eventsQuery(),
  ]);
  if (counted.error) return { ...empty, error: counted.error.message };
  const checkTotal = counted.count ?? 0;
  const total = checkTotal + eventRows.length;
  if (total === 0) return { ...empty, error: pairError };

  const pages = Math.max(1, Math.ceil(total / pageSize));
  const onPage = Math.min(Math.max(1, page), pages);
  const start = (onPage - 1) * pageSize;

  /* The window of checks that can reach this page. */
  const c0 = withEvents ? Math.max(0, start - eventRows.length) : start;
  const want = Math.min(withEvents ? start + pageSize - c0 : pageSize, Math.max(0, checkTotal - c0));
  type Check = ChargeRow & { reason: string };
  const charges: Check[] = [];
  for (let offset = c0; offset < c0 + want; offset += CHUNK) {
    const upto = Math.min(offset + CHUNK, c0 + want) - 1;
    let query = checks("id,created_at,delta,reason,truck_number");
    if (byTime) {
      query = query.order("created_at", { ascending }).order("id", { ascending });
    } else {
      /* Charges are negative: the most credits is the lowest delta. */
      query = query
        .order("delta", { ascending: sort === "most" })
        .order("created_at", { ascending: false })
        .order("id", { ascending: false });
    }
    const { data, error } = await query.range(offset, upto);
    if (error) return { ...empty, error: error.message };
    const rows = (data ?? []) as unknown as Check[];
    charges.push(...rows);
    if (rows.length < upto - offset + 1) break;
  }

  /* Rank and cut. */
  type Ranked = { at: string; check?: Check; event?: (typeof eventRows)[number] };
  let picked: Ranked[];
  if (!withEvents) {
    picked = charges.map((check) => ({ at: check.created_at, check }));
  } else {
    const time = (iso: string) => Date.parse(iso);
    const merged: Ranked[] = [
      ...charges.map((check): Ranked => ({ at: check.created_at, check })),
      ...eventRows.map((event): Ranked => ({ at: event.created_at, event })),
    ].sort((a, b) => {
      const d = time(a.at) - time(b.at);
      if (d !== 0) return ascending ? d : -d;
      if (a.check && b.check) return ascending ? a.check.id - b.check.id : b.check.id - a.check.id;
      if (a.event && b.event) return ascending ? a.event.id - b.event.id : b.event.id - a.event.id;
      return a.check ? -1 : 1;
    });
    picked = [];
    let checksSeen = 0;
    let eventsSeen = 0;
    for (const item of merged) {
      let rank: number | null;
      if (item.check) {
        rank = c0 + checksSeen + eventsSeen;
        checksSeen += 1;
      } else {
        rank = c0 > 0 && checksSeen === 0 ? null : c0 + checksSeen + eventsSeen;
        eventsSeen += 1;
      }
      if (rank !== null && rank >= start && rank < start + pageSize) picked.push(item);
    }
  }

  /* Crossings found by the checks on this page: each check's own log row. */
  const pageChecks = picked.flatMap((item) => (item.check ? [item.check] : []));
  type LogRow = { id: number; truck_number: string; created_at: string; source: string; events_found: number; new_events: number };
  let logs: LogRow[] = [];
  if (pageChecks.length > 0) {
    const times = pageChecks.map((check) => Date.parse(check.created_at));
    const numbers = [...new Set(pageChecks.map((check) => check.truck_number).filter((n): n is string => Boolean(n)))];
    if (numbers.length > 0) {
      const { data } = await admin
        .from("search_logs")
        .select("id,truck_number,created_at,source,events_found,new_events")
        .eq("user_id", userId)
        .eq("ok", true)
        .in("truck_number", numbers)
        .gte("created_at", new Date(Math.min(...times) - 60_000).toISOString())
        .lte("created_at", new Date(Math.max(...times) + 5 * 60_000).toISOString())
        .limit(1000);
      logs = (data ?? []) as LogRow[];
    }
  }
  const usedLogs = new Set<number>();
  const logFor = (check: Check) => {
    const at = Date.parse(check.created_at);
    const source = check.reason === "auto_check" ? "tracking" : "manual";
    let best: LogRow | null = null;
    for (const log of logs) {
      if (usedLogs.has(log.id) || log.truck_number !== check.truck_number || log.source !== source) continue;
      const gap = Date.parse(log.created_at) - at;
      if (gap < -30_000 || gap > 5 * 60_000) continue;
      if (!best || Math.abs(gap) < Math.abs(Date.parse(best.created_at) - at)) best = log;
    }
    if (best) usedLogs.add(best.id);
    return best;
  };

  const rows: ActivityEntry[] = picked.map((item) => {
    if (item.check) {
      const check = item.check;
      const log = logFor(check);
      const auto = check.reason === "auto_check";
      return {
        key: `c${check.id}`,
        at: check.created_at,
        kind: "check",
        truck: check.truck_number,
        check: auto ? "auto" : check.truck_number && scope.tracked.has(check.truck_number) ? "manual" : "search",
        credits: Math.abs(Number(check.delta) || 0),
        /* An auto check logs only when it found something new. */
        found: log ? Number(log.events_found) || 0 : null,
        fresh: log ? Number(log.new_events) || 0 : auto ? 0 : null,
        title: null,
        sub: null,
        tone: "neutral",
        code: auto ? "auto_check" : "manual_search",
      };
    }
    const event = item.event!;
    return {
      key: `a${event.id}`,
      at: event.created_at,
      kind: "event",
      truck: event.truck_number,
      check: null,
      credits: 0,
      found: null,
      fresh: null,
      ...describeActivity(event.kind, event.detail ?? {}),
    };
  });

  return { rows, total, page: onPage, withEvents, error: pairError };
}

const PAUSE_REASON: Record<string, string> = {
  inactive: "no toll crossing for the halt time",
  schedule: "end time reached",
  repeated_failures: "repeated failed checks",
  no_credits: "no credits left",
  plan_expired: "plan ended",
  account_suspended: "account suspended",
};

function describeActivity(
  kind: string,
  detail: Record<string, unknown>,
): { title: string; sub: string | null; tone: ActivityEntry["tone"]; code: string } {
  const alert = typeof detail.alert === "string" ? detail.alert : "alert";
  const summary = typeof detail.summary === "string" ? detail.summary : null;
  switch (kind) {
    case "added":
      return { title: "Added to My trucks", sub: null, tone: "brand", code: kind };
    case "readded":
      return { title: "Added again and taken live", sub: null, tone: "brand", code: kind };
    case "alert_added":
      return { title: `Alert added: ${alert}`, sub: summary, tone: "brand", code: kind };
    case "alert_edited":
      return { title: `Alert changed: ${alert}`, sub: summary, tone: "neutral", code: kind };
    case "alert_removed":
      return { title: `Alert removed: ${alert}`, sub: null, tone: "neutral", code: kind };
    case "alert_on":
      return { title: `Alert on: ${alert}`, sub: null, tone: "good", code: kind };
    case "alert_off":
      return { title: `Alert off: ${alert}`, sub: null, tone: "neutral", code: kind };
    case "paused":
      return { title: "Paused by you", sub: null, tone: "neutral", code: kind };
    case "live":
      return { title: "Taken live", sub: null, tone: "good", code: kind };
    case "auto_paused": {
      const reason = typeof detail.reason === "string" ? detail.reason : "";
      return {
        title: "Paused automatically",
        sub: PAUSE_REASON[reason] ? `Reason: ${PAUSE_REASON[reason]}` : null,
        tone: reason === "inactive" || reason === "schedule" ? "warn" : "bad",
        code: kind,
      };
    }
    case "manual_check": {
      const found = typeof detail.found === "number" ? detail.found : null;
      const fresh = typeof detail.newCrossings === "number" ? detail.newCrossings : 0;
      return {
        title: "Checked now (manual)",
        sub: found === null ? null : `${found} crossing${found === 1 ? "" : "s"} found, ${fresh} new`,
        tone: "neutral",
        code: kind,
      };
    }
    case "settings_changed":
      return {
        title: "Settings changed",
        sub: Array.isArray(detail.changes) ? (detail.changes as string[]).join(", ") : null,
        tone: "neutral",
        code: kind,
      };
    case "deleted":
      return { title: "Deleted from My trucks", sub: "History kept", tone: "bad", code: kind };
    default:
      return { title: kind.replace(/_/g, " "), sub: null, tone: "neutral", code: kind };
  }
}
