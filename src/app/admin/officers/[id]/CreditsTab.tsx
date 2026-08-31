import { Filter } from "lucide-react";

import type { AccountParams } from "./TabStrip";
import { GrantCreditsForm } from "../../credits/GrantCreditsForm";
import { Select } from "@/components/form";
import { Pager, pageFromParam } from "@/components/Pager";
import {
  Badge,
  DescRow,
  EmptyState,
  Mono,
  Panel,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import {
  CREDIT_REASON_LABEL,
  describeRate,
  formatCredits,
  loadCreditRates,
} from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, fmtRupees } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { BadgeTone } from "@/components/ui";
import type { CreditActivity, OfficerOverview, Payment, PaymentStatus, Plan } from "@/lib/types";

const HISTORY_PER_PAGE = 20;
const PAYMENTS_PER_PAGE = 10;

/** Below this the customer is worth chasing before they stop mid-job. */
const LOW_BALANCE = 20;

const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  paid: "good",
  created: "warn",
  failed: "bad",
};

const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid: "Paid",
  created: "Started, not paid",
  failed: "Failed",
};

/**
 * The money side of one account: what is left, how to move it, where it went,
 * and what was paid for it.
 *
 * The history reads from credit_activity rather than credit_transactions -
 * top-ups itemised, usage totalled per day - because a fortnight of automatic
 * checking is several hundred half-credit rows and nobody has ever wanted to
 * read them one by one. The exact ledger is still there for an argument about a
 * single charge.
 */
export async function CreditsTab({
  id,
  overview,
  params,
}: {
  id: string;
  overview: OfficerOverview;
  params: AccountParams;
}) {
  const admin = getSupabaseAdmin();

  const flow = params.flow === "in" || params.flow === "out" ? params.flow : null;
  const historyPage = pageFromParam(params.cpage);
  const paymentsPage = pageFromParam(params.ppage);

  let historyQuery = admin
    .from("credit_activity")
    .select("*", { count: "exact" })
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .range((historyPage - 1) * HISTORY_PER_PAGE, historyPage * HISTORY_PER_PAGE - 1);
  if (flow === "in") historyQuery = historyQuery.gt("amount", 0);
  if (flow === "out") historyQuery = historyQuery.lt("amount", 0);

  const [
    { data: history, count: historyCount },
    { data: payments, count: paymentCount },
    { data: plans },
    rates,
    settings,
  ] = await Promise.all([
    historyQuery,
    admin
      .from("payments")
      .select("*", { count: "exact" })
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .range((paymentsPage - 1) * PAYMENTS_PER_PAGE, paymentsPage * PAYMENTS_PER_PAGE - 1),
    admin.from("plans").select("*"),
    loadCreditRates(admin),
    loadSettings(admin),
  ]);

  const historyRows = (history ?? []) as CreditActivity[];
  const paymentRows = (payments ?? []) as Payment[];
  const planName = new Map(((plans ?? []) as Plan[]).map((plan) => [plan.id, plan.name]));

  const balance = Number(overview.credits ?? 0);
  const balanceTone: BadgeTone = balance <= 0 ? "bad" : balance < LOW_BALANCE ? "warn" : "good";

  const base = `/admin/officers/${id}`;
  const carry = { tab: "credits", flow, cpage: historyPage, ppage: paymentsPage };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <Panel
          title="Credit history"
          description="Money in is one line each. Usage is totalled per day, so a fortnight of tracking is a fortnight of lines."
          bodyClassName="p-0"
        >
          <form
            method="get"
            className="flex flex-wrap items-center justify-between gap-3 border-b border-divider px-5 py-3"
          >
            <input type="hidden" name="tab" value="credits" />
            <span className="text-xs text-muted">
              {fmtNumber(historyCount ?? historyRows.length)} line
              {(historyCount ?? historyRows.length) === 1 ? "" : "s"}
            </span>
            <span className="flex flex-wrap items-center gap-2">
              <Select name="flow" defaultValue={flow ?? ""} className="w-40 py-1.5 text-xs">
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

          {historyRows.length === 0 ? (
            <EmptyState
              title={flow ? "Nothing of that kind yet" : "No movements yet"}
              description="Add credits on the right, or wait for their first search to be charged."
            />
          ) : (
            <>
              <TableWrap>
                <Thead>
                  <th className="th">When</th>
                  <th className="th">What</th>
                  <th className="th">Detail</th>
                  <th className="th text-right">Change</th>
                  <th className="th text-right">Balance after</th>
                </Thead>
                <Tbody>
                  {historyRows.map((row) => (
                    <Tr key={`${row.activity_date}-${row.reason}-${row.created_at}-${row.amount}`}>
                      <td className="td whitespace-nowrap">
                        <span className="block text-sm text-ink">
                          {row.is_rollup ? fmtDate(row.activity_date) : fmtRelative(row.created_at)}
                        </span>
                        <span className="block text-xs text-faint">
                          {row.is_rollup ? "whole day" : fmtDateTime(row.created_at)}
                        </span>
                      </td>
                      <td className="td text-sm text-ink">
                        {CREDIT_REASON_LABEL[row.reason] ?? row.reason}
                      </td>
                      <td className="td text-xs text-faint">
                        {row.is_rollup ? (
                          `${fmtNumber(row.entries)} in the day`
                        ) : row.truck_number ? (
                          <Mono className="text-muted">{row.truck_number}</Mono>
                        ) : (
                          (row.note ?? "--")
                        )}
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
                page={historyPage}
                total={historyCount ?? historyRows.length}
                pageSize={HISTORY_PER_PAGE}
                noun="lines"
                href={{ path: base, params: carry, pageKey: "cpage" }}
              />
            </>
          )}
        </Panel>

        <Panel
          title="Payments"
          description="What this account has paid for, newest first."
          bodyClassName="p-0"
        >
          {paymentRows.length === 0 ? (
            <EmptyState
              title="No payments yet"
              description={
                settings.razorpayEnabled
                  ? "Anything they buy in the app shows up here with its order id."
                  : "Online payment is switched off, so everything arrives through Add credits."
              }
            />
          ) : (
            <>
              <TableWrap>
                <Thead>
                  <th className="th">When</th>
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
                        <span className="block text-xs text-faint">
                          {fmtDateTime(row.created_at)}
                        </span>
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
                          <Badge>credit pack</Badge>
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
                page={paymentsPage}
                total={paymentCount ?? paymentRows.length}
                pageSize={PAYMENTS_PER_PAGE}
                noun="payments"
                href={{ path: base, params: carry, pageKey: "ppage" }}
              />
            </>
          )}
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel
          title="Balance"
          description="One balance pays for every search and every background check."
          actions={<Badge tone={balanceTone}>{formatCredits(balance)} left</Badge>}
        >
          <p className="mb-4 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums text-strong">
              {formatCredits(balance)}
            </span>
            <span className="text-sm text-muted">credits</span>
          </p>

          <GrantCreditsForm userId={id} />

          <dl className="mt-4 border-t border-divider pt-3">
            <DescRow label="Spent today">{formatCredits(overview.credits_spent_today)}</DescRow>
            <DescRow label="Spent this month">
              {formatCredits(overview.credits_spent_month)}
            </DescRow>
            <DescRow label="Bought so far">{formatCredits(overview.credits_purchased)}</DescRow>
            <DescRow label="Plan includes">
              {overview.included_credits === null
                ? "--"
                : `${formatCredits(overview.included_credits)} per term`}
            </DescRow>
          </dl>

          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            {settings.razorpayEnabled
              ? "They can also top up themselves, as long as their plan is live."
              : "They cannot buy credits themselves yet — switch on payments in Settings when you have Razorpay keys."}
          </p>
        </Panel>

        <Panel title="What their actions cost" description="Set for everyone, under Credits.">
          {rates.length === 0 ? (
            <p className="text-sm text-muted">No rates are set yet.</p>
          ) : (
            <ul className="space-y-2">
              {rates.map((rate) => (
                <li key={rate.action} className="border-b border-divider pb-2 last:border-0 last:pb-0">
                  <p className="text-sm text-ink">{rate.label}</p>
                  <p className="text-xs text-brand-500">{describeRate(rate)}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
