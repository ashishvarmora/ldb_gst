import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  Coins,
  Filter,
  IndianRupee,
  Plus,
  Settings,
  TrendingDown,
  Wallet,
} from "lucide-react";

import { PackLadder } from "./PackLadder";
import { RateEditor } from "./RateEditor";
import { createCreditPack, saveCreditsPerRupee } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, FormGrid, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Pager, pageCount, pageFromParam, pageSlice } from "@/components/Pager";
import {
  Avatar,
  Badge,
  EmptyState,
  LinkButton,
  Mono,
  PageHeader,
  Panel,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import {
  CREDIT_REASON_LABEL,
  describeOpenTier,
  describeRate,
  formatCredits,
  loadCreditPacks,
  loadCreditRates,
  rupeesPerCredit,
} from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, fmtRupees, initials } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  CreditActivity,
  CreditPack,
  OfficerOverview,
  Payment,
  PaymentStatus,
  Plan,
} from "@/lib/types";

export const metadata = { title: "Credits — Admin" };

const PAYMENTS_PER_PAGE = 25;
const BALANCES_PER_PAGE = 25;
const ACTIVITY_PER_PAGE = 25;

/** Below this a balance is worth chasing before the customer stops mid-job. */
const LOW_BALANCE = 20;

const PAYMENT_TONE: Record<PaymentStatus, "good" | "warn" | "bad"> = {
  paid: "good",
  created: "warn",
  failed: "bad",
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid: "Paid",
  created: "Started, not paid",
  failed: "Failed",
};

const BALANCE_SORTS = {
  spent: { label: "Spent this month", column: "credits_spent_month" as const, ascending: false },
  balance: { label: "Lowest balance", column: "credits" as const, ascending: true },
  richest: { label: "Highest balance", column: "credits" as const, ascending: false },
  bought: { label: "Bought the most", column: "credits_purchased" as const, ascending: false },
  name: { label: "Name", column: "full_name" as const, ascending: true },
} as const;

type BalanceSort = keyof typeof BALANCE_SORTS;

function isPaymentStatus(value: string | undefined): value is PaymentStatus {
  return value === "paid" || value === "created" || value === "failed";
}

function isBalanceSort(value: string | undefined): value is BalanceSort {
  return value !== undefined && value in BALANCE_SORTS;
}

type CreditsSearchParams = {
  status?: string;
  kind?: string;
  flow?: string;
  sort?: string;
  pay?: string;
  bal?: string;
  act?: string;
};

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<CreditsSearchParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;

  const statusFilter = isPaymentStatus(params.status) ? params.status : null;
  const kindFilter = params.kind === "credits" || params.kind === "plan" ? params.kind : null;
  const flowFilter = params.flow === "in" || params.flow === "out" ? params.flow : null;
  const sort: BalanceSort = isBalanceSort(params.sort) ? params.sort : "spent";

  const payPage = pageFromParam(params.pay);
  const actPage = pageFromParam(params.act);

  const admin = getSupabaseAdmin();

  let paymentQuery = admin
    .from("payments")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((payPage - 1) * PAYMENTS_PER_PAGE, payPage * PAYMENTS_PER_PAGE - 1);
  if (statusFilter) paymentQuery = paymentQuery.eq("status", statusFilter);
  if (kindFilter) paymentQuery = paymentQuery.eq("kind", kindFilter);

  // credit_activity, not credit_transactions: money in stays itemised while
  // usage is rolled up per day, so a week of automatic checking is a handful of
  // lines instead of several hundred. The exact ledger is still there for an
  // argument about a single charge.
  let activityQuery = admin
    .from("credit_activity")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range((actPage - 1) * ACTIVITY_PER_PAGE, actPage * ACTIVITY_PER_PAGE - 1);
  if (flowFilter === "in") activityQuery = activityQuery.gt("amount", 0);
  if (flowFilter === "out") activityQuery = activityQuery.lt("amount", 0);

  const [
    rates,
    packs,
    { data: accounts },
    { data: payments, count: paymentCount },
    { data: activity, count: activityCount },
    { data: money },
    { data: plans },
    settings,
  ] = await Promise.all([
    loadCreditRates(admin),
    // Hidden packs included: this is the page where they are un-hidden.
    loadCreditPacks(admin, false),
    // One read of the overview serves three jobs: the totals above, the balances
    // table below, and the name beside every payment and ledger line. The view
    // is expensive enough that reading it twice would be worse than sorting and
    // paging the rows here.
    admin.from("officer_overview").select("*").eq("role", "officer"),
    paymentQuery,
    activityQuery,
    // Totals across every payment, not just the page listed. Summed here rather
    // than in a view because this is a handful of rows a month; if that stops
    // being true it becomes a view.
    admin.from("payments").select("amount_inr, credits, status").limit(1000),
    admin.from("plans").select("*").order("sort_order"),
    loadSettings(admin),
  ]);

  const rows = (accounts ?? []) as OfficerOverview[];
  const paymentRows = (payments ?? []) as Payment[];
  const activityRows = (activity ?? []) as CreditActivity[];
  const allPayments = (money ?? []) as Pick<Payment, "amount_inr" | "credits" | "status">[];
  const planList = (plans ?? []) as Plan[];

  const nameOf = new Map(rows.map((row) => [row.id, row.full_name ?? row.email]));
  const packName = new Map(packs.map((pack) => [pack.id, pack.name]));
  const planName = new Map(planList.map((plan) => [plan.id, plan.name]));

  const outstanding = rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const spentToday = rows.reduce((sum, row) => sum + Number(row.credits_spent_today ?? 0), 0);
  const spentMonth = rows.reduce((sum, row) => sum + Number(row.credits_spent_month ?? 0), 0);
  const empty = rows.filter((row) => Number(row.credits ?? 0) <= 0).length;

  // Balances are valued at the entry rung: the most a customer would ever pay
  // for a credit, so the liability is never understated.
  //
  // Fixed rungs only. An open tier's credits column is not what it sells, so
  // pricing a balance against it would value the liability at a rate nobody
  // could ever have paid.
  const entryPack = packs
    .filter((pack) => pack.is_active && !pack.is_open_ended)
    .reduce<CreditPack | undefined>(
      (lowest, pack) => (!lowest || pack.price_inr < lowest.price_inr ? pack : lowest),
      undefined,
    );
  const entryRate = entryPack ? rupeesPerCredit(entryPack) : 0;

  // The rule the ladder ends in, if there is one. Only the first is described:
  // two open tiers would be two answers to the same question, and the ladder is
  // read top to bottom.
  const openTier = packs.find((pack) => pack.is_active && pack.is_open_ended);

  const paid = allPayments.filter((row) => row.status === "paid");
  const received = paid.reduce((sum, row) => sum + Number(row.amount_inr ?? 0), 0);
  const issued = paid.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const pending = allPayments.filter((row) => row.status === "created").length;
  const failed = allPayments.filter((row) => row.status === "failed").length;

  const { column, ascending } = BALANCE_SORTS[sort];
  const ranked = [...rows].sort((a, b) => {
    if (column === "full_name") {
      const left = (a.full_name ?? a.email).toLowerCase();
      const right = (b.full_name ?? b.email).toLowerCase();
      return left.localeCompare(right);
    }
    const diff = Number(a[column] ?? 0) - Number(b[column] ?? 0);
    return ascending ? diff : -diff;
  });

  const balPage = pageFromParam(params.bal, pageCount(ranked.length, BALANCES_PER_PAGE));
  const balanceRows = pageSlice(ranked, balPage, BALANCES_PER_PAGE);

  // Every pager carries the whole query string, so turning one page never drops
  // another panel's filter.
  const pagerParams = {
    status: statusFilter,
    kind: kindFilter,
    flow: flowFilter,
    sort: sort === "spent" ? null : sort,
    pay: payPage,
    bal: balPage,
    act: actPage,
  };

  return (
    <>
      <PageHeader
        title="Credits"
        subtitle="Two conversions, both set here, both live from the moment you save. Money becomes credits at the pack prices; credits become work at the rates below."
        actions={
          <LinkButton href="/admin/settings" variant="secondary">
            <Settings size={14} />
            Payment settings
          </LinkButton>
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Credits outstanding"
          value={formatCredits(outstanding)}
          sub={
            entryRate > 0
              ? `Worth about ${fmtRupees(Math.round(outstanding * entryRate))} at ${entryPack?.name} rates`
              : "Add a fixed pack to value this"
          }
          tone="brand"
          icon={<Wallet size={15} />}
        />
        <StatCard
          label="Spent today"
          value={formatCredits(spentToday)}
          sub="Across every customer"
          icon={<TrendingDown size={15} />}
        />
        <StatCard
          label="Spent this month"
          value={formatCredits(spentMonth)}
          sub="Resets on the 1st, IST"
          icon={<Coins size={15} />}
        />
        <StatCard
          label="Customers at zero"
          value={fmtNumber(empty)}
          sub={empty > 0 ? "Every search of theirs is refused" : "Everyone has credits left"}
          tone={empty > 0 ? "warn" : "neutral"}
          icon={<IndianRupee size={15} />}
        />
      </div>

      <Panel
        className="mb-6"
        title="The whole of it, in two lines"
        description="Read this once and every number on this page makes sense."
      >
        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-lg border border-line/70 bg-panel/50 p-4">
            <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Step 1</p>
            <p className="mt-1 text-sm font-medium text-ink">Rupees buy credits</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              A fixed pack is one sentence: this much money buys this many credits. An open tier is a
              rule instead — a minimum, and a rate the buyer&apos;s own amount runs through — so the
              ladder does not end in a wall.
            </p>
            {entryPack ? (
              <p className="mt-2 text-xs text-brand-500">
                Right now: Rs {entryPack.price_inr.toLocaleString("en-IN")} buys{" "}
                {formatCredits(entryPack.credits)} credits.
              </p>
            ) : null}
            {openTier ? (
              <p className="mt-1 text-xs text-brand-500">
                Above that: Rs {openTier.price_inr.toLocaleString("en-IN")} or more, at{" "}
                {describeOpenTier(openTier, settings.creditsPerRupee)}.
              </p>
            ) : null}
          </div>

          <span className="flex items-center justify-center text-faint">
            <ArrowRight size={18} className="rotate-90 lg:rotate-0" />
          </span>

          <div className="rounded-lg border border-line/70 bg-panel/50 p-4">
            <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Step 2</p>
            <p className="mt-1 text-sm font-medium text-ink">Credits buy work</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Each action has a rate you can write either way round — one credit buys so many
              searches, or so many credits buy one search. Nothing is capped: a customer works until
              the balance runs out.
            </p>
            {rates.length > 0 ? (
              <p className="mt-2 text-xs text-brand-500">
                Right now:{" "}
                {rates
                  .map((rate) => `${rate.label.toLowerCase()}, ${describeRate(rate)}`)
                  .join(" · ")}
                .
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      <FlowSection
        step="1"
        title="Money → credits"
        description="What a rupee buys. A fixed pack is bought whole; an open tier takes whatever amount the customer types, from its minimum up."
        action={
          <Modal
            triggerLabel="New pack"
            triggerIcon={<Plus size={15} />}
            triggerSize="sm"
            title="Add a credit pack"
            description="A price, and either what it buys or the rule it follows. Everything here can be changed later."
          >
            <ActionForm action={createCreditPack}>
              <div className="space-y-4">
                <FormGrid cols={2}>
                  <Field label="Pack name" name="name" hint="Shown to the customer on the buy page.">
                    <Input name="name" required placeholder="Standard" autoComplete="off" />
                  </Field>
                  <Field
                    label="Sort order"
                    name="sort_order"
                    hint="Lowest first, so cheapest at the top."
                  >
                    <Input name="sort_order" type="number" min={0} step="10" defaultValue={100} />
                  </Field>
                </FormGrid>

                <FormGrid cols={2}>
                  <Field
                    label="Price (Rs)"
                    name="price_inr"
                    hint="What the customer pays — or the minimum they may pay, on an open tier."
                  >
                    <Input name="price_inr" type="number" required min={1} step="1" placeholder="500" />
                  </Field>
                  <Field
                    label="Credits"
                    name="credits"
                    hint="What they get for it. Leave blank on an open tier — the amount decides."
                  >
                    <Input name="credits" type="number" min={1} step="1" placeholder="1100" />
                  </Field>
                </FormGrid>

                <Checkbox
                  name="is_open_ended"
                  label="Open tier — the buyer names the amount"
                  hint="The price becomes a minimum. Credits come from the base rate above, plus the extra below."
                />

                <Field
                  label="Extra credits (%)"
                  name="bonus_percent"
                  hint="Only used on an open tier. 25 means a quarter more credits for the same money."
                >
                  <Input name="bonus_percent" type="number" min={0} max={1000} step="any" placeholder="0" />
                </Field>

                <Checkbox
                  name="is_active"
                  label="Offered to customers"
                  hint="Off keeps the pack but hides it on the buy page."
                  defaultChecked
                />
              </div>
              <FormActions>
                <SubmitButton pendingLabel="Adding...">Add pack</SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>
        }
      >
        <Panel
          className="mb-3"
          title="The base rate"
          description="What one rupee buys before any tier's extra. Fixed packs state their own credits and ignore it; an open tier is built entirely on it."
        >
          <ActionForm action={saveCreditsPerRupee} closeOnSuccess={false}>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Credits per rupee" name="credits_per_rupee" className="w-44">
                {/* step="any": the rate is not always a whole number, and a
                    stepping rule the browser enforces would refuse to submit a
                    perfectly good one. */}
                <Input
                  name="credits_per_rupee"
                  type="number"
                  required
                  min={0.0001}
                  step="any"
                  defaultValue={settings.creditsPerRupee}
                />
              </Field>
              <SubmitButton size="sm">Save rate</SubmitButton>
            </div>
            <p className="mt-2 text-xs text-muted">
              Rs 1 = {formatCredits(settings.creditsPerRupee)} credit
              {settings.creditsPerRupee === 1 ? "" : "s"} before any extra, so Rs 1,000 would buy{" "}
              {formatCredits(1000 * settings.creditsPerRupee)} credits on a tier with no bonus. Each
              open tier below shows what it comes to once its own extra is added.
            </p>
          </ActionForm>
        </Panel>

        {packs.length === 0 ? (
          <Panel>
            <EmptyState
              title="No credit packs yet"
              description="Without a pack there is nothing to top up with, so credits can only be added by hand."
            />
          </Panel>
        ) : (
          <PackLadder packs={packs} creditsPerRupee={settings.creditsPerRupee} />
        )}

        {settings.razorpayEnabled ? null : (
          <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
            <span className="text-warn-500">Online payment is switched off.</span> These packs are
            still the price list you charge against, but nothing can be bought in the app — credits
            arrive only when you add them on a customer&apos;s page. Turn it on in{" "}
            <Link href="/admin/settings" className="text-brand-400 hover:underline">
              settings
            </Link>
            .
          </p>
        )}
      </FlowSection>

      <FlowSection
        step="2"
        title="Credits → usage"
        description="What each chargeable action draws from the balance. Set it from either end, and the worked example shows what it costs in a normal day. Changes apply from the next call onwards."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rates.length === 0 ? (
            <Panel>
              <EmptyState
                title="No credit rates found"
                description="Run 0008_credits_and_alert_rules.sql against your Supabase project — it seeds the rate rows."
              />
            </Panel>
          ) : (
            rates.map((rate) => <RateEditor key={rate.action} rate={rate} />)
          )}
        </div>
      </FlowSection>

      <Panel
        className="mb-6"
        title="Payments"
        description="Every order, newest first. A plan or a pack is handed over only when a verified payment arrives."
        bodyClassName="p-0"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-5 py-3">
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs">
            <div>
              <dt className="inline text-muted">Received: </dt>
              <dd className="inline font-medium tabular-nums text-good-500">
                {fmtRupees(received)}
              </dd>
            </div>
            <div>
              <dt className="inline text-muted">Credits issued: </dt>
              <dd className="inline font-medium tabular-nums text-ink">{formatCredits(issued)}</dd>
            </div>
            <div>
              <dt className="inline text-muted">Started, not paid: </dt>
              <dd className="inline font-medium tabular-nums text-ink">{fmtNumber(pending)}</dd>
            </div>
            <div>
              <dt className="inline text-muted">Failed: </dt>
              <dd className="inline font-medium tabular-nums text-ink">{fmtNumber(failed)}</dd>
            </div>
          </dl>

          {/* Filtering deliberately drops every page number: the row you were
              looking at on page 4 is not on page 4 of a different list. */}
          <form method="get" className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="flow" value={flowFilter ?? ""} />
            <Select name="kind" defaultValue={kindFilter ?? ""} className="w-36 py-1.5 text-xs">
              <option value="">Plans and packs</option>
              <option value="plan">Plans only</option>
              <option value="credits">Packs only</option>
            </Select>
            <Select name="status" defaultValue={statusFilter ?? ""} className="w-40 py-1.5 text-xs">
              <option value="">Any status</option>
              <option value="paid">Paid</option>
              <option value="created">Started, not paid</option>
              <option value="failed">Failed</option>
            </Select>
            <button type="submit" className={buttonClass("secondary", "sm")}>
              <Filter size={13} />
              Apply
            </button>
          </form>
        </div>

        {paymentRows.length === 0 ? (
          <EmptyState
            title={statusFilter || kindFilter ? "No payments match those filters" : "No payments yet"}
            description={
              statusFilter || kindFilter
                ? "Clear the filters to see everything."
                : "Nobody can pay until online payment is switched on and there is a plan or a pack to buy."
            }
          />
        ) : (
          <>
            <TableWrap>
              <Thead>
                <th className="th">When</th>
                <th className="th">Customer</th>
                <th className="th">Bought</th>
                <th className="th text-right">Amount</th>
                <th className="th text-right">Credits</th>
                <th className="th">Status</th>
                <th className="th">Order</th>
              </Thead>
              <Tbody>
                {paymentRows.map((row) => (
                  <Tr key={row.id}>
                    <td className="td whitespace-nowrap">
                      <span className="block text-sm text-ink">{fmtRelative(row.created_at)}</span>
                      <span className="block text-xs text-faint">{fmtDateTime(row.created_at)}</span>
                    </td>
                    <td className="td text-sm">
                      <Link
                        href={`/admin/officers/${row.user_id}`}
                        className="transition hover:text-brand-400"
                      >
                        {nameOf.get(row.user_id) ?? "--"}
                      </Link>
                    </td>
                    <td className="td text-sm">
                      {row.kind === "plan" ? (
                        <>
                          <Badge tone="brand">plan</Badge>
                          <span className="mt-0.5 block text-xs text-muted">
                            {(row.plan_id ? planName.get(row.plan_id) : null) ?? "removed"}
                            {row.months > 1 ? ` · ${row.months} months` : ""}
                          </span>
                        </>
                      ) : (
                        <>
                          <Badge>pack</Badge>
                          <span className="mt-0.5 block text-xs text-muted">
                            {(row.pack_id ? packName.get(row.pack_id) : null) ?? "removed"}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="td text-right text-sm font-medium tabular-nums text-ink">
                      {fmtRupees(Number(row.amount_inr))}
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {formatCredits(row.credits)}
                    </td>
                    <td className="td">
                      <Badge tone={PAYMENT_TONE[row.status]}>{PAYMENT_LABEL[row.status]}</Badge>
                      {row.failure_reason ? (
                        <span className="mt-0.5 block max-w-48 truncate text-xs text-faint">
                          {row.failure_reason}
                        </span>
                      ) : null}
                    </td>
                    <td className="td">
                      <Mono className="text-xs text-faint">{row.razorpay_order_id}</Mono>
                    </td>
                  </Tr>
                ))}
              </Tbody>
            </TableWrap>

            <Pager
              className="border-t border-divider px-5 py-3"
              page={payPage}
              total={paymentCount ?? paymentRows.length}
              pageSize={PAYMENTS_PER_PAGE}
              noun="payments"
              href={{ path: "/admin/credits", params: pagerParams, pageKey: "pay" }}
            />
          </>
        )}
      </Panel>

      <Panel
        className="mb-6"
        title="Balances"
        description="Every account and what it has left. Top one up from its own page."
        bodyClassName="p-0"
      >
        <form
          method="get"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-5 py-3"
        >
          <input type="hidden" name="status" value={statusFilter ?? ""} />
          <input type="hidden" name="kind" value={kindFilter ?? ""} />
          <input type="hidden" name="flow" value={flowFilter ?? ""} />
          <span className="text-xs text-muted">
            {fmtNumber(ranked.length)} account{ranked.length === 1 ? "" : "s"}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Select name="sort" defaultValue={sort} className="w-48 py-1.5 text-xs">
              {Object.entries(BALANCE_SORTS).map(([key, option]) => (
                <option key={key} value={key}>
                  Sort by {option.label.toLowerCase()}
                </option>
              ))}
            </Select>
            <button type="submit" className={buttonClass("secondary", "sm")}>
              <Filter size={13} />
              Apply
            </button>
          </span>
        </form>

        {balanceRows.length === 0 ? (
          <EmptyState title="No accounts yet" />
        ) : (
          <>
            <TableWrap>
              <Thead>
                <th className="th">Customer</th>
                <th className="th">Plan</th>
                <th className="th text-right">Balance</th>
                <th className="th text-right">Spent today</th>
                <th className="th text-right">Spent this month</th>
                <th className="th text-right">Bought so far</th>
              </Thead>
              <Tbody>
                {balanceRows.map((account) => {
                  const balance = Number(account.credits ?? 0);
                  return (
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
                              {account.email}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="td">
                        {account.plan_name ? (
                          <Badge tone={account.plan_active ? "brand" : "warn"}>
                            {account.plan_name}
                          </Badge>
                        ) : (
                          <Badge tone="bad">no plan</Badge>
                        )}
                      </td>
                      <td className="td text-right">
                        <Badge
                          tone={balance <= 0 ? "bad" : balance < LOW_BALANCE ? "warn" : "good"}
                        >
                          {formatCredits(balance)}
                        </Badge>
                      </td>
                      <td className="td text-right text-sm tabular-nums text-muted">
                        {formatCredits(account.credits_spent_today)}
                      </td>
                      <td className="td text-right text-sm tabular-nums text-ink">
                        {formatCredits(account.credits_spent_month)}
                      </td>
                      <td className="td text-right text-sm tabular-nums text-muted">
                        {formatCredits(account.credits_purchased)}
                      </td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableWrap>

            <Pager
              className="border-t border-divider px-5 py-3"
              page={balPage}
              total={ranked.length}
              pageSize={BALANCES_PER_PAGE}
              noun="accounts"
              href={{ path: "/admin/credits", params: pagerParams, pageKey: "bal" }}
            />
          </>
        )}
      </Panel>

      <Panel
        title="Credit activity"
        description="Across every account, newest first. Money in is listed one line each; usage is totalled per day so a week of automatic checking does not bury a top-up."
        bodyClassName="p-0"
      >
        <form
          method="get"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-5 py-3"
        >
          <input type="hidden" name="status" value={statusFilter ?? ""} />
          <input type="hidden" name="kind" value={kindFilter ?? ""} />
          <input type="hidden" name="sort" value={sort} />
          <span className="text-xs text-muted">
            {fmtNumber(activityCount ?? activityRows.length)} line
            {(activityCount ?? activityRows.length) === 1 ? "" : "s"}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Select name="flow" defaultValue={flowFilter ?? ""} className="w-40 py-1.5 text-xs">
              <option value="">In and out</option>
              <option value="in">Money in only</option>
              <option value="out">Usage only</option>
            </Select>
            <button type="submit" className={buttonClass("secondary", "sm")}>
              <Filter size={13} />
              Apply
            </button>
          </span>
        </form>

        {activityRows.length === 0 ? (
          <EmptyState
            title={flowFilter ? "Nothing of that kind yet" : "No movements yet"}
            description="Top up an account, or wait for the first search to be charged."
          />
        ) : (
          <>
            <TableWrap>
              <Thead>
                <th className="th">When</th>
                <th className="th">Customer</th>
                <th className="th">What</th>
                <th className="th text-right">Change</th>
                <th className="th text-right">Balance after</th>
              </Thead>
              <Tbody>
                {activityRows.map((row) => (
                  <Tr key={`${row.user_id}-${row.activity_date}-${row.reason}-${row.created_at}`}>
                    <td className="td whitespace-nowrap">
                      <span className="block text-sm text-ink">
                        {row.is_rollup ? fmtDate(row.activity_date) : fmtRelative(row.created_at)}
                      </span>
                      <span className="block text-xs text-faint">
                        {row.is_rollup ? "whole day" : fmtDateTime(row.created_at)}
                      </span>
                    </td>
                    <td className="td text-sm">
                      <Link
                        href={`/admin/officers/${row.user_id}`}
                        className="transition hover:text-brand-400"
                      >
                        {nameOf.get(row.user_id) ?? "--"}
                      </Link>
                    </td>
                    <td className="td">
                      <span className="block text-sm text-ink">
                        {CREDIT_REASON_LABEL[row.reason] ?? row.reason}
                      </span>
                      <span className="block max-w-xs truncate text-xs text-faint">
                        {row.is_rollup
                          ? `${fmtNumber(row.entries)} in the day`
                          : (row.note ?? (row.truck_number ? row.truck_number : ""))}
                      </span>
                    </td>
                    <td
                      className={`td text-right text-sm font-medium tabular-nums ${
                        Number(row.amount) < 0 ? "text-muted" : "text-good-500"
                      }`}
                    >
                      {Number(row.amount) > 0 ? "+" : "-"}
                      {formatCredits(Math.abs(Number(row.amount)))}
                    </td>
                    <td className="td text-right text-sm tabular-nums text-ink">
                      {formatCredits(row.balance_after)}
                    </td>
                  </Tr>
                ))}
              </Tbody>
            </TableWrap>

            <Pager
              className="border-t border-divider px-5 py-3"
              page={actPage}
              total={activityCount ?? activityRows.length}
              pageSize={ACTIVITY_PER_PAGE}
              noun="lines"
              href={{ path: "/admin/credits", params: pagerParams, pageKey: "act" }}
            />
          </>
        )}
      </Panel>
    </>
  );
}

/**
 * A numbered band around one half of the flow. The two editors do different
 * things to different numbers, and putting them in plain panels side by side is
 * how an admin ends up editing the rate when they meant the price.
 */
function FlowSection({
  step,
  title,
  description,
  action,
  children,
}: {
  step: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-strong">
            <span className="inline-flex size-5 items-center justify-center rounded-full border border-brand-500/40 bg-brand-500/12 text-[11px] font-semibold text-brand-400">
              {step}
            </span>
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
