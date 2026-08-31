import Link from "next/link";
import { ArrowRight, Coins, Filter, IndianRupee, TrendingDown, Wallet } from "lucide-react";

import { BASE_PATH, type SectionParams } from "./TabStrip";
import { CapNote, pageRange } from "../pager";
import { PaymentsTable, balanceTone, isPaymentStatus, type NameLookup } from "../tables";
import { Select } from "@/components/form";
import { Pager, pageFromParam, pageSlice } from "@/components/Pager";
import {
  Avatar,
  Badge,
  EmptyState,
  Panel,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { fmtNumber, fmtRelative, fmtRupees, initials } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditPack, OfficerOverview, Payment, Plan } from "@/lib/types";

/**
 * What has already happened, read the way the question is asked.
 *
 * This tab used to be two flat lists - every payment on the platform, then every
 * credit movement on the platform - and the second one was the same table the
 * account page already showed, interleaved across every customer at once.
 * Nobody reads a credit ledger that way. So the tab now leads with one row per
 * customer, and the row links to that customer's own history rather than
 * repeating it here.
 *
 * The itemised payment list stays, because "what money came in this week" is a
 * genuinely platform-wide question and the answer is not on any one account's
 * page. It renders through the same PaymentsTable the account page uses, so the
 * two can never drift apart.
 *
 * Nothing on this tab can be edited.
 */

const PAYMENTS_PER_PAGE = 25;
const CUSTOMERS_PER_PAGE = 20;

/**
 * How many payments the totals and the per-customer sums are worked out from.
 * These are a handful of rows a month; the cap is a floor under the cost if that
 * stops being true, and it says so on screen when it bites rather than quietly
 * under-reporting.
 */
const PAYMENT_SCAN_CAP = 2000;

/** How the per-customer list can be ordered, and what each order really asks. */
const SORTS = {
  received: "most paid",
  spent: "most spent this month",
  balance: "lowest balance",
  recent: "last active",
  name: "name",
} as const;

type SortKey = keyof typeof SORTS;

function isSort(value: string | undefined): value is SortKey {
  return value !== undefined && value in SORTS;
}

/** One customer's money, folded out of the payment scan and the overview row. */
type CustomerMoney = {
  account: OfficerOverview;
  /** Rupees actually charged, so already net of any discount. */
  received: number;
  discount: number;
  paidCount: number;
  pendingCount: number;
  lastPaymentAt: string | null;
};

type ScannedPayment = Pick<
  Payment,
  "user_id" | "amount_inr" | "discount_inr" | "credits" | "status" | "created_at"
>;

export async function HistoryTab({ params }: { params: SectionParams }) {
  const statusFilter = isPaymentStatus(params.status) ? params.status : null;
  const kindFilter = params.kind === "credits" || params.kind === "plan" ? params.kind : null;
  const sort: SortKey = isSort(params.csort) ? params.csort : "received";

  const payPage = pageFromParam(params.pay);
  const custPage = pageFromParam(params.cust);
  const payRange = pageRange(payPage, PAYMENTS_PER_PAGE);

  const admin = getSupabaseAdmin();

  let paymentQuery = admin
    .from("payments")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(payRange.from, payRange.to);
  if (statusFilter) paymentQuery = paymentQuery.eq("status", statusFilter);
  if (kindFilter) paymentQuery = paymentQuery.eq("kind", kindFilter);

  const [
    { data: accounts },
    { data: payments, count: paymentCount },
    { data: scanned },
    { data: packs },
    { data: plans },
  ] = await Promise.all([
    // One read of the overview serves three jobs: the totals above, the
    // per-customer rows, and the name beside every payment.
    admin.from("officer_overview").select("*").eq("role", "officer"),
    paymentQuery,
    // Newest first, so if the cap ever bites it is the oldest history that is
    // missing rather than an arbitrary slice.
    admin
      .from("payments")
      .select("user_id, amount_inr, discount_inr, credits, status, created_at")
      .order("created_at", { ascending: false })
      .limit(PAYMENT_SCAN_CAP),
    admin.from("credit_packs").select("id, name"),
    admin.from("plans").select("id, name"),
  ]);

  const rows = (accounts ?? []) as OfficerOverview[];
  const paymentRows = (payments ?? []) as Payment[];
  const scan = (scanned ?? []) as ScannedPayment[];

  const nameOf: NameLookup = new Map(rows.map((row) => [row.id, row.full_name ?? row.email]));
  const packName = new Map(
    ((packs ?? []) as Pick<CreditPack, "id" | "name">[]).map((p) => [p.id, p.name]),
  );
  const planName = new Map(((plans ?? []) as Pick<Plan, "id" | "name">[]).map((p) => [p.id, p.name]));

  const outstanding = rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const spentToday = rows.reduce((sum, row) => sum + Number(row.credits_spent_today ?? 0), 0);
  const spentMonth = rows.reduce((sum, row) => sum + Number(row.credits_spent_month ?? 0), 0);
  const empty = rows.filter((row) => Number(row.credits ?? 0) <= 0).length;

  const paid = scan.filter((row) => row.status === "paid");
  const received = paid.reduce((sum, row) => sum + Number(row.amount_inr ?? 0), 0);
  const discounted = paid.reduce((sum, row) => sum + Number(row.discount_inr ?? 0), 0);
  const issued = paid.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const pending = scan.filter((row) => row.status === "created").length;
  const failed = scan.filter((row) => row.status === "failed").length;

  // Balances are valued at what was actually charged: money received divided by
  // credits issued. Never at a pack's own rate, which would price a liability at
  // a number nobody may have paid.
  const paidRate = issued > 0 ? received / issued : 0;

  /* --------------------------------------------------------------------- */
  /* One row per customer - the reason this tab exists                      */
  /* --------------------------------------------------------------------- */

  const money = new Map<string, CustomerMoney>(
    rows.map((account) => [
      account.id,
      {
        account,
        received: 0,
        discount: 0,
        paidCount: 0,
        pendingCount: 0,
        lastPaymentAt: null,
      },
    ]),
  );

  for (const payment of scan) {
    const row = money.get(payment.user_id);
    if (!row) continue; // A payment from an account that is gone, or an admin's.
    if (payment.status === "paid") {
      row.received += Number(payment.amount_inr ?? 0);
      row.discount += Number(payment.discount_inr ?? 0);
      row.paidCount += 1;
      // The scan is newest first, so the first paid row seen is the latest.
      row.lastPaymentAt ??= payment.created_at;
    } else if (payment.status === "created") {
      row.pendingCount += 1;
    }
  }

  const customers = [...money.values()].sort((a, b) => {
    switch (sort) {
      case "spent":
        return (
          Number(b.account.credits_spent_month ?? 0) - Number(a.account.credits_spent_month ?? 0)
        );
      case "balance":
        return Number(a.account.credits ?? 0) - Number(b.account.credits ?? 0);
      case "recent":
        return (b.account.last_active_at ?? "").localeCompare(a.account.last_active_at ?? "");
      case "name":
        return (a.account.full_name ?? a.account.email).localeCompare(
          b.account.full_name ?? b.account.email,
        );
      default:
        return b.received - a.received;
    }
  });

  const shownCustomers = pageSlice(customers, custPage, CUSTOMERS_PER_PAGE);

  // Every pager and every filter carries the whole query string - including the
  // tab - so turning one page never drops another panel's filter or lands on the
  // wrong tab.
  const carry = {
    tab: "history",
    status: statusFilter,
    kind: kindFilter,
    csort: sort === "received" ? null : sort,
    pay: payPage,
    cust: custPage,
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
        className="mb-2"
        title="By customer"
        description="One row each. Open a row for that customer's own credit history and payments — the movement-by-movement record lives on their page, not here."
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
            {fmtNumber(customers.length)} customer{customers.length === 1 ? "" : "s"} ·{" "}
            {fmtRupees(received)} received
            {discounted > 0 ? ` · ${fmtRupees(discounted)} given away in discounts` : ""}
          </span>
          <span className="flex flex-wrap items-center gap-2">
            <Select name="csort" defaultValue={sort} className="w-56 py-1.5 text-xs">
              {(Object.keys(SORTS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  Sort by {SORTS[key]}
                </option>
              ))}
            </Select>
            <button type="submit" className={buttonClass("secondary", "sm")}>
              <Filter size={13} />
              Apply
            </button>
          </span>
        </form>

        {shownCustomers.length === 0 ? (
          <EmptyState
            title={customers.length > 0 ? "That page is past the end of the list" : "No customers yet"}
            description={
              customers.length > 0
                ? "Use the page links below to get back."
                : "Nothing has been bought or spent because there is nobody to buy or spend it."
            }
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Customer</th>
              <th className="th text-right">Credits left</th>
              <th className="th text-right">Bought</th>
              <th className="th text-right">Spent this month</th>
              <th className="th text-right">Paid</th>
              <th className="th">Last active</th>
              <th className="th" />
            </Thead>
            <Tbody>
              {shownCustomers.map((row) => {
                const { account, discount, paidCount, pendingCount, lastPaymentAt } = row;
                const paidTotal = row.received;
                return (
                  <Tr key={account.id}>
                    <td className="td">
                      <Link
                        href={`/admin/officers/${account.id}?tab=credits`}
                        className="group flex items-center gap-2.5"
                      >
                        <Avatar size="sm" text={initials(account.full_name, account.email)} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                            {account.full_name ?? "Unnamed"}
                          </span>
                          <span className="block truncate text-xs text-faint">{account.email}</span>
                        </span>
                      </Link>
                    </td>

                    <td className="td text-right">
                      <Badge tone={balanceTone(account.credits)}>
                        {formatCredits(account.credits)}
                      </Badge>
                    </td>

                    <td className="td text-right text-sm tabular-nums text-muted">
                      {formatCredits(account.credits_purchased)}
                    </td>

                    <td className="td text-right text-sm font-medium tabular-nums text-ink">
                      {formatCredits(account.credits_spent_month)}
                      <span className="mt-0.5 block text-xs font-normal text-faint">
                        {formatCredits(account.credits_spent_today)} today
                      </span>
                    </td>

                    <td className="td text-right">
                      <span className="block text-sm font-medium tabular-nums text-ink">
                        {fmtRupees(paidTotal)}
                      </span>
                      <span className="block text-xs text-faint">
                        {paidCount === 0
                          ? "never paid"
                          : `${fmtNumber(paidCount)} payment${paidCount === 1 ? "" : "s"}`}
                        {discount > 0 ? ` · ${fmtRupees(discount)} off` : ""}
                        {pendingCount > 0 ? ` · ${fmtNumber(pendingCount)} unfinished` : ""}
                      </span>
                    </td>

                    <td className="td whitespace-nowrap">
                      <span className="block text-xs text-muted">
                        {fmtRelative(account.last_active_at)}
                      </span>
                      <span className="block text-xs text-faint">
                        {lastPaymentAt ? `last paid ${fmtRelative(lastPaymentAt)}` : "no payment yet"}
                      </span>
                    </td>

                    <td className="td text-right">
                      <Link
                        href={`/admin/officers/${account.id}?tab=credits`}
                        className="inline-flex items-center gap-1 text-xs whitespace-nowrap text-brand-500 hover:underline"
                      >
                        Their history
                        <ArrowRight size={12} />
                      </Link>
                    </td>
                  </Tr>
                );
              })}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      <Pager
        className="mt-3 mb-6"
        page={custPage}
        total={customers.length}
        pageSize={CUSTOMERS_PER_PAGE}
        noun="customers"
        href={{ path: BASE_PATH, params: carry, pageKey: "cust" }}
      />

      <Panel
        title="Every payment"
        description="Across all customers, newest first — the one record here that no single account's page can answer. A plan or a pack is handed over only when a verified payment arrives."
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
            <input type="hidden" name="csort" value={sort === "received" ? "" : sort} />
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

        <PaymentsTable
          rows={paymentRows}
          nameOf={nameOf}
          planName={planName}
          packName={packName}
          emptyTitle={
            (paymentCount ?? 0) > 0
              ? "That page is past the end of the list"
              : statusFilter || kindFilter
                ? "No payments match those filters"
                : "No payments yet"
          }
          emptyDescription={
            (paymentCount ?? 0) > 0
              ? "Use the page links below to get back."
              : statusFilter || kindFilter
                ? "Clear the filters to see everything."
                : "Nobody can pay until online payment is switched on and there is a plan or a pack to buy."
          }
        />

        {(paymentCount ?? 0) > 0 ? (
          <Pager
            className="border-t border-divider px-5 py-3"
            page={payPage}
            total={paymentCount ?? paymentRows.length}
            pageSize={PAYMENTS_PER_PAGE}
            noun="payments"
            href={{ path: BASE_PATH, params: carry, pageKey: "pay" }}
          />
        ) : null}
      </Panel>

      {scan.length >= PAYMENT_SCAN_CAP ? (
        <CapNote>
          The four figures at the top and the per-customer sums are worked out from the newest{" "}
          {fmtNumber(PAYMENT_SCAN_CAP)} payments, and there are at least that many — anything older
          is missing from them. The paged list above is complete.
        </CapNote>
      ) : null}
    </>
  );
}
