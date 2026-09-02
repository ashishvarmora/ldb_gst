import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  History,
  Truck,
  Wallet,
} from "lucide-react";

import { RedeemBonusCode } from "./RedeemBonusCode";
import { InviteCard } from "../referrals/InviteCard";
import { BuyCredits, BuyPlans } from "@/components/BuyCredits";
import { Disclosure } from "@/components/Disclosure";
import { Pager, pageFromParam, pagerHref } from "@/components/Pager";
import { Badge, EmptyState, PageHeader, Panel, QuotaBar, cx } from "@/components/ui";
import {
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
import type { CreditRate, Payment, Plan } from "@/lib/types";

/** A payment with the plan it bought, when it bought one. */
type PaymentRow = Payment & { plan: { name: string } | null };

/**
 * `show` opens one folded section on arrival, so a link straight to Credit
 * history or Payments lands on the list rather than on a shut heading. It is a
 * name and not a page number, which is why it is separate from the two pagers.
 */
type PlanQuery = { payments?: string; show?: string };

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

  const paymentsPage = pageFromParam(params.payments);
  const showPayments = params.show === "payments";
  const paymentsFrom = (paymentsPage - 1) * PAYMENTS_SIZE;

  const [paymentResult, planResult, rates, packs, settings] = await Promise.all([
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

  const payments = (paymentResult.data ?? []) as unknown as PaymentRow[];
  const paymentsTotal = paymentResult.count ?? payments.length;
  const plans = (planResult.data ?? []) as Plan[];

  /**
   * The plan row they are on, when it is still on sale. Archived plans are not
   * in `plans` - somebody can be on one and go on being on one - so this is
   * undefined often enough to matter, and every use of it below has to survive
   * that rather than assume a match.
   */
  const currentPlan = plans.find((plan) => plan.id === overview.plan_id) ?? null;

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

  const paymentsPager = (page: number) =>
    `${pagerHref({ path: "/portal/plan", params: {}, pageKey: "payments" }, page)}#payments`;

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
          currentPlan={currentPlan}
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

  /**
   * Out of truck slots, and the plan is the only thing that fixes it - credits
   * cannot buy a slot. This is the one state where changing plan is the answer
   * rather than an option, so it decides both the link in the truck tile and
   * whether the plan section arrives already open.
   */
  const outOfSlots = overview.truck_limit !== -1 && overview.active_trucks >= overview.truck_limit;
  const endingSoon = daysLeft !== null && daysLeft <= 14;

  /**
   * Whether a bigger limit is actually for sale. Without this the tile offers a
   * way out of a full fleet to somebody already on the largest plan there is,
   * which sends them to a grid where every card is a sideways move or worse.
   *
   * Compared against the limit in force rather than the plan's own, because an
   * account whose limit was raised by hand may already be above every plan.
   */
  const biggerPlanAvailable =
    overview.truck_limit !== -1 &&
    plans.some((plan) => plan.truck_limit === -1 || plan.truck_limit > overview.truck_limit);

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
                : outOfSlots
                  ? "Every slot is in use."
                  : `${fmtNumber(overview.truck_limit - overview.active_trucks)} more can be added.`}
            </p>

            {/* This tile used to end on "A bigger plan adds more" with nothing
                to tap - the plan grid was folded away at the very bottom of the
                page, under the payment history. The sentence that names the fix
                is the right place to offer it. */}
            {outOfSlots && biggerPlanAvailable ? (
              <Link
                href="#plan"
                className="mt-0.5 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-brand-500 transition hover:underline"
              >
                See plans with more trucks
                <ArrowRight size={13} />
              </Link>
            ) : null}
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
        /* The "this does not touch your plan" half of this used to live here as
           well. It is said once now, in the contrast below, rather than twice
           within a screen of itself. */
        description={`Credits pay for every search and automatic check.${openPackLine}`}
        className="mb-3 scroll-mt-20"
      >
        <BuyCredits
          packs={packs}
          brandName={settings.brandName}
          creditsPerRupee={settings.creditsPerRupee}
          disabledReason={creditsBlocked}
        />
      </Panel>

      {/*
        The plan, immediately under the top-up and no further away.

        This section used to be the last thing on the page, folded shut below
        the payment history, titled "Renew or change plan" - so an account whose
        trucks were all in use had a panel telling them a bigger plan would help
        and no reachable way to buy one. It sits next to the top-up now because
        the two are the pair a customer has to tell apart: this one moves the
        truck limit and the end date, that one only adds credits. It opens by
        itself in the two states where it is the answer rather than an option.
      */}
      <div id="plan" className="mb-3 scroll-mt-20">
        <Disclosure
          title="Change, upgrade or renew your plan"
          hint="Sets how many trucks you can watch and when the plan ends. Not the way to get more credits."
          badge={
            outOfSlots ? (
              <Badge tone="warn">Every slot in use</Badge>
            ) : endingSoon ? (
              <Badge tone="warn">Ends soon</Badge>
            ) : null
          }
          defaultOpen={outOfSlots || endingSoon}
        >
          <div className="mb-4 grid gap-2 sm:grid-cols-2">
            <Difference icon={<Wallet size={13} />} title="Topping up credits">
              Adds credits and does nothing else. Your plan, its end date and its truck limit stay
              exactly as they are.
            </Difference>
            <Difference icon={<Truck size={13} />} title="Changing your plan" highlight>
              Sets a new truck limit straight away, and moves the end date out by the term you buy.
              The new plan&apos;s included credits are added on top of the balance you already have.
            </Difference>
          </div>

          {/*
            What settle_payment() actually does, rather than a promise made up
            to sound generous. It sets the new expiry to
            greatest(current expiry, today) + the months bought, so days already
            paid for are carried rather than thrown away - and there is no
            refund of the difference either, which is why this says the term is
            added on and not that the change is pro-rated.
          */}
          <p className="mb-3 text-xs leading-relaxed text-muted">
            {expiresOn
              ? `Nothing you have already paid for is lost: whatever term you buy is counted on from ${fmtDate(expiresOn)}, not from today. There is no refund of the difference in price.`
              : "The term you buy is counted on from today."}
          </p>

          {/*
            An override on user_limit_overrides.truck_limit beats the plan's own
            in officer_effective_limits, so for these accounts a bigger plan may
            change nothing on screen. Hedged rather than stated flatly, because
            has_overrides is true even when only some other limit was adjusted.
          */}
          {overview.has_overrides ? (
            <p className="mb-3 text-xs leading-relaxed text-warn-500">
              Your limits have been adjusted by hand for this account, so a different plan may not
              change how many trucks you can watch. Check with support before buying one.
            </p>
          ) : null}

          <BuyPlans
            plans={plans}
            brandName={settings.brandName}
            currentPlanId={overview.plan_id}
            currentPlan={currentPlan}
            disabledReason={payBlocked}
            renewing
          />
        </Disclosure>
      </div>

      {/* The other way to get credits, right where someone is deciding how
          much to spend on them. */}
      <RedeemBonusCode className="mb-3" />

      {settings.referralEnabled ? <InviteCard className="mb-3" /> : null}

      <div className="space-y-3">
        {/*
          The credit history used to be rendered here as well, from a view that
          had rolled the truck away - two screens showing one account's spending
          and neither able to say which lorry caused it. It lives in one place
          now and this links to it. The anchor stays so older links still land.
        */}
        <div id="history" className="scroll-mt-20">
          <Link
            href="/portal/activity"
            className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 transition hover:border-brand-500/50 hover:bg-sunken"
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-500">
              <History size={16} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">Credits and activity</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                Every credit added and spent — per truck per day, per day, or charge by charge.
              </span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-faint" />
          </Link>
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

/**
 * One half of the top-up / change-plan contrast, side by side so the
 * distinction is read rather than remembered.
 *
 * Both buttons on this page open the same payment window and take the same
 * money, and the only difference is what arrives afterwards - which is exactly
 * the sort of difference a sentence buried in a panel description does not
 * convey. Changing plan is the highlighted half because it is the one being
 * offered here; topping up is on screen for comparison.
 */
function Difference({
  icon,
  title,
  highlight = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-lg border px-3 py-2.5",
        highlight ? "border-brand-500/40 bg-brand-500/8" : "border-line bg-raised/60",
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
        <span className="shrink-0 text-brand-500">{icon}</span>
        {title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{children}</p>
    </div>
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
