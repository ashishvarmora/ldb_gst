import Link from "next/link";
import type { ReactNode } from "react";
import {
  Coins,
  Filter,
  IndianRupee,
  Plus,
  Settings,
  TrendingDown,
  Wallet,
} from "lucide-react";

import { PackLadder } from "./PackLadder";
import { RateCard } from "./RateCard";
import { createCreditPack } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, FormGrid, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
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
  formatCredits,
  loadCreditPacks,
  loadCreditRates,
  rupeesPerCredit,
} from "@/lib/credits";
import { fmtDateTime, fmtNumber, fmtRelative, fmtRupees, initials } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  CreditPack,
  CreditTransaction,
  OfficerOverview,
  Payment,
  PaymentStatus,
} from "@/lib/types";

export const metadata = { title: "Credits — Admin" };

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

function isPaymentStatus(value: string | undefined): value is PaymentStatus {
  return value === "paid" || value === "created" || value === "failed";
}

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireSuperAdmin();
  const { status } = await searchParams;
  const statusFilter = isPaymentStatus(status) ? status : null;
  const admin = getSupabaseAdmin();

  let paymentQuery = admin
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  if (statusFilter) paymentQuery = paymentQuery.eq("status", statusFilter);

  const [rates, packs, { data: officers }, { data: ledger }, { data: payments }, { data: money }, settings] =
    await Promise.all([
      loadCreditRates(admin),
      // Hidden packs included: this is the page where they are un-hidden.
      loadCreditPacks(admin, false),
      admin.from("officer_overview").select("*").eq("role", "officer"),
      // No embed: credit_transactions points at profiles twice - once as the
      // owner, once as the admin who granted - so the name is looked up here.
      admin
        .from("credit_transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(40),
      paymentQuery,
      // Totals across every payment, not just the fifty listed. Summed here
      // rather than in a view because this is a handful of rows a month; if
      // that stops being true it becomes a view.
      admin.from("payments").select("amount_inr, credits, status").limit(1000),
      loadSettings(admin),
    ]);

  const rows = (officers ?? []) as OfficerOverview[];
  const movements = (ledger ?? []) as CreditTransaction[];
  const paymentRows = (payments ?? []) as Payment[];
  const allPayments = (money ?? []) as Pick<Payment, "amount_inr" | "credits" | "status">[];

  const nameOf = new Map(rows.map((row) => [row.id, row.full_name ?? row.email]));
  const packName = new Map(packs.map((pack) => [pack.id, pack.name]));

  const outstanding = rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const spentToday = rows.reduce((sum, row) => sum + Number(row.credits_spent_today ?? 0), 0);
  const spentMonth = rows.reduce((sum, row) => sum + Number(row.credits_spent_month ?? 0), 0);
  const empty = rows.filter((row) => Number(row.credits ?? 0) <= 0).length;

  // Balances are valued at the entry rung: the most an officer would ever pay
  // for a credit, so the liability is never understated.
  const entryPack = packs
    .filter((pack) => pack.is_active)
    .reduce<CreditPack | undefined>(
      (lowest, pack) => (!lowest || pack.price_inr < lowest.price_inr ? pack : lowest),
      undefined,
    );
  const entryRate = entryPack ? rupeesPerCredit(entryPack) : 0;

  const paid = allPayments.filter((row) => row.status === "paid");
  const received = paid.reduce((sum, row) => sum + Number(row.amount_inr ?? 0), 0);
  const issued = paid.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const pending = allPayments.filter((row) => row.status === "created").length;
  const failed = allPayments.filter((row) => row.status === "failed").length;

  const ranked = [...rows].sort(
    (a, b) => Number(b.credits_spent_month ?? 0) - Number(a.credits_spent_month ?? 0),
  );

  return (
    <>
      <PageHeader
        title="Credits"
        subtitle="Money buys credits, credits pay for actions. Both halves are set here, and both take effect immediately."
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
              : "Add a credit pack to value this"
          }
          tone="brand"
          icon={<Wallet size={15} />}
        />
        <StatCard
          label="Spent today"
          value={formatCredits(spentToday)}
          sub="Across every officer"
          icon={<TrendingDown size={15} />}
        />
        <StatCard
          label="Spent this month"
          value={formatCredits(spentMonth)}
          sub="Resets on the 1st, IST"
          icon={<Coins size={15} />}
        />
        <StatCard
          label="Officers at zero"
          value={fmtNumber(empty)}
          sub={empty > 0 ? "Every search of theirs is refused" : "Everyone has credits left"}
          tone={empty > 0 ? "warn" : "neutral"}
          icon={<IndianRupee size={15} />}
        />
      </div>

      <Panel
        className="mb-6"
        title="How the flow works"
        description="Read this once and every number on this page makes sense."
      >
        <div className="grid grid-cols-1 gap-4 text-xs leading-relaxed text-muted lg:grid-cols-3">
          <p>
            <span className="text-ink">Money becomes credits at your rates.</span> Each pack below
            says what one payment buys. The bigger packs are meant to give more credits per rupee —
            the percentage on each row tells you whether they still do.
          </p>
          <p>
            <span className="text-ink">Credits become work at your rates.</span> &ldquo;1 credit = 1
            manual search&rdquo; is one credit buying one search; &ldquo;1 credit = 2 automatic
            checks&rdquo; is one credit buying two. Nothing is free and nothing is capped: an officer
            works until the balance runs out.
          </p>
          <p>
            <span className="text-ink">Every movement is on the ledger.</span> Each debit records
            which truck it was for, so &ldquo;where did my credits go&rdquo; has an answer. The last
            forty movements are at the bottom of this page.
          </p>
        </div>
      </Panel>

      <FlowSection
        step="1"
        title="Money → credits"
        description="What a rupee buys. Officers pick a whole pack; they never buy a loose credit."
        action={
          <Modal
            triggerLabel="New pack"
            triggerIcon={<Plus size={15} />}
            triggerSize="sm"
            title="Add a credit pack"
            description="A price, and what it buys. Everything here can be changed later."
          >
            <ActionForm action={createCreditPack}>
              <div className="space-y-4">
                <FormGrid cols={2}>
                  <Field label="Pack name" name="name" hint="Shown to the officer on the buy page.">
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
                  <Field label="Price (Rs)" name="price_inr" hint="What the officer pays.">
                    <Input name="price_inr" type="number" required min={1} step="1" placeholder="500" />
                  </Field>
                  <Field label="Credits" name="credits" hint="What they get for it.">
                    <Input name="credits" type="number" required min={1} step="1" placeholder="1100" />
                  </Field>
                </FormGrid>

                <Checkbox
                  name="is_active"
                  label="Offered to officers"
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
        {packs.length === 0 ? (
          <Panel>
            <EmptyState
              title="No credit packs yet"
              description="Without a pack there is nothing for an officer to buy, so credits can only be added by hand."
            />
          </Panel>
        ) : (
          <PackLadder packs={packs} />
        )}

        {settings.razorpayEnabled ? null : (
          <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
            <span className="text-warn-500">Online payment is switched off.</span> These packs are
            still the price list you charge against, but nothing can be bought in the app — credits
            arrive only when you add them on an officer&apos;s page. Turn it on in{" "}
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
        description="What each chargeable action draws from the balance. Changes apply from the next call onwards."
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
            rates.map((rate) => <RateCard key={rate.action} rate={rate} />)
          )}
        </div>
      </FlowSection>

      <Panel
        className="mb-6"
        title="Payments"
        description="Razorpay orders, newest first. Credits are granted only when a verified payment arrives."
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

          <form method="get" className="flex flex-wrap items-center gap-2">
            <Select name="status" defaultValue={statusFilter ?? ""} className="w-44 py-1.5 text-xs">
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
            title={statusFilter ? "No payments with that status" : "No payments yet"}
            description={
              statusFilter
                ? "Clear the filter to see everything."
                : "Officers can only pay once online payment is switched on and a pack is offered."
            }
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">When</th>
              <th className="th">Officer</th>
              <th className="th">Pack</th>
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
                  <td className="td text-sm text-muted">
                    {row.pack_id ? (packName.get(row.pack_id) ?? "removed") : "--"}
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
        )}
      </Panel>

      <Panel
        className="mb-6"
        title="Officer balances"
        description="Sorted by what they have spent this month. Top an officer up from their own page."
        bodyClassName="p-0"
      >
        {ranked.length === 0 ? (
          <EmptyState title="No officers yet" />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Officer</th>
              <th className="th">Plan</th>
              <th className="th text-right">Balance</th>
              <th className="th text-right">Spent today</th>
              <th className="th text-right">Spent this month</th>
              <th className="th text-right">Bought so far</th>
            </Thead>
            <Tbody>
              {ranked.map((officer) => {
                const balance = Number(officer.credits ?? 0);
                return (
                  <Tr key={officer.id}>
                    <td className="td">
                      <Link
                        href={`/admin/officers/${officer.id}`}
                        className="group flex items-center gap-2.5"
                      >
                        <Avatar size="sm" text={initials(officer.full_name, officer.email)} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                            {officer.full_name ?? officer.email}
                          </span>
                          <span className="block truncate text-xs text-faint">
                            {officer.office ?? "--"}
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="td">
                      {officer.plan_name ? (
                        <Badge tone="brand">{officer.plan_name}</Badge>
                      ) : (
                        <Badge tone="bad">no plan</Badge>
                      )}
                    </td>
                    <td className="td text-right">
                      <Badge tone={balance <= 0 ? "bad" : balance < 20 ? "warn" : "good"}>
                        {formatCredits(balance)}
                      </Badge>
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {formatCredits(officer.credits_spent_today)}
                    </td>
                    <td className="td text-right text-sm tabular-nums text-ink">
                      {formatCredits(officer.credits_spent_month)}
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {formatCredits(officer.credits_purchased)}
                    </td>
                  </Tr>
                );
              })}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      <Panel
        title="Recent credit movements"
        description="Newest first, across every officer."
        bodyClassName="p-0"
      >
        {movements.length === 0 ? (
          <EmptyState
            title="No movements yet"
            description="Top up an officer, or wait for the first search to be charged."
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">When</th>
              <th className="th">Officer</th>
              <th className="th">Reason</th>
              <th className="th">Truck</th>
              <th className="th text-right">Change</th>
              <th className="th text-right">Balance after</th>
            </Thead>
            <Tbody>
              {movements.map((row) => (
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
                  <td className="td">
                    <span className="block text-sm text-ink">
                      {CREDIT_REASON_LABEL[row.reason] ?? row.reason}
                    </span>
                    {row.note ? (
                      <span className="block max-w-xs truncate text-xs text-faint">{row.note}</span>
                    ) : null}
                  </td>
                  <td className="td">{row.truck_number ? <Mono>{row.truck_number}</Mono> : "--"}</td>
                  <td
                    className={`td text-right text-sm font-medium tabular-nums ${
                      Number(row.delta) < 0 ? "text-muted" : "text-good-500"
                    }`}
                  >
                    {Number(row.delta) > 0 ? "+" : "-"}
                    {formatCredits(Math.abs(Number(row.delta)))}
                  </td>
                  <td className="td text-right text-sm tabular-nums text-ink">
                    {formatCredits(row.balance_after)}
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>
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
