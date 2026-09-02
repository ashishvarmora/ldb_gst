import Link from "next/link";
import {
  Banknote,
  CreditCard,
  Gift,
  IndianRupee,
  Percent,
  Plus,
  Receipt,
  Users,
  Wallet,
} from "lucide-react";

import { PaymentsSection } from "./PaymentsSection";
import { RecordPaymentForm } from "./RecordPaymentForm";
import { balanceTone } from "../tables";
import {
  ChartTable,
  MetricCard,
  ShareBreakdown,
  StackedBars,
  type Series,
  type Slice,
} from "@/components/charts";
import { DateRangeBar } from "@/components/DateRangeBar";
import { Modal } from "@/components/Modal";
import { SectionTabs, activeSection, type Section } from "@/components/SectionTabs";
import {
  Avatar,
  Badge,
  EmptyState,
  LinkCard,
  PageHeader,
  Panel,
  PanelAction,
  TableWrap,
  Tbody,
  Thead,
  Tr,
} from "@/components/ui";
import {
  CREDIT_SOURCES,
  PAYMENT_METHODS,
  bucketLabel,
  fillBuckets,
  groupSum,
  loadAccountActivity,
  loadCreditSeries,
  loadRevenueSeries,
  percentChange,
  previousRange,
  rangeParams,
  resolveRange,
  sumBy,
  type DateRange,
} from "@/lib/analytics";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtNumber, fmtRupees, initials, istToday } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Plan } from "@/lib/types";

export const metadata = { title: "Finance — Admin" };

/**
 * Every question about money, in one place.
 *
 * It used to be spread over three screens that each answered a third of it and
 * disagreed about the rest: a "Money this month" panel on the Overview, a
 * History tab inside Plans & credits, and a per-customer summary on the account
 * page. Two of the three summed `status = 'captured'`, which this schema has
 * never written, so both read Rs 0 for ever.
 *
 * Now: one date range at the top, three sections under it, and every figure
 * from the same database functions. Revenue is what arrived, Credits is what
 * that money and the giveaways turned into, Receipts is the line-by-line
 * record. Nothing is computed twice.
 */
const SECTIONS: Section[] = [
  { key: "revenue", label: "Revenue", hint: "What came in, and where from" },
  { key: "credits", label: "Credit economy", hint: "What was issued, bought, given and spent" },
  { key: "receipts", label: "Receipts", hint: "Payment by payment" },
];

const INTRO: Record<string, string> = {
  revenue:
    "Money actually received, split by how it arrived and what it bought. A payment still at “started” is an intention, not revenue, and is never counted here.",
  credits:
    "Credits are the product. This is how many exist, who paid for them, how many were given away, and how fast they are being used up.",
  receipts:
    "Every payment in the range, filterable. Cash and bank transfers are recorded here too, and settle exactly like a gateway payment.",
};

export type FinanceParams = {
  section?: string;
  range?: string;
  from?: string;
  to?: string;
  bucket?: string;
  /* Receipts section. */
  status?: string;
  method?: string;
  kind?: string;
  page?: string;
};

/** Top-list length. Enough to see a pattern, short enough to read in one look. */
const TOP_N = 8;

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<FinanceParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const section = activeSection(SECTIONS, params.section);
  const range = resolveRange(params);
  const admin = getSupabaseAdmin();

  const previous = previousRange(range);

  /*
   * Everything the header needs, in one round trip. The previous window is
   * fetched alongside the current one because every headline figure is shown
   * with its change, and a figure with no comparison is the thing an owner
   * squints at trying to remember what last month was.
   */
  const [revenue, revenuePrev, credits, accounts, plans] = await Promise.all([
    loadRevenueSeries(admin, range),
    loadRevenueSeries(admin, { ...previous, bucket: "month" }),
    loadCreditSeries(admin, range),
    loadAccountActivity(admin, range),
    admin.from("plans").select("id, name, price_per_month, included_credits").order("sort_order"),
  ]);

  const received = sumBy(revenue, (row) => row.gross_inr);
  const receivedPrev = sumBy(revenuePrev, (row) => row.gross_inr);
  const payments = sumBy(revenue, (row) => row.payments);
  const paymentsPrev = sumBy(revenuePrev, (row) => row.payments);
  const discount = sumBy(revenue, (row) => row.discount_inr);
  const creditsSold = sumBy(revenue, (row) => row.credits_sold);
  const payers = new Set(accounts.filter((a) => a.payments > 0).map((a) => a.id)).size;

  /* Credit flow. Spending is stored as a negative delta, so it is flipped once
     here and read as a positive quantity everywhere below. */
  const issued = sumBy(
    credits.filter((row) => row.source !== "spend"),
    (row) => row.credits,
  );
  const spent = Math.abs(
    sumBy(
      credits.filter((row) => row.source === "spend"),
      (row) => row.credits,
    ),
  );
  const givenFree = sumBy(
    credits.filter((row) => row.source === "free"),
    (row) => row.credits,
  );
  const givenByAdmin = sumBy(
    credits.filter((row) => row.source === "admin"),
    (row) => row.credits,
  );

  /*
   * What a free credit is worth, in rupees.
   *
   * Priced at what customers actually paid in this window - money received
   * divided by credits sold - not at any pack's list price. A giveaway valued
   * at list price overstates its cost by however much discount was running.
   */
  const rupeesPerCredit = creditsSold > 0 ? received / creditsSold : 0;
  const giveawayCost = (givenFree + givenByAdmin) * rupeesPerCredit;

  const planRows = (plans.data ?? []) as Pick<
    Plan,
    "id" | "name" | "price_per_month" | "included_credits"
  >[];

  return (
    <>
      <PageHeader
        title="Finance"
        subtitle={INTRO[section]}
        actions={
          <Modal
            triggerLabel="Record a payment"
            triggerIcon={<Plus size={14} />}
            title="Record a payment received offline"
            description="Cash, a bank transfer, UPI or a cheque. It settles exactly like a gateway payment: credits are granted, a plan is assigned and extended, and any referral it earns is paid."
            width="md"
          >
            <RecordPaymentForm
              customers={accounts
                .map((account) => ({
                  id: account.id,
                  label: `${account.full_name ?? account.email}${account.full_name ? ` · ${account.email}` : ""}`,
                }))
                .sort((a, b) => a.label.localeCompare(b.label))}
              plans={planRows.map((plan) => ({
                id: plan.id,
                name: `${plan.name} — ${fmtRupees(plan.price_per_month)}/month, ${formatCredits(plan.included_credits)} credits`,
                price: Number(plan.price_per_month) || 0,
                credits: Number(plan.included_credits) || 0,
              }))}
              today={istToday()}
            />
          </Modal>
        }
      />

      <SectionTabs sections={SECTIONS} active={section} basePath="/admin/finance" keep={rangeParams(range)} />
      <DateRangeBar range={range} showBucket={section !== "receipts"} />

      {section === "revenue" ? (
        <RevenueSection
          range={range}
          revenue={revenue}
          accounts={accounts}
          totals={{
            received,
            receivedPrev,
            payments,
            paymentsPrev,
            discount,
            creditsSold,
            payers,
          }}
        />
      ) : null}

      {section === "credits" ? (
        <CreditsSection
          range={range}
          credits={credits}
          accounts={accounts}
          totals={{ issued, spent, givenFree, givenByAdmin, giveawayCost, rupeesPerCredit }}
        />
      ) : null}

      {section === "receipts" ? <PaymentsSection params={params} range={range} /> : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Revenue                                                                     */
/* -------------------------------------------------------------------------- */

type RevenueRows = Awaited<ReturnType<typeof loadRevenueSeries>>;
type ActivityRows = Awaited<ReturnType<typeof loadAccountActivity>>;

function RevenueSection({
  range,
  revenue,
  accounts,
  totals,
}: {
  range: DateRange;
  revenue: RevenueRows;
  accounts: ActivityRows;
  totals: {
    received: number;
    receivedPrev: number;
    payments: number;
    paymentsPrev: number;
    discount: number;
    creditsSold: number;
    payers: number;
  };
}) {
  /*
   * The chart is stacked by method rather than by what was bought, because the
   * owner's first question was where the money comes from. Only the methods
   * that actually appear get a slot, so a business taking nothing but Razorpay
   * sees one clean series instead of six empty ones - and the fixed order in
   * PAYMENT_METHODS keeps a colour attached to a method rather than to its
   * rank, so a quiet month for cash does not repaint the chart.
   */
  const methodsUsed = PAYMENT_METHODS.filter((method) =>
    revenue.some((row) => row.method === method.key && row.gross_inr > 0),
  );

  const series: Series[] = methodsUsed.map((method) => {
    const points = fillBuckets(
      revenue.filter((row) => row.method === method.key),
      range,
      (row) => Number(row.gross_inr) || 0,
    );
    return { key: method.key, label: method.label, values: points.map((p) => p.value) };
  });

  const buckets = fillBuckets(revenue, range, (row) => Number(row.gross_inr) || 0).map((p) =>
    bucketLabel(p.bucket, range.bucket),
  );

  const byMethod = groupSum(revenue, (row) => row.method, (row) => Number(row.gross_inr) || 0);
  const methodSlices: Slice[] = PAYMENT_METHODS.map((method) => ({
    key: method.key,
    label: method.label,
    value: byMethod.get(method.key) ?? 0,
    hint: method.hint,
  }));

  const byKind = groupSum(revenue, (row) => row.kind, (row) => Number(row.gross_inr) || 0);
  const kindSlices: Slice[] = [
    { key: "plan", label: "Plan subscriptions", value: byKind.get("plan") ?? 0, hint: "Monthly access, sold by the month" },
    { key: "credits", label: "Credit packs", value: byKind.get("credits") ?? 0, hint: "Top-ups bought as needed" },
  ];

  const topPayers = [...accounts]
    .filter((account) => account.paid_inr > 0)
    .sort((a, b) => b.paid_inr - a.paid_inr)
    .slice(0, TOP_N);

  const average = totals.payments > 0 ? totals.received / totals.payments : 0;

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5">
        <MetricCard
          label="Received"
          value={fmtRupees(totals.received)}
          change={percentChange(totals.received, totals.receivedPrev)}
          hint={`vs ${fmtRupees(totals.receivedPrev)}`}
          icon={<IndianRupee size={15} />}
        />
        <MetricCard
          label="Payments"
          value={fmtNumber(totals.payments)}
          change={percentChange(totals.payments, totals.paymentsPrev)}
          hint="settled in range"
          icon={<Receipt size={15} />}
        />
        <MetricCard
          label="Average payment"
          value={fmtRupees(Math.round(average))}
          hint={totals.payments > 0 ? "per settled payment" : "nothing settled"}
          icon={<Wallet size={15} />}
        />
        <MetricCard
          label="Paying customers"
          value={fmtNumber(totals.payers)}
          hint="paid at least once in range"
          icon={<Users size={15} />}
        />
        <MetricCard
          label="Discounts given"
          value={fmtRupees(totals.discount)}
          hint={
            totals.received > 0
              ? `${((totals.discount / (totals.received + totals.discount)) * 100).toFixed(1)}% off list`
              : "no coupons used"
          }
          goodWhen="down"
          icon={<Percent size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title={`Money in, by ${range.bucket}`}
            description="Stacked by how each payment arrived. Hover a bar for the split."
          >
            <StackedBars
              buckets={buckets}
              series={series}
              format={(value) => fmtRupees(Math.round(value))}
              emptyLabel="No money received in this range"
            />
            <ChartTable
              buckets={buckets}
              series={series}
              format={(value) => fmtRupees(Math.round(value))}
              label="the figures behind this chart"
            />
          </Panel>

          <Panel
            title="Who paid the most"
            description={`The top ${TOP_N} accounts by money received in this range. Open one for their full history.`}
            bodyClassName="p-0"
            actions={<PanelAction href="/admin/officers">All customers</PanelAction>}
          >
            {topPayers.length === 0 ? (
              <EmptyState
                title="Nobody has paid in this range"
                description="Widen the date range, or record a payment that arrived offline."
              />
            ) : (
              <TableWrap>
                <Thead>
                  <th className="th">Customer</th>
                  <th className="th">Plan</th>
                  <th className="th text-right">Paid</th>
                  <th className="th text-right">Payments</th>
                  <th className="th text-right">Balance</th>
                </Thead>
                <Tbody>
                  {topPayers.map((account) => (
                    <Tr key={account.id}>
                      <td className="td">
                        <Link
                          href={`/admin/officers/${account.id}`}
                          className="group flex items-center gap-2.5"
                        >
                          <Avatar size="sm" text={initials(account.full_name, account.email)} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                              {account.full_name ?? account.email}
                            </span>
                            <span className="block truncate text-xs text-faint">
                              {account.district ?? account.email}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="td text-sm text-muted">{account.plan_name ?? "—"}</td>
                      <td className="td text-right text-sm font-medium tabular-nums text-strong">
                        {fmtRupees(account.paid_inr)}
                      </td>
                      <td className="td text-right text-sm tabular-nums text-muted">
                        {fmtNumber(account.payments)}
                      </td>
                      <td className="td text-right">
                        <Badge tone={balanceTone(account.credits)}>
                          {formatCredits(account.credits)}
                        </Badge>
                      </td>
                    </Tr>
                  ))}
                </Tbody>
              </TableWrap>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel
            title="Where the money came from"
            description="Every rupee received in this range, by how it arrived."
          >
            <ShareBreakdown
              slices={methodSlices}
              format={(value) => fmtRupees(Math.round(value))}
              emptyLabel="Nothing received in this range"
            />
          </Panel>

          <Panel
            title="What it bought"
            description="Subscriptions against one-off credit top-ups."
          >
            <ShareBreakdown
              slices={kindSlices}
              format={(value) => fmtRupees(Math.round(value))}
              emptyLabel="Nothing sold in this range"
            />
            <p className="mt-3 text-xs text-muted">
              {fmtNumber(totals.creditsSold)} credits sold in this range.
            </p>
          </Panel>

          <LinkCard
            href="/admin/rewards?section=coupons"
            icon={<Gift size={16} />}
            title="Coupons"
            description="Which codes are running, and what each has cost in discounts."
            value={fmtRupees(totals.discount)}
          />
        </div>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Credit economy                                                              */
/* -------------------------------------------------------------------------- */

type CreditRows = Awaited<ReturnType<typeof loadCreditSeries>>;

function CreditsSection({
  range,
  credits,
  accounts,
  totals,
}: {
  range: DateRange;
  credits: CreditRows;
  accounts: ActivityRows;
  totals: {
    issued: number;
    spent: number;
    givenFree: number;
    givenByAdmin: number;
    giveawayCost: number;
    rupeesPerCredit: number;
  };
}) {
  /*
   * Issued and spent are two different measures, so they are two charts rather
   * than one with two axes. A single chart with credits-in above and
   * credits-out below invites reading the crossing point as meaningful, and it
   * is not: they are stocks and flows of the same thing at different moments.
   */
  const issuedSources = CREDIT_SOURCES.filter((source) =>
    credits.some((row) => row.source === source.key && row.credits > 0),
  );

  const issuedSeries: Series[] = issuedSources.map((source) => {
    const points = fillBuckets(
      credits.filter((row) => row.source === source.key),
      range,
      (row) => Math.max(Number(row.credits) || 0, 0),
    );
    return { key: source.key, label: source.label, values: points.map((p) => p.value) };
  });

  const spendReasons = [
    { key: "manual_search", label: "Manual searches" },
    { key: "auto_check", label: "Automatic checks" },
  ];

  const spentSeries: Series[] = spendReasons.map((reason) => {
    const points = fillBuckets(
      credits.filter((row) => row.reason === reason.key),
      range,
      (row) => Math.abs(Number(row.credits) || 0),
    );
    return { key: reason.key, label: reason.label, values: points.map((p) => p.value) };
  });

  const buckets = fillBuckets(credits, range, () => 0).map((p) =>
    bucketLabel(p.bucket, range.bucket),
  );

  const bySource = groupSum(
    credits.filter((row) => row.source !== "spend"),
    (row) => row.source,
    (row) => Number(row.credits) || 0,
  );
  const sourceSlices: Slice[] = CREDIT_SOURCES.map((source) => ({
    key: source.key,
    label: source.label,
    value: bySource.get(source.key) ?? 0,
    hint: source.hint,
  }));

  /* The giveaway, itemised by why it was given - which is the difference
     between a sign-up tier that is working and a coupon that is being farmed. */
  const freeReasons = groupSum(
    credits.filter((row) => row.source === "free" || row.source === "admin"),
    (row) => row.reason,
    (row) => Number(row.credits) || 0,
  );
  const REASON_LABEL: Record<string, string> = {
    signup_bonus: "Free credits on sign-up",
    coupon_bonus: "Bonus codes redeemed",
    referral: "Referral rewards",
    referral_milestone: "Referral milestones",
    admin_topup: "Top-ups by an admin",
    admin_adjust: "Adjustments by an admin",
  };
  const giveawaySlices: Slice[] = [...freeReasons.entries()]
    .map(([reason, value]) => ({
      key: reason,
      label: REASON_LABEL[reason] ?? reason,
      value,
    }))
    .sort((a, b) => b.value - a.value);

  const topSpenders = [...accounts]
    .filter((account) => account.credits_spent > 0)
    .sort((a, b) => b.credits_spent - a.credits_spent)
    .slice(0, TOP_N);

  const topFree = [...accounts]
    .filter((account) => account.credits_free + account.credits_admin > 0)
    .sort(
      (a, b) => b.credits_free + b.credits_admin - (a.credits_free + a.credits_admin),
    )
    .slice(0, TOP_N);

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5">
        <MetricCard
          label="Credits issued"
          value={formatCredits(totals.issued)}
          hint="everything added in range"
          icon={<Wallet size={15} />}
        />
        <MetricCard
          label="Credits spent"
          value={formatCredits(totals.spent)}
          hint={
            totals.issued > 0
              ? `${Math.round((totals.spent / totals.issued) * 100)}% of what was issued`
              : "nothing issued in range"
          }
          icon={<CreditCard size={15} />}
        />
        <MetricCard
          label="Given free"
          value={formatCredits(totals.givenFree)}
          hint="sign-up, referrals, bonus codes"
          goodWhen="neither"
          icon={<Gift size={15} />}
        />
        <MetricCard
          label="Added by an admin"
          value={formatCredits(totals.givenByAdmin)}
          hint="top-ups and adjustments"
          goodWhen="neither"
          icon={<Plus size={15} />}
        />
        <MetricCard
          label="What the giveaway cost"
          value={fmtRupees(Math.round(totals.giveawayCost))}
          hint={
            totals.rupeesPerCredit > 0
              ? `at ${fmtRupees(Math.round(totals.rupeesPerCredit * 100) / 100)} per credit actually paid`
              : "no sales in range to price against"
          }
          goodWhen="down"
          icon={<Banknote size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title={`Credits issued, by ${range.bucket}`}
            description="Where new credits came from. Bought is revenue; the rest is not."
          >
            <StackedBars
              buckets={buckets}
              series={issuedSeries}
              format={formatCredits}
              emptyLabel="No credits issued in this range"
            />
            <ChartTable buckets={buckets} series={issuedSeries} format={formatCredits} />
          </Panel>

          <Panel
            title={`Credits spent, by ${range.bucket}`}
            description="What the balance is being used on — this is the load on the upstream API."
            actions={<PanelAction href="/admin/usage">Usage report</PanelAction>}
          >
            <StackedBars
              buckets={buckets}
              series={spentSeries}
              format={formatCredits}
              emptyLabel="Nothing spent in this range"
            />
            <ChartTable buckets={buckets} series={spentSeries} format={formatCredits} />
          </Panel>

          <div className="grid gap-5 lg:grid-cols-2">
            <Panel
              title="Biggest spenders"
              description="By credits used in this range."
              bodyClassName="p-0"
            >
              <AccountList
                rows={topSpenders}
                value={(account) => formatCredits(account.credits_spent)}
                sub={(account) =>
                  `${fmtNumber(account.searches)} searches · ${fmtNumber(account.auto_checks)} auto`
                }
                empty="Nobody spent a credit in this range."
              />
            </Panel>

            <Panel
              title="Biggest receivers of free credits"
              description="Given, not bought. Worth a look if one name keeps appearing."
              bodyClassName="p-0"
            >
              <AccountList
                rows={topFree}
                value={(account) => formatCredits(account.credits_free + account.credits_admin)}
                sub={(account) =>
                  `${formatCredits(account.credits_free)} free · ${formatCredits(account.credits_admin)} by admin`
                }
                empty="No free credits handed out in this range."
              />
            </Panel>
          </div>
        </div>

        <div className="space-y-5">
          <Panel
            title="Where credits came from"
            description="Every credit issued in this range, by source."
          >
            <ShareBreakdown
              slices={sourceSlices}
              format={formatCredits}
              emptyLabel="No credits issued in this range"
            />
          </Panel>

          <Panel
            title="What was given away"
            description="Free and admin-added credits, by the reason each was granted."
          >
            <ShareBreakdown
              slices={giveawaySlices}
              format={formatCredits}
              emptyLabel="Nothing was given away in this range"
            />
          </Panel>

          <LinkCard
            href="/admin/plans?tab=rules"
            icon={<CreditCard size={16} />}
            title="Credit rules"
            description="What one credit buys, and what a rupee buys. Changing these changes every figure above."
          />
        </div>
      </div>
    </>
  );
}

/** The small ranked list both credit panels use, so they cannot drift apart. */
function AccountList({
  rows,
  value,
  sub,
  empty,
}: {
  rows: ActivityRows;
  value: (row: ActivityRows[number]) => string;
  sub: (row: ActivityRows[number]) => string;
  empty: string;
}) {
  if (rows.length === 0) return <EmptyState title={empty} />;

  return (
    <ul className="divide-y divide-divider">
      {rows.map((account) => (
        <li key={account.id}>
          <Link
            href={`/admin/officers/${account.id}`}
            className="flex items-center gap-3 px-4 py-2.5 transition hover:bg-raised/60 sm:px-5"
          >
            <Avatar size="sm" text={initials(account.full_name, account.email)} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-ink">
                {account.full_name ?? account.email}
              </span>
              <span className="block truncate text-xs text-faint">{sub(account)}</span>
            </span>
            <span className="shrink-0 text-sm font-medium tabular-nums text-strong">
              {value(account)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
