import { AlertTriangle, CalendarDays, ShoppingBag, Truck, Wallet } from "lucide-react";

import { BuyCredits } from "@/components/BuyCredits";
import {
  Badge,
  DescRow,
  EmptyState,
  Mono,
  PageHeader,
  Panel,
  QuotaBar,
  StatCard,
  cx,
} from "@/components/ui";
import {
  CREDIT_REASON_LABEL,
  describeRate,
  formatCredits,
  loadCreditPacks,
  loadCreditRates,
} from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtRupees, istToday } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { razorpayConfigured } from "@/lib/razorpay";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { BadgeTone } from "@/components/ui";
import type { CreditTransaction, Payment } from "@/lib/types";

export const metadata = { title: "My plan — Truck Watch" };

/**
 * What the account may reach, what it has left to spend, and how to buy more.
 *
 * Deliberately short. Everything chargeable comes out of one credit balance, so
 * the page is the plan, the balance, the shop, the prices and the two ledgers
 * that explain both - and nothing else.
 */
export default async function PlanPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: ledger }, { data: paymentRows }, rates, packs, settings] = await Promise.all([
    admin
      .from("credit_transactions")
      .select("*")
      .eq("user_id", overview.id)
      .order("created_at", { ascending: false })
      .limit(30),
    admin
      .from("payments")
      .select("*")
      .eq("user_id", overview.id)
      .order("created_at", { ascending: false })
      .limit(10),
    loadCreditRates(admin),
    loadCreditPacks(admin),
    loadSettings(admin),
  ]);

  const history = (ledger ?? []) as CreditTransaction[];
  const payments = (paymentRows ?? []) as Payment[];

  const today = istToday();
  const expiresOn = overview.plan_expires_on;
  const daysLeft = expiresOn
    ? Math.ceil((new Date(`${expiresOn}T23:59:59+05:30`).getTime() - Date.now()) / 86_400_000)
    : null;
  const expired = expiresOn !== null && expiresOn < today;

  /**
   * Why buying is off, in the order the officer can act on: their own plan
   * first, then the two things only an administrator can change. razorpayConfigured()
   * reads the environment, so this has to be decided here rather than in the
   * client component.
   */
  const buyingBlocked = !overview.plan_active
    ? "Credits can be bought only while a plan is active on your account. Until then you can see what each pack costs, but not buy one - ask your administrator to assign or renew your plan."
    : !settings.razorpayEnabled
      ? "Credits are added by your administrator. Tell them how many you need and they will top up your balance."
      : !razorpayConfigured()
        ? "Online payment is not available yet. Ask your administrator to add credits in the meantime."
        : null;

  if (!overview.plan_name) {
    return (
      <>
        <PageHeader title="My plan" />
        <Panel>
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0 text-bad-500" />
            <div>
              <p className="text-sm font-medium text-ink">No plan is assigned to your account</p>
              <p className="mt-1 text-sm text-muted">
                Searching, tracking and buying credits are switched off until your administrator
                assigns one. Nothing you have saved is lost.
              </p>
            </div>
          </div>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My plan"
        subtitle="Your plan, your credit balance, and where the credits went."
      />

      {expired ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-bad-500/40 bg-bad-500/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-bad-500" />
          <p className="text-sm text-bad-500">
            Your plan expired on {fmtDate(expiresOn)}. Searching, tracking and buying credits are
            refused until your administrator renews it.
          </p>
        </div>
      ) : daysLeft !== null && daysLeft <= 14 ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <CalendarDays size={16} className="mt-0.5 shrink-0 text-warn-500" />
          <p className="text-sm text-warn-500">
            Your plan ends in {daysLeft} day{daysLeft === 1 ? "" : "s"}, on {fmtDate(expiresOn)}.
            Mention it to your administrator if you need it extended.
          </p>
        </div>
      ) : null}

      {/* --- 1. the plan ------------------------------------------------- */}
      <Panel className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-semibold text-strong">{overview.plan_name}</h2>
          <Badge tone={expired ? "bad" : overview.plan_active ? "good" : "warn"}>
            {expired ? "Expired" : overview.plan_active ? "Active" : "Not active"}
          </Badge>
          {overview.has_overrides ? <Badge tone="brand">customised for you</Badge> : null}
        </div>
        {overview.plan_description ? (
          <p className="mt-1.5 max-w-xl text-sm text-muted">{overview.plan_description}</p>
        ) : null}

        <dl className="mt-4 grid grid-cols-1 gap-x-8 border-t border-divider pt-3 sm:grid-cols-2">
          <DescRow label="Price">
            {overview.price_per_month ? `${fmtRupees(overview.price_per_month)} a month` : "--"}
          </DescRow>
          <DescRow label="Started">
            {overview.plan_assigned_at ? fmtDate(overview.plan_assigned_at) : "--"}
          </DescRow>
          <DescRow label="Ends">
            {expiresOn ? (
              <span className={cx(expired && "text-bad-500")}>{fmtDate(expiresOn)}</span>
            ) : (
              <span className="text-good-500">No end date</span>
            )}
          </DescRow>
          <DescRow label="Days remaining">
            {daysLeft === null ? "unlimited" : expired ? "0" : `${daysLeft}`}
          </DescRow>
        </dl>

        <div className="mt-4 border-t border-divider pt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs text-muted">
            <Truck size={12} />
            Trucks under automatic checking
          </p>
          <QuotaBar used={overview.active_trucks} limit={overview.truck_limit} />
        </div>
      </Panel>

      {/* --- 2. the balance ---------------------------------------------- */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Credits left"
          value={formatCredits(overview.credits)}
          sub="pays for everything"
          tone={overview.credits <= 0 ? "bad" : "brand"}
          icon={<Wallet size={14} />}
        />
        <StatCard label="Used today" value={formatCredits(overview.credits_spent_today)} />
        <StatCard label="Used this month" value={formatCredits(overview.credits_spent_month)} />
        <StatCard
          label="Purchased"
          value={formatCredits(overview.credits_purchased)}
          sub="bought so far"
          icon={<ShoppingBag size={14} />}
        />
      </div>

      {/* --- 3. the shop ------------------------------------------------- */}
      <div className="mb-5">
        <BuyCredits packs={packs} disabledReason={buyingBlocked} />
      </div>

      {/* --- 4. what things cost ----------------------------------------- */}
      <Panel title="What each action costs" className="mb-5">
        {rates.length === 0 ? (
          <p className="text-sm text-muted">
            No rates are set yet. Ask your administrator what an action costs.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* --- 5. the ledger --------------------------------------------- */}
        <div className="lg:col-span-2">
          <Panel
            title="Credit history"
            description="Your last 30 credit movements, newest first."
            bodyClassName="p-0"
          >
            {history.length === 0 ? (
              <EmptyState
                title="Nothing spent yet"
                description="Searches, automatic checks and top ups show up here as soon as they happen."
              />
            ) : (
              <ul className="divide-y divide-divider">
                {history.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-3 px-4 py-2.5">
                    <span className="min-w-0">
                      <span className="block text-sm text-ink">
                        {CREDIT_REASON_LABEL[row.reason] ?? row.reason}
                      </span>
                      <span className="block text-xs text-faint">
                        {fmtDateTime(row.created_at)}
                        {row.truck_number ? (
                          <>
                            {" · "}
                            <Mono className="text-muted">{row.truck_number}</Mono>
                          </>
                        ) : null}
                      </span>
                      {row.note ? (
                        <span className="mt-0.5 block text-xs text-muted">{row.note}</span>
                      ) : null}
                    </span>

                    <span className="shrink-0 text-right">
                      <span
                        className={cx(
                          "block text-sm font-medium tabular-nums",
                          row.delta < 0 ? "text-bad-500" : "text-good-500",
                        )}
                      >
                        {row.delta < 0 ? "−" : "+"}
                        {formatCredits(Math.abs(row.delta))}
                      </span>
                      <span className="block text-xs tabular-nums text-faint">
                        {formatCredits(row.balance_after)} left
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* --- 6. the money ---------------------------------------------- */}
        <Panel
          title="Recent payments"
          description="Your last 10 credit purchases."
          bodyClassName="p-0"
        >
          {payments.length === 0 ? (
            <EmptyState
              title="No payments yet"
              description="Anything you buy above is listed here with its receipt."
            />
          ) : (
            <ul className="divide-y divide-divider">
              {payments.map((payment) => (
                <li key={payment.id} className="px-4 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-sm text-ink tabular-nums">
                        {fmtRupees(payment.amount_inr)}
                        <span className="text-muted">
                          {" "}
                          for {formatCredits(payment.credits)} credits
                        </span>
                      </span>
                      <span className="block text-xs text-faint">
                        {fmtDateTime(payment.paid_at ?? payment.created_at)}
                      </span>
                    </span>
                    <Badge tone={PAYMENT_TONE[payment.status]}>
                      {PAYMENT_LABEL[payment.status]}
                    </Badge>
                  </div>
                  {payment.status === "failed" && payment.failure_reason ? (
                    <p className="mt-1 text-xs text-muted">{payment.failure_reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
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
