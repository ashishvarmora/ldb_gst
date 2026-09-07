import { methodLabel } from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime } from "@/lib/format";
import { toCsv } from "@/components/report";
import type { BadgeTone } from "@/components/ui";
import type { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Payment, PaymentStatus } from "@/lib/types";

/**
 * How this account's payments are read, described and totalled.
 *
 * Out here rather than inside the page because the CSV route needs every one of
 * these and has to agree with the screen exactly. A support conversation
 * usually has the customer's spreadsheet on one side and this page on the
 * other, and an export that filtered on a different column or counted an
 * unfinished checkout as money is the thing that makes that call unresolvable.
 */

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** A payment with the names of whatever it bought and the code it used. */
export type PaymentRow = Payment & {
  plan: { name: string } | null;
  pack: { name: string } | null;
  coupon: { code: string } | null;
};

/**
 * The joins, by name.
 *
 * The code is joined rather than stored on the payment: coupon_id is the only
 * record of it, and "which code did I use" is asked on precisely the calls
 * where the amount charged does not match the price the customer remembers.
 */
const SELECT = "*, plan:plans(name), pack:credit_packs(name), coupon:coupons(code)";

/**
 * The most rows one range will render.
 *
 * The list is sorted and paged in JavaScript so that ordering a column and the
 * totals line both describe every payment in the window rather than the page on
 * screen - which needs the whole window in memory. A customer with more than
 * this many payments in one range does not exist yet; if one ever does, the
 * screen says so rather than quietly totalling a slice.
 */
export const MAX_ROWS = 500;

export type PaymentsResult = {
  rows: PaymentRow[];
  /** True when MAX_ROWS was hit, so the totals cover less than the range does. */
  capped: boolean;
  /** Only for the unexpected: a read that failed rather than a range with nothing in it. */
  error: string | null;
};

/**
 * One account's payments inside an IST date window.
 *
 * WINDOWED ON created_at, not on paid_at. Every row has a created_at - it is
 * written before the payment window even opens - whereas paid_at is null on
 * anything that was started and never paid, which is exactly the row a
 * customer rings up about. Filtering on the settled date would drop those rows
 * out of every range and answer "I paid you on Tuesday" with an empty screen.
 */
export async function loadPayments(
  admin: Admin,
  userId: string,
  range: { from: string; to: string },
): Promise<PaymentsResult> {
  const { data, error } = await admin
    .from("payments")
    .select(SELECT)
    .eq("user_id", userId)
    .gte("created_at", `${range.from}T00:00:00+05:30`)
    .lte("created_at", `${range.to}T23:59:59.999+05:30`)
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) {
    console.error("portal payments: list failed", error.message);
    return { rows: [], capped: false, error: error.message };
  }

  const rows = (data ?? []) as unknown as PaymentRow[];
  return { rows, capped: rows.length >= MAX_ROWS, error: null };
}

/**
 * One payment by its Razorpay order id, scoped to the account reading it.
 *
 * The scope is the whole security of the confirmation screen: the reference
 * travels in the URL, so without the user_id test anyone could read somebody
 * else's receipt by pasting their order id.
 */
export async function loadPaymentByOrder(
  admin: Admin,
  userId: string,
  orderId: string | undefined,
): Promise<PaymentRow | null> {
  const reference = orderId?.trim();
  if (!reference) return null;

  const { data, error } = await admin
    .from("payments")
    .select(SELECT)
    .eq("user_id", userId)
    .eq("razorpay_order_id", reference)
    .maybeSingle();

  if (error) {
    console.error("portal payments: receipt lookup failed", error.message);
    return null;
  }
  return (data ?? null) as unknown as PaymentRow | null;
}

/** Whether this account has ever paid for anything, however long ago. */
export async function countAllPayments(admin: Admin, userId: string): Promise<number> {
  const { count } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  return count ?? 0;
}

/* -------------------------------------------------------------------------- */
/* What a row says                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Money moved. The single most important test on this screen.
 *
 * A payments summary that counted 'created' rows as spending is what the owner
 * has been reading for months: a checkout somebody opened and abandoned charges
 * nothing, grants nothing, and must not appear in a total beside the payments
 * that did. Everything below that shows a rupee figure or a credit figure asks
 * this first.
 */
export function isSettled(row: PaymentRow): boolean {
  return row.status === "paid";
}

/** The price before any code came off. amount_inr is already net of it. */
export function listInr(row: PaymentRow): number {
  return (Number(row.amount_inr) || 0) + (Number(row.discount_inr) || 0);
}

/**
 * What the money bought, in one line.
 *
 * The term used to be appended off payments.months - "Base plan · 1 month" -
 * which was never the length of anything: months was pricePlan()'s multiplier
 * and settle_payment() has taken the term off the plan's duration_days since
 * 0038, so a receipt for ninety days read as one month. It is dropped rather
 * than replaced with the plan's term today, because the plan's term today is
 * not necessarily what this receipt bought; the end date the payment actually
 * set is on the plan page, which is the one place it is true.
 */
export function boughtLabel(row: PaymentRow): string {
  if (row.kind === "plan") {
    const plan = `${row.plan?.name ?? "Plan"} plan`;
    /* A combined payment bought two things, and naming only the plan is how a
       customer who paid for a plan AND a top-up in one go came to have no
       record of the second half anywhere on this screen. The credits
       themselves are broken out below; this is the description of the sale. */
    return (Number(row.topup_credits) || 0) > 0 ? `${plan} + credit top-up` : plan;
  }
  // A pack that has since been deleted leaves nothing to name, and an open-tier
  // top-up was never a named pack in the first place.
  return row.pack?.name ?? "Credit top-up";
}

/* -------------------------------------------------------------------------- */
/* The credits one payment granted                                             */
/* -------------------------------------------------------------------------- */

/**
 * The two kinds of credit a single payment can hand over, and their total.
 *
 * A plan payment records its plan's included allowance in `credits` and
 * anything bought alongside it in `topup_credits` - 0036 refused to let the two
 * share a column, and settle_payment() grants them as two separate ledger rows.
 * Every billing surface here was reading `credits` alone, so the owner's "500
 * plan + 1500 top-up" checkout showed as 500: the customer paid for a figure
 * that appeared nowhere on their own receipt.
 *
 * A credits-only payment is the other way round. There, `credits` IS the
 * top-up and a check constraint pins topup_credits to zero, so the top-up half
 * is read off `credits` and the plan half is nought. Callers can print the two
 * lines without branching on kind.
 *
 * `total` is what payment_credit_effect.credits_added comes to for the same
 * payment, which is the figure the receipt's balance line reconciles against.
 */
export type PaymentCredits = { plan: number; topup: number; total: number };

export function paymentCredits(row: PaymentRow): PaymentCredits {
  const credits = Number(row.credits) || 0;
  const topup = Number(row.topup_credits) || 0;
  return row.kind === "plan"
    ? { plan: credits, topup, total: credits + topup }
    : { plan: 0, topup: credits, total: credits };
}

/**
 * The words themselves, in one place because four surfaces print them.
 *
 * "Included with the plan" rather than "plan credits": an accountant reading a
 * receipt has to be able to tell an allowance that came with a subscription
 * from credits that were bought outright. They are the same money and the same
 * balance, but they are not the same purchase.
 */
export const CREDIT_LABEL = {
  plan: "Credits included with the plan",
  topup: "Top-up credits bought",
  total: "Credits added in total",
  /** For a column heading or a dash, where there is no room for a sentence. */
  short: "Credits added",
} as const;

/** One line of a receipt's credit breakdown. */
export type CreditLine = { label: string; credits: number; total?: boolean };

/**
 * How a payment's credits read on a billing document, as the lines to print.
 *
 * The wording lives here rather than at four call sites because a receipt, a
 * table cell, a phone card and a spreadsheet column that describe the same
 * grant in four ways is the thing a customer forwards to an accountant. One
 * line when a payment granted one kind of credit; three when it granted both,
 * so the sum is on screen rather than left to the reader.
 *
 * Empty when nothing was granted at all - a plan with no included credits and
 * nothing attached - so a caller can print no credit section rather than a nought.
 */
export function creditLines(row: PaymentRow): CreditLine[] {
  const { plan, topup, total } = paymentCredits(row);

  if (plan > 0 && topup > 0) {
    return [
      { label: CREDIT_LABEL.plan, credits: plan },
      { label: CREDIT_LABEL.topup, credits: topup },
      { label: CREDIT_LABEL.total, credits: total, total: true },
    ];
  }
  if (plan > 0) return [{ label: CREDIT_LABEL.plan, credits: plan, total: true }];
  if (topup > 0) return [{ label: CREDIT_LABEL.topup, credits: topup, total: true }];
  return [];
}

/**
 * Worded for the customer, not for the console.
 *
 * "Not completed" was the old wording and it read as OUR failure - people rang
 * up to ask what had gone wrong with a checkout they had closed themselves.
 * This says who stopped and what it cost: nothing.
 */
export const STATUS_LABEL: Record<PaymentStatus, string> = {
  paid: "Paid",
  created: "Started, not paid",
  failed: "Failed",
};

/** One line of explanation under the badge, for the two states that need one. */
export const STATUS_NOTE: Record<PaymentStatus, string | null> = {
  paid: null,
  created: "nothing charged",
  failed: "nothing charged",
};

export const STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  paid: "good",
  // Amber, not grey and not red. An unfinished checkout is neither a payment
  // nor a fault, and the pair being one colour is what made the two
  // indistinguishable on the old summary.
  created: "warn",
  failed: "bad",
};

/** Settled first, then the ones that were started, then the failures. */
const STATUS_RANK: Record<PaymentStatus, number> = { paid: 3, created: 2, failed: 1 };

/**
 * A gateway payment has a reference anyone can look up; a receipt an
 * administrator entered by hand carries a synthetic order id that means nothing
 * to Razorpay or to support, so its own note is the useful thing instead.
 */
export function hasGatewayReference(row: PaymentRow): boolean {
  return row.method === "razorpay";
}

/* -------------------------------------------------------------------------- */
/* Totals                                                                     */
/* -------------------------------------------------------------------------- */

export type PaymentTotals = {
  /** Rupees that actually left the account, over settled payments only. */
  paidInr: number;
  /** What codes took off those same payments. */
  discountInr: number;
  /** Credits that actually landed, both kinds together. */
  credits: number;
  /** Of those, the allowance that came with a plan. */
  planCredits: number;
  /** And the ones bought as a top-up, attached to a plan or on their own. */
  topupCredits: number;
  settled: number;
  /** Started and never paid. The commonest support question on this screen. */
  unfinished: number;
  failed: number;
  /** Every row in the window, whatever became of it. */
  rows: number;
};

export function totalPayments(rows: PaymentRow[]): PaymentTotals {
  const totals: PaymentTotals = {
    paidInr: 0,
    discountInr: 0,
    credits: 0,
    planCredits: 0,
    topupCredits: 0,
    settled: 0,
    unfinished: 0,
    failed: 0,
    rows: rows.length,
  };

  for (const row of rows) {
    if (isSettled(row)) {
      totals.settled += 1;
      totals.paidInr += Number(row.amount_inr) || 0;
      totals.discountInr += Number(row.discount_inr) || 0;
      /* Both halves, which this summed as row.credits alone until now - so a
         range containing one combined purchase reported fewer credits than the
         balance had actually gained, on the screen a customer checks it on. */
      const granted = paymentCredits(row);
      totals.credits += granted.total;
      totals.planCredits += granted.plan;
      totals.topupCredits += granted.topup;
    } else if (row.status === "failed") {
      totals.failed += 1;
    } else {
      totals.unfinished += 1;
    }
  }

  return totals;
}

/** Sum one column over the settled rows only. Used by the table's footer. */
export function settledSum(rows: PaymentRow[], pick: (row: PaymentRow) => number): number {
  return rows.reduce((sum, row) => (isSettled(row) ? sum + (Number(pick(row)) || 0) : sum), 0);
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * What each sortable column compares.
 *
 * Handed to the table's columns as their `sortBy`, so the shared sortRows()
 * does the ordering and this file holds no second copy of it.
 *
 * The money and credit columns answer -1 for anything unsettled rather than 0.
 * Those rows show a dash, not a figure - nothing was charged and nothing
 * arrived - and -1 keeps them below a real payment of zero rupees whichever way
 * the column is pointed, instead of interleaving blanks through the amounts.
 */
export const PAYMENT_SORT = {
  when: (row: PaymentRow) => Date.parse(row.paid_at ?? row.created_at) || 0,
  status: (row: PaymentRow) => STATUS_RANK[row.status] ?? 0,
  bought: (row: PaymentRow) => boughtLabel(row).toLowerCase(),
  method: (row: PaymentRow) => methodLabel(row.method),
  price: (row: PaymentRow) => listInr(row),
  paid: (row: PaymentRow) => (isSettled(row) ? Number(row.amount_inr) || 0 : -1),
  /* The whole grant, matching the figure the column prints. Ordering by the
     plan's half alone would have put a 2,000-credit combined purchase below a
     1,000-credit top-up. */
  credits: (row: PaymentRow) => (isSettled(row) ? paymentCredits(row).total : -1),
} satisfies Record<string, (row: PaymentRow) => number | string>;

/* -------------------------------------------------------------------------- */
/* The same rows, as a spreadsheet                                            */
/* -------------------------------------------------------------------------- */

/**
 * Every column, including the ones the screen folds into a second line.
 *
 * This is the file that gets forwarded to an accountant or attached to a
 * support ticket, so nothing is summarised away: both timestamps, both
 * references, the list price and the discount as separate figures, the two
 * kinds of credit as separate figures beside their sum, and the failure reason
 * in the customer's own record rather than only in our logs.
 *
 * Rupees and credits go in RAW. A spreadsheet cannot add up "Rs 1,234" once a
 * locale has put a symbol and a group separator in it. Dates are the exception
 * and are formatted in IST, because an ISO timestamp in UTC is the one thing
 * guaranteed to be read as the wrong day by whoever opens this.
 */
export function paymentsCsv(rows: PaymentRow[]): string {
  const header = [
    "Started (IST)",
    "Paid at (IST)",
    "Status",
    "Bought",
    "Kind",
    "Method",
    "List price (Rs)",
    "Discount (Rs)",
    "Code",
    "Paid (Rs)",
    /* Three columns, not one. A combined purchase is one payment that bought
       two things, and a spreadsheet with a single credit column cannot show
       which half of it was the plan's allowance - which is the question an
       accountant asks of it. The sum stays as its own column rather than being
       left to a formula, so the file reconciles against the receipt as it is. */
    "Credits with the plan",
    "Top-up credits",
    "Credits added in total",
    "Razorpay order id",
    "Razorpay payment id",
    "Note",
    "Why it failed",
  ];

  const body = rows.map((row) => {
    const settled = isSettled(row);
    const granted = paymentCredits(row);
    return [
      fmtDateTime(row.created_at),
      row.paid_at ? fmtDateTime(row.paid_at) : "",
      STATUS_LABEL[row.status],
      boughtLabel(row),
      row.kind,
      methodLabel(row.method),
      listInr(row),
      Number(row.discount_inr) || 0,
      row.coupon?.code ?? "",
      // Blank rather than zero on anything unsettled: a nought in a money
      // column reads as "charged nothing", and this was never charged at all.
      settled ? Number(row.amount_inr) || 0 : "",
      // Blank on anything unsettled for the same reason as the amount: nothing
      // arrived, and a nought in a credit column reads as a grant of nothing.
      settled ? granted.plan : "",
      settled ? granted.topup : "",
      settled ? granted.total : "",
      row.razorpay_order_id,
      row.razorpay_payment_id ?? "",
      row.note ?? "",
      row.failure_reason ?? "",
    ];
  });

  return toCsv(header, body);
}

/** One credit figure, with its unit. Used by the receipt and the phone cards. */
export function creditsLine(credits: number): string {
  return `${formatCredits(credits)} credits`;
}
