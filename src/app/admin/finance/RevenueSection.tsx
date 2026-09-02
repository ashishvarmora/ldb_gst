import Link from "next/link";
import { Download, Gift, IndianRupee, Percent, Receipt, Users, Wallet } from "lucide-react";

import { foldRevenueByPeriod, type PeriodRow } from "./ledger";
import type { FinanceParams } from "./page";
import { balanceTone } from "../tables";
import {
  DataTable,
  MetricCard,
  ShareBreakdown,
  sortRows,
  type Column,
  type Slice,
} from "@/components/charts";
import { bucketRange, parseSort, sortHrefFor } from "@/components/report";
import {
  Avatar,
  Badge,
  EmptyState,
  LinkCard,
  Panel,
  PanelAction,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import {
  PAYMENT_METHODS,
  bucketLabel,
  loadAccountActivity,
  loadRevenueSeries,
  percentChange,
  previousRange,
  rangeParams,
  sumBy,
  type DateRange,
} from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { fmtNumber, fmtRupees, initials } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * What arrived, and where it came from.
 *
 * The panel this replaces was a stacked bar chart of money per day with the
 * figures folded away underneath it behind a "Show the numbers" toggle. Over a
 * one-day range that chart drew a single stub and read as a broken control,
 * over ninety it could not be sorted or totalled, and it could not be exported
 * at all - which is the whole of the owner's complaint about the Analyse
 * section being visual only.
 *
 * So the table is the panel now, and the two breakdowns beside it are kept
 * because a share bar reads honestly: it says what fraction each method is of
 * the whole, which is the one thing a column of figures makes you work out for
 * yourself. Every row of both is a link into the receipts behind it.
 *
 * There is deliberately no group-by control here. Grouping belongs to the
 * credit ledger, which has a pivot behind it; money arrives through
 * admin_revenue_series(), which groups by period, method and what was bought
 * and nothing else, and a control offering dimensions the function cannot
 * honour would be a control that lies. The two share panels ARE the by-method
 * and by-kind groupings, and Receipts is where the individual rows live.
 */

/** Top-list length. Enough to see a pattern, short enough to read in one look. */
const TOP_N = 8;

export async function RevenueSection({
  params,
  range,
}: {
  params: FinanceParams;
  range: DateRange;
}) {
  const admin = getSupabaseAdmin();
  const previous = previousRange(range);

  /*
   * The previous window is read alongside the current one because every
   * headline figure is shown with its change, and a figure with no comparison
   * is the thing an owner squints at trying to remember what last month was.
   * It is read at month grain on purpose: nothing draws it, only sums it, and
   * asking for 90 daily rows to add them all up is 90 rows of waste.
   */
  const [revenue, revenuePrev, accounts] = await Promise.all([
    loadRevenueSeries(admin, range),
    loadRevenueSeries(admin, { ...previous, bucket: "month" }),
    loadAccountActivity(admin, range),
  ]);

  const received = sumBy(revenue, (row) => row.gross_inr);
  const receivedPrev = sumBy(revenuePrev, (row) => row.gross_inr);
  const payments = sumBy(revenue, (row) => row.payments);
  const paymentsPrev = sumBy(revenuePrev, (row) => row.payments);
  const discount = sumBy(revenue, (row) => row.discount_inr);
  const creditsSold = sumBy(revenue, (row) => row.credits_sold);
  const payers = accounts.filter((account) => account.payments > 0).length;
  const average = payments > 0 ? received / payments : 0;

  /* Folded in ledger.ts, because the CSV route folds the same rows the same
     way - an export whose periods do not match the table's is a spreadsheet
     that disagrees with the page it was downloaded from. */
  const periods = foldRevenueByPeriod(revenue);

  /* Every link out of this section keeps the window it was read in, so a figure
     and the payments behind it are always talking about the same fortnight. */
  const carried = { ...rangeParams(range), section: "revenue" };
  const query = new URLSearchParams(carried).toString();
  const receipts = (extra: Record<string, string> = {}) =>
    `/admin/finance?${new URLSearchParams({ ...rangeParams(range), section: "receipts", ...extra })}`;

  const sort = parseSort(params, { key: "bucket", desc: true });

  const columns: Column<PeriodRow>[] = [
    {
      key: "bucket",
      label: "Period",
      cell: (row) => bucketLabel(row.bucket, range.bucket),
      sortBy: (row) => row.bucket,
      className: "whitespace-nowrap",
      /*
       * A period cell narrows the Receipts list to exactly that period, which
       * is the "who paid me that Tuesday" drill-through. bucketRange is what
       * makes a weekly or monthly row work: the bucket is stored as the date it
       * starts on, so passing it as both ends of the range would answer for one
       * day and look like the rest of the month had vanished.
       */
      href: (row) => {
        const { from, to } = bucketRange(row.bucket, range.bucket);
        return receipts({ range: "custom", from, to, status: "paid" });
      },
      total: (rows) => `${fmtNumber(rows.length)} periods`,
    },
    {
      key: "received",
      label: "Received",
      align: "right",
      cell: (row) => fmtRupees(Math.round(row.received)),
      sortBy: (row) => row.received,
      total: (rows) => fmtRupees(Math.round(sumBy(rows, (row) => row.received))),
    },
    {
      key: "payments",
      label: "Payments",
      align: "right",
      cell: (row) => fmtNumber(row.payments),
      sortBy: (row) => row.payments,
      total: (rows) => fmtNumber(sumBy(rows, (row) => row.payments)),
    },
    {
      key: "average",
      label: "Average",
      align: "right",
      cell: (row) =>
        row.payments > 0 ? fmtRupees(Math.round(row.received / row.payments)) : "—",
      sortBy: (row) => (row.payments > 0 ? row.received / row.payments : 0),
      total: (rows) => {
        const count = sumBy(rows, (row) => row.payments);
        return count > 0 ? fmtRupees(Math.round(sumBy(rows, (row) => row.received) / count)) : "—";
      },
    },
    {
      key: "creditsSold",
      label: "Credits sold",
      align: "right",
      cell: (row) => formatCredits(row.creditsSold),
      sortBy: (row) => row.creditsSold,
      total: (rows) => formatCredits(sumBy(rows, (row) => row.creditsSold)),
    },
    {
      key: "discount",
      label: "Discounts",
      align: "right",
      cell: (row) => (row.discount > 0 ? fmtRupees(Math.round(row.discount)) : "—"),
      sortBy: (row) => row.discount,
      total: (rows) => fmtRupees(Math.round(sumBy(rows, (row) => row.discount))),
    },
  ];

  const periodRows = sortRows(periods, columns, sort);

  const methodSlices: Slice[] = PAYMENT_METHODS.map((method) => ({
    key: method.key,
    label: method.label,
    value: sumBy(
      revenue.filter((row) => row.method === method.key),
      (row) => row.gross_inr,
    ),
    hint: method.hint,
    href: receipts({ method: method.key, status: "paid" }),
  }));

  const kindSlices: Slice[] = [
    {
      key: "plan",
      label: "Plan subscriptions",
      value: sumBy(
        revenue.filter((row) => row.kind === "plan"),
        (row) => row.gross_inr,
      ),
      hint: "Monthly access, sold by the month",
      href: receipts({ kind: "plan", status: "paid" }),
    },
    {
      key: "credits",
      label: "Credit packs",
      value: sumBy(
        revenue.filter((row) => row.kind === "credits"),
        (row) => row.gross_inr,
      ),
      hint: "Top-ups bought as needed",
      href: receipts({ kind: "credits", status: "paid" }),
    },
  ];

  const topPayers = [...accounts]
    .filter((account) => account.paid_inr > 0)
    .sort((a, b) => b.paid_inr - a.paid_inr)
    .slice(0, TOP_N);

  return (
    <>
      {/*
       * Every card is a link now. The owner's complaint was a stat card reading
       * "given free 500" with no way to find out who claimed it, and the same
       * dead end existed on all five of these: a number, and nothing to click.
       */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5">
        <MetricCard
          label="Received"
          value={fmtRupees(received)}
          change={percentChange(received, receivedPrev)}
          hint={`vs ${fmtRupees(receivedPrev)}`}
          icon={<IndianRupee size={15} />}
          href={receipts({ status: "paid" })}
        />
        <MetricCard
          label="Payments"
          value={fmtNumber(payments)}
          change={percentChange(payments, paymentsPrev)}
          hint="settled in range"
          icon={<Receipt size={15} />}
          href={receipts({ status: "paid" })}
        />
        <MetricCard
          label="Average payment"
          value={fmtRupees(Math.round(average))}
          hint={payments > 0 ? "per settled payment" : "nothing settled"}
          icon={<Wallet size={15} />}
          href={receipts({ status: "paid" })}
        />
        <MetricCard
          label="Paying customers"
          value={fmtNumber(payers)}
          hint="paid at least once in range"
          icon={<Users size={15} />}
          href={`/admin/users?${new URLSearchParams({ ...rangeParams(range), paid: "range", sort: "paid_inr", dir: "desc" })}`}
        />
        <MetricCard
          label="Discounts given"
          value={fmtRupees(discount)}
          hint={
            received > 0
              ? `${((discount / (received + discount)) * 100).toFixed(1)}% off list`
              : "no coupons used"
          }
          goodWhen="down"
          icon={<Percent size={15} />}
          href="/admin/rewards?section=coupons"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title={`Money in, by ${range.bucket}`}
            description="Sortable, totalled, and every period opens the payments it is made of. Periods with nothing received are left out."
            bodyClassName="p-0"
            actions={
              <a
                href={`/admin/finance/export?${query}`}
                className={buttonClass("secondary", "sm")}
              >
                <Download size={13} />
                Export CSV
              </a>
            }
          >
            <DataTable
              rows={periodRows}
              columns={columns}
              sort={sort}
              sortHref={sortHrefFor("/admin/finance", carried, sort)}
              rowKey={(row) => row.bucket}
              totalsLabel="Whole range"
              emptyLabel="No money received in this range"
            />
          </Panel>

          <Panel
            title="Who paid the most"
            description={`The top ${TOP_N} accounts by money received in this range. Open one for their full history.`}
            bodyClassName="p-0"
            actions={
              <PanelAction
                href={`/admin/users?${new URLSearchParams({ ...rangeParams(range), sort: "paid_inr", dir: "desc" })}`}
              >
                Every customer, ranked
              </PanelAction>
            }
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
            description="Every rupee received in this range, by how it arrived. Tap a method for its receipts."
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
              {formatCredits(creditsSold)} credits sold in this range.{" "}
              <Link
                href={`/admin/finance?${new URLSearchParams({ ...rangeParams(range), section: "credits", kind: "grant", source: "paid", dims: "account" })}`}
                className="text-brand-500 transition hover:text-brand-600"
              >
                Who bought them
              </Link>
              .
            </p>
          </Panel>

          <LinkCard
            href="/admin/rewards?section=coupons"
            icon={<Gift size={16} />}
            title="Coupons"
            description="Which codes are running, and what each has cost in discounts."
            value={fmtRupees(discount)}
          />
        </div>
      </div>
    </>
  );
}
