import Link from "next/link";
import { Coins, Filter, IndianRupee, TrendingDown, Users, Wallet } from "lucide-react";

import { BASE_PATH, type SectionParams } from "./TabStrip";
import { Select } from "@/components/form";
import { Pager, pageFromParam } from "@/components/Pager";
import {
  Badge,
  EmptyState,
  LinkButton,
  Mono,
  Panel,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, fmtRupees } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  CreditActivity,
  CreditPack,
  OfficerOverview,
  Payment,
  PaymentStatus,
  Plan,
} from "@/lib/types";

/**
 * What has already happened, and nothing that can be changed here.
 *
 * The rules used to sit above these tables on one page, so an admin looking up
 * a receipt scrolled through the pricing controls to reach it and an admin
 * changing a price scrolled through a year of receipts. They are now different
 * tabs, and this one has no editable field on it at all.
 */

const PAYMENTS_PER_PAGE = 25;
const ACTIVITY_PER_PAGE = 25;

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

export async function HistoryTab({ params }: { params: SectionParams }) {
  const statusFilter = isPaymentStatus(params.status) ? params.status : null;
  const kindFilter = params.kind === "credits" || params.kind === "plan" ? params.kind : null;
  const flowFilter = params.flow === "in" || params.flow === "out" ? params.flow : null;

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
    { data: accounts },
    { data: payments, count: paymentCount },
    { data: activity, count: activityCount },
    { data: money },
    { data: packs },
    { data: plans },
  ] = await Promise.all([
    // One read of the overview serves two jobs: the totals above, and the name
    // beside every payment and ledger line. Who is on what balance is the
    // Accounts page's question, so no table of them is repeated here.
    admin.from("officer_overview").select("*").eq("role", "officer"),
    paymentQuery,
    activityQuery,
    // Totals across every payment, not just the page listed. Summed here rather
    // than in a view because this is a handful of rows a month; if that stops
    // being true it becomes a view.
    admin.from("payments").select("amount_inr, credits, status").limit(1000),
    admin.from("credit_packs").select("id, name"),
    admin.from("plans").select("id, name"),
  ]);

  const rows = (accounts ?? []) as OfficerOverview[];
  const paymentRows = (payments ?? []) as Payment[];
  const activityRows = (activity ?? []) as CreditActivity[];
  const allPayments = (money ?? []) as Pick<Payment, "amount_inr" | "credits" | "status">[];

  const nameOf = new Map(rows.map((row) => [row.id, row.full_name ?? row.email]));
  const packName = new Map(((packs ?? []) as Pick<CreditPack, "id" | "name">[]).map((p) => [p.id, p.name]));
  const planName = new Map(((plans ?? []) as Pick<Plan, "id" | "name">[]).map((p) => [p.id, p.name]));

  const outstanding = rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const spentToday = rows.reduce((sum, row) => sum + Number(row.credits_spent_today ?? 0), 0);
  const spentMonth = rows.reduce((sum, row) => sum + Number(row.credits_spent_month ?? 0), 0);
  const empty = rows.filter((row) => Number(row.credits ?? 0) <= 0).length;

  const paid = allPayments.filter((row) => row.status === "paid");
  const received = paid.reduce((sum, row) => sum + Number(row.amount_inr ?? 0), 0);
  const issued = paid.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const pending = allPayments.filter((row) => row.status === "created").length;
  const failed = allPayments.filter((row) => row.status === "failed").length;

  // Balances are valued at what was actually charged: money received divided by
  // credits issued. Never at a pack's own rate, which would price a liability at
  // a number nobody may have paid.
  const paidRate = issued > 0 ? received / issued : 0;

  // Every pager carries the whole query string - including the tab - so turning
  // one page never drops another panel's filter or lands on the wrong tab.
  const pagerParams = {
    tab: "history",
    status: statusFilter,
    kind: kindFilter,
    flow: flowFilter,
    pay: payPage,
    act: actPage,
  };

  return (
    <>
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Credits outstanding"
          value={formatCredits(outstanding)}
          sub={
            paidRate > 0
              ? `Worth about ${fmtRupees(Math.round(outstanding * paidRate))} at what customers have paid`
              : "Nothing bought yet, so there is no rate to value this at"
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
            <input type="hidden" name="tab" value="history" />
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
              href={{ path: BASE_PATH, params: pagerParams, pageKey: "pay" }}
            />
          </>
        )}
      </Panel>

      <Panel
        className="mb-6"
        title="Credit ledger"
        description="Across every account, newest first. Money in is listed one line each; usage is totalled per day so a week of automatic checking does not bury a top-up."
        bodyClassName="p-0"
      >
        <form
          method="get"
          className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-5 py-3"
        >
          <input type="hidden" name="tab" value="history" />
          <input type="hidden" name="status" value={statusFilter ?? ""} />
          <input type="hidden" name="kind" value={kindFilter ?? ""} />
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
              href={{ path: BASE_PATH, params: pagerParams, pageKey: "act" }}
            />
          </>
        )}
      </Panel>

      <Panel
        title="Who is holding those credits"
        description="Balance by balance, with the filters and the search, on the Accounts page. It was a second copy of that table here."
      >
        <div className="flex flex-wrap items-center gap-2">
          <LinkButton href="/admin/officers?sort=balance" variant="secondary">
            <Users size={14} />
            Lowest balances first
          </LinkButton>
          <LinkButton href="/admin/officers?sort=spending" variant="ghost">
            Biggest spenders this month
          </LinkButton>
        </div>
      </Panel>
    </>
  );
}
