import Link from "next/link";
import { AlertTriangle, CalendarDays, Wallet } from "lucide-react";

import { InviteCard } from "../referrals/InviteCard";
import { BuyCredits, BuyPlans } from "@/components/BuyCredits";
import { Disclosure } from "@/components/Disclosure";
import { Pager, pageFromParam, pagerHref } from "@/components/Pager";
import { Badge, EmptyState, Mono, PageHeader, Panel, QuotaBar, cx } from "@/components/ui";
import {
  CREDIT_REASON_LABEL,
  creditsForAmount,
  describeRate,
  formatCredits,
  loadCreditPacks,
  loadCreditRates,
} from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtNumber, fmtRupees, istToday } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { razorpayConfigured } from "@/lib/razorpay";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { BadgeTone } from "@/components/ui";
import type { CreditActivity, CreditRate, Payment, Plan } from "@/lib/types";

/** A payment with the plan it bought, when it bought one. */
type PaymentRow = Payment & { plan: { name: string } | null };

/**
 * `show` opens one folded section on arrival, so a link straight to Credit
 * history or Payments lands on the list rather than on a shut heading. It is a
 * name and not a page number, which is why it is separate from the two pagers.
 */
type PlanQuery = { history?: string; payments?: string; show?: string };

/** Short lists: this page is read on a phone, and both have a pager under them. */
const HISTORY_SIZE = 8;
const PAYMENTS_SIZE = 6;

export async function generateMetadata() {
  const { brandName } = await loadSettings(getSupabaseAdmin());
  return { title: `Plan and credits — ${brandName}` };
}

/**
 * Where an account becomes able to use the product, and where it stays able to.
 *
 * Two readers, one page. Someone with no plan needs one decision made - which
 * plan - so that is all they get above the fold. Someone with a plan needs their
 * balance, then a top-up, and everything else folded away.
 *
 * The rule that shapes the copy: a plan sets how many trucks may be watched;
 * credits pay for the searching and checking. Running out of credits is a
 * top-up, never a second copy of the plan.
 */
export default async function PlanPage({
  searchParams,
}: {
  searchParams: Promise<PlanQuery>;
}) {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();
  const params = await searchParams;

  const historyPage = pageFromParam(params.history);
  const paymentsPage = pageFromParam(params.payments);
  const showHistory = params.show === "history";
  const showPayments = params.show === "payments";
  const historyFrom = (historyPage - 1) * HISTORY_SIZE;
  const paymentsFrom = (paymentsPage - 1) * PAYMENTS_SIZE;

  const [activity, paymentResult, planResult, rates, packs, settings] = await Promise.all([
    // credit_activity, never credit_transactions: top-ups are itemised there and
    // a day of automatic checks is one line rather than several hundred.
    admin
      .from("credit_activity")
      .select("*", { count: "exact" })
      .eq("user_id", overview.id)
      .order("created_at", { ascending: false })
      .range(historyFrom, historyFrom + HISTORY_SIZE - 1),
    admin
      .from("payments")
      .select("*, plan:plans(name)", { count: "exact" })
      .eq("user_id", overview.id)
      .order("created_at", { ascending: false })
      .range(paymentsFrom, paymentsFrom + PAYMENTS_SIZE - 1),
    admin
      .from("plans")
      .select("*")
      .eq("is_active", true)
      .order("sort_order")
      .order("price_per_month"),
    loadCreditRates(admin),
    loadCreditPacks(admin),
    loadSettings(admin),
  ]);

  const history = (activity.data ?? []) as CreditActivity[];
  const historyTotal = activity.count ?? history.length;
  const payments = (paymentResult.data ?? []) as unknown as PaymentRow[];
  const paymentsTotal = paymentResult.count ?? payments.length;
  const plans = (planResult.data ?? []) as Plan[];

  const today = istToday();
  const expiresOn = overview.plan_expires_on;
  const expired = expiresOn !== null && expiresOn < today;
  const daysLeft = expiresOn
    ? Math.max(0, Math.ceil((new Date(`${expiresOn}T23:59:59+05:30`).getTime() - Date.now()) / 86_400_000))
    : null;

  /**
   * Why buying is off. razorpayConfigured() reads the environment, so this has
   * to be decided here rather than in the client component. Buying a plan is
   * never blocked by not having one - that is the whole point of the page.
   */
  const payBlocked = !settings.razorpayEnabled
    ? `Online payment is switched off at the moment. Email ${settings.supportEmail || "support"} and they will set your account up.`
    : !razorpayConfigured()
      ? "Online payment is not available yet. Please try again later, or contact support."
      : null;

  const creditsBlocked = !overview.plan_active
    ? "Choose a plan first. Credits top up an account that already has one."
    : payBlocked;

  /**
   * The open pack sells a minimum and a rate, never a price, so it is quoted as
   * "Rs 3,000 or more". Naming a single figure would advertise a purchase that
   * is only the smallest one available.
   */
  const openPack = packs.find((pack) => pack.is_open_ended);
  const openPackCredits = openPack
    ? creditsForAmount(openPack, openPack.price_inr, settings.creditsPerRupee)
    : null;
  const openPackLine =
    openPack && openPackCredits
      ? ` The open pack takes ${fmtRupees(openPack.price_inr)} or more — ${fmtRupees(openPack.price_inr)} of it buys ${formatCredits(openPackCredits)} credits.`
      : openPack
        ? ` The open pack takes ${fmtRupees(openPack.price_inr)} or more, and you name the amount.`
        : "";

  const historyPager = (page: number) =>
    `${pagerHref({ path: "/portal/plan", params: { payments: paymentsPage }, pageKey: "history" }, page)}#history`;
  const paymentsPager = (page: number) =>
    `${pagerHref({ path: "/portal/plan", params: { history: historyPage }, pageKey: "payments" }, page)}#payments`;

  /* ---------------------------------------------------------------------- */
  /* no plan: one decision, nothing else above it                            */
  /* ---------------------------------------------------------------------- */
  if (!overview.plan_active) {
    const returning = Boolean(overview.plan_id);

    return (
      <>
        <PageHeader
          title={returning ? "Renew your plan" : "Choose a plan"}
          /* The top-up rule is dropped from here: the Top up credits panel
             already says it, at the point where somebody is about to do it. */
          subtitle="How many trucks you can watch, and the credits to spend."
        />

        {expired ? (
          <Notice tone="bad">
            Your plan ended on {fmtDate(expiresOn)}. Searching and automatic checks stay off until it
            is renewed. Nothing you saved has been lost.
          </Notice>
        ) : null}

        {overview.credits > 0 ? (
          <Notice tone="warn">
            You still have {formatCredits(overview.credits)} credits. They can be spent again as soon
            as a plan is active.
          </Notice>
        ) : null}

        <BuyPlans
          plans={plans}
          brandName={settings.brandName}
          currentPlanId={overview.plan_id}
          disabledReason={payBlocked}
          renewing={returning}
        />

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Step n={1} title="Pick a plan">
            It decides how many trucks may be watched at once.
          </Step>
          <Step n={2} title="Spend the credits">
            Every search and automatic check draws from one balance.
          </Step>
          <Step n={3} title="Top up when low">
            Buy more credits at any time. The plan stays as it is.
          </Step>
        </div>

        {settings.referralEnabled ? <InviteCard className="mt-3" /> : null}

        {rates.length > 0 ? (
          <Disclosure title="What each action costs" className="mt-3">
            <Rates rates={rates} />
          </Disclosure>
        ) : null}

        {paymentsTotal > 0 ? (
          <div id="payments" className="mt-3 scroll-mt-20">
            <Disclosure
              title="Payments"
              hint={`${fmtNumber(paymentsTotal)} on record`}
              defaultOpen={paymentsPage > 1 || showPayments}
              bodyClassName="p-0"
            >
              <PaymentList payments={payments} />
              <Pager
                page={paymentsPage}
                total={paymentsTotal}
                pageSize={PAYMENTS_SIZE}
                href={paymentsPager}
                noun="payments"
                className="px-4 pt-1 pb-3"
              />
            </Disclosure>
          </div>
        ) : null}
      </>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* has a plan: balance, top-up, then everything else folded away           */
  /* ---------------------------------------------------------------------- */
  const lowCredits = overview.credits <= 0;

  return (
    <>
      <PageHeader
        title="Plan and credits"
        subtitle="What you have left, and how to add more."
      />

      {daysLeft !== null && daysLeft <= 14 ? (
        <Notice tone="warn">
          Your plan ends in {daysLeft} day{daysLeft === 1 ? "" : "s"}, on {fmtDate(expiresOn)}. Renew
          it below to keep watching without a gap.
        </Notice>
      ) : null}

      {/* One row for the three numbers that answer "where do I stand". */}
      <Panel className="mb-4" bodyClassName="p-0">
        <div className="grid grid-cols-1 divide-y divide-divider sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-4 py-3.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
              <Wallet size={12} />
              Credits left
            </p>
            <p
              className={cx(
                "mt-1.5 text-3xl font-semibold tabular-nums",
                lowCredits ? "text-bad-500" : "text-brand-500",
              )}
            >
              {formatCredits(overview.credits)}
            </p>
            <p className="mt-1 text-xs tabular-nums text-muted">
              {formatCredits(overview.credits_spent_today)} used today ·{" "}
              {formatCredits(overview.credits_spent_month)} this month
            </p>
          </div>

          <div className="px-4 py-3.5">
            <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">
              Your plan
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-strong">{overview.plan_name}</span>
              <Badge tone="good">Active</Badge>
              {overview.has_overrides ? <Badge tone="brand">customised</Badge> : null}
            </p>
            <p className="mt-1 text-xs text-muted">
              {overview.price_per_month ? `${fmtRupees(overview.price_per_month)} a month · ` : ""}
              {expiresOn ? (
                <>
                  ends {fmtDate(expiresOn)}
                  {daysLeft !== null ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : ""}
                </>
              ) : (
                "no end date"
              )}
            </p>
          </div>

          <div className="px-4 py-3.5">
            <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">
              Trucks watched
            </p>
            <div className="mt-2.5">
              <QuotaBar used={overview.active_trucks} limit={overview.truck_limit} />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {overview.truck_limit === -1
                ? "No limit on this plan."
                : overview.active_trucks >= overview.truck_limit
                  ? "Every slot is in use. A bigger plan adds more."
                  : `${fmtNumber(overview.truck_limit - overview.active_trucks)} more can be added.`}
            </p>
          </div>
        </div>
      </Panel>

      {lowCredits ? (
        <Notice tone="bad">
          You have run out of credits. Searching and automatic checks are refused until you top up -
          your plan and your trucks are untouched.
        </Notice>
      ) : null}

      <Panel
        id="topup"
        title="Top up credits"
        description={`Credits pay for every search and automatic check. Topping up never buys the plan again — your plan, its end date and its truck limit stay exactly as they are.${openPackLine}`}
        className="mb-3 scroll-mt-20"
      >
        <BuyCredits
          packs={packs}
          brandName={settings.brandName}
          creditsPerRupee={settings.creditsPerRupee}
          disabledReason={creditsBlocked}
        />
      </Panel>

      {/* The other way to get credits, right where someone is deciding how
          much to spend on them. */}
      {settings.referralEnabled ? <InviteCard className="mb-3" /> : null}

      <div className="space-y-3">
        <div id="history" className="scroll-mt-20">
          <p className="mb-2 text-xs text-muted">
            Looking for a single search or check?{" "}
            <Link href="/portal/activity" className="font-medium text-brand-500 hover:underline">
              See your activity
            </Link>
            .
          </p>
          {/* This list totals usage per day on purpose - a week of automatic
              checks would otherwise bury the top-ups. Activity is where the
              individual charges live, so the two are linked rather than one
              of them trying to be both. */}
          <Disclosure
            title="Credit history"
            hint="Top-ups one by one, usage totalled per day. See Activity for each charge."
            defaultOpen={historyPage > 1 || showHistory}
            bodyClassName="p-0"
          >
            {history.length === 0 ? (
              <EmptyState
                title="Nothing yet"
                description="Top-ups and each day's usage appear here as soon as they happen."
              />
            ) : (
              <>
                <ul className="divide-y divide-divider">
                  {history.map((row, index) => (
                    <ActivityRow key={`${row.activity_date}-${row.reason}-${index}`} row={row} />
                  ))}
                </ul>
                <Pager
                  page={historyPage}
                  total={historyTotal}
                  pageSize={HISTORY_SIZE}
                  href={historyPager}
                  noun="entries"
                  className="px-4 pt-1 pb-3"
                />
              </>
            )}
          </Disclosure>
        </div>

        <div id="payments" className="scroll-mt-20">
          <Disclosure
            title="Payments"
            hint={paymentsTotal > 0 ? `${fmtNumber(paymentsTotal)} on record` : "Nothing bought yet"}
            defaultOpen={paymentsPage > 1 || showPayments}
            bodyClassName="p-0"
          >
            <PaymentList payments={payments} />
            <Pager
              page={paymentsPage}
              total={paymentsTotal}
              pageSize={PAYMENTS_SIZE}
              href={paymentsPager}
              noun="payments"
              className="px-4 pt-1 pb-3"
            />
          </Disclosure>
        </div>

        <Disclosure
          title="What each action costs"
          hint="How far one credit goes."
        >
          <Rates rates={rates} />
        </Disclosure>

        <Disclosure
          title="Renew or change plan"
          hint="Only for more trucks or a longer term - not for more credits."
        >
          <BuyPlans
            plans={plans}
            brandName={settings.brandName}
            currentPlanId={overview.plan_id}
            disabledReason={payBlocked}
            renewing
          />
        </Disclosure>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* pieces                                                                      */
/* -------------------------------------------------------------------------- */

function Notice({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  const Icon = tone === "bad" ? AlertTriangle : CalendarDays;
  return (
    <p
      className={cx(
        "mb-3 flex items-start gap-2.5 rounded-xl border px-4 py-2.5 text-sm leading-relaxed",
        tone === "bad"
          ? "border-bad-500/40 bg-bad-500/10 text-bad-500"
          : "border-warn-500/40 bg-warn-500/10 text-warn-500",
      )}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="panel flex items-start gap-3 px-4 py-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-xs font-semibold text-brand-500">
        {n}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{children}</span>
      </span>
    </div>
  );
}

function Rates({ rates }: { rates: CreditRate[] }) {
  if (rates.length === 0) {
    return <p className="text-sm text-muted">No rates are set yet. Contact support to find out what an action costs.</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rates.map((rate) => (
        <li key={rate.action}>
          <p className="text-sm font-medium text-ink">{rate.label}</p>
          <p className="mt-0.5 text-sm text-brand-500">{describeRate(rate)}</p>
          {rate.description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{rate.description}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function ActivityRow({ row }: { row: CreditActivity }) {
  const added = row.amount > 0;
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm text-ink">{CREDIT_REASON_LABEL[row.reason] ?? row.reason}</span>
        <span className="block text-xs text-faint">
          {/* A rolled-up line stands for a whole day, so a clock time on it
              would be a time nothing actually happened at. */}
          {row.is_rollup ? fmtDate(row.activity_date) : fmtDateTime(row.created_at)}
          {row.is_rollup && row.entries > 1 ? ` · ${fmtNumber(row.entries)} times` : ""}
          {row.truck_number ? (
            <>
              {" · "}
              <Mono className="text-muted">{row.truck_number}</Mono>
            </>
          ) : null}
        </span>
        {row.note ? <span className="mt-0.5 block text-xs text-muted">{row.note}</span> : null}
      </span>

      <span className="shrink-0 text-right">
        <span
          className={cx(
            "block text-sm font-medium tabular-nums",
            added ? "text-good-500" : "text-bad-500",
          )}
        >
          {added ? "+" : "−"}
          {formatCredits(Math.abs(row.amount))}
        </span>
        <span className="block text-xs tabular-nums text-faint">
          {formatCredits(row.balance_after)} left
        </span>
      </span>
    </li>
  );
}

function PaymentList({ payments }: { payments: PaymentRow[] }) {
  if (payments.length === 0) {
    return (
      <EmptyState
        title="No payments yet"
        description="Anything you buy is listed here with what it bought."
      />
    );
  }

  return (
    <ul className="divide-y divide-divider">
      {payments.map((payment) => (
        <li key={payment.id} className="px-4 py-2.5">
          <div className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block text-sm tabular-nums text-ink">
                {fmtRupees(payment.amount_inr)}
                <span className="text-muted">
                  {" "}
                  {payment.kind === "plan"
                    ? `for ${payment.plan?.name ?? "a plan"}, ${payment.months} month${payment.months === 1 ? "" : "s"}`
                    : `for ${formatCredits(payment.credits)} credits`}
                </span>
              </span>
              <span className="block text-xs text-faint">
                {fmtDateTime(payment.paid_at ?? payment.created_at)}
                {/* amount_inr is what was charged, so a discounted payment
                    otherwise reads as a smaller purchase than it was. Saying
                    what came off is what makes the credits above add up. */}
                {payment.discount_inr > 0
                  ? ` · ${fmtRupees(payment.discount_inr)} off with a code`
                  : ""}
              </span>
            </span>
            <Badge tone={PAYMENT_TONE[payment.status]}>{PAYMENT_LABEL[payment.status]}</Badge>
          </div>
          {payment.status === "failed" && payment.failure_reason ? (
            <p className="mt-1 text-xs text-muted">{payment.failure_reason}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** "created" is what an unfinished checkout leaves behind, not a failure. */
const PAYMENT_LABEL: Record<Payment["status"], string> = {
  created: "Not completed",
  paid: "Paid",
  failed: "Failed",
};

const PAYMENT_TONE: Record<Payment["status"], BadgeTone> = {
  created: "neutral",
  paid: "good",
  failed: "bad",
};
