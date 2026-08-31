import Link from "next/link";
import { Filter } from "lucide-react";

import type { AccountParams } from "./TabStrip";
import { GrantCreditsForm } from "../../credits/GrantCreditsForm";
import { pageRange } from "../../pager";
import { CreditLedgerTable, PaymentsTable, balanceTone } from "../../tables";
import { Select } from "@/components/form";
import { Pager, pageFromParam } from "@/components/Pager";
import { Badge, DescRow, Panel, buttonClass } from "@/components/ui";
import { describeRate, formatCredits, loadCreditRates } from "@/lib/credits";
import { fmtNumber } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditActivity, CreditPack, OfficerOverview, Payment, Plan } from "@/lib/types";

const HISTORY_PER_PAGE = 20;
const PAYMENTS_PER_PAGE = 10;

/**
 * The money side of one account: what is left, how to move it, where it went,
 * and what was paid for it.
 *
 * This is where a customer's credit history lives, and the only place it lives -
 * the Plans & credits section leads with one row per customer and links here
 * rather than interleaving everybody's movements into one list. Both tables come
 * from the shared components in ../../tables, so the same money is never
 * formatted two ways.
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
  const historyRange = pageRange(historyPage, HISTORY_PER_PAGE);
  const paymentsRange = pageRange(paymentsPage, PAYMENTS_PER_PAGE);

  let historyQuery = admin
    .from("credit_activity")
    .select("*", { count: "exact" })
    .eq("user_id", id)
    .order("created_at", { ascending: false })
    .range(historyRange.from, historyRange.to);
  if (flow === "in") historyQuery = historyQuery.gt("amount", 0);
  if (flow === "out") historyQuery = historyQuery.lt("amount", 0);

  const [
    { data: history, count: historyCount },
    { data: payments, count: paymentCount },
    { data: plans },
    { data: packs },
    rates,
    settings,
  ] = await Promise.all([
    historyQuery,
    admin
      .from("payments")
      .select("*", { count: "exact" })
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .range(paymentsRange.from, paymentsRange.to),
    admin.from("plans").select("id, name"),
    admin.from("credit_packs").select("id, name"),
    loadCreditRates(admin),
    loadSettings(admin),
  ]);

  const historyRows = (history ?? []) as CreditActivity[];
  const paymentRows = (payments ?? []) as Payment[];
  const planName = new Map(
    ((plans ?? []) as Pick<Plan, "id" | "name">[]).map((plan) => [plan.id, plan.name]),
  );
  const packName = new Map(
    ((packs ?? []) as Pick<CreditPack, "id" | "name">[]).map((pack) => [pack.id, pack.name]),
  );

  const balance = Number(overview.credits ?? 0);
  const lines = historyCount ?? historyRows.length;

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
              {fmtNumber(lines)} line{lines === 1 ? "" : "s"}
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

          {/* `lines` is the count AFTER the filter, so a filter that matches
              nothing and a page past the end of the matches read differently. */}
          <CreditLedgerTable
            rows={historyRows}
            emptyTitle={
              lines > 0
                ? "That page is past the end of the history"
                : flow
                  ? "Nothing of that kind yet"
                  : "No movements yet"
            }
            emptyDescription={
              lines > 0
                ? "Use the page links below to get back."
                : "Add credits on the right, or wait for their first search to be charged."
            }
          />

          {lines > 0 ? (
            <Pager
              className="border-t border-divider px-5 py-3"
              page={historyPage}
              total={lines}
              pageSize={HISTORY_PER_PAGE}
              noun="lines"
              href={{ path: base, params: carry, pageKey: "cpage" }}
            />
          ) : null}
        </Panel>

        <Panel
          title="Payments"
          description="What this account has paid for, newest first."
          bodyClassName="p-0"
        >
          <PaymentsTable
            rows={paymentRows}
            planName={planName}
            packName={packName}
            emptyTitle={
              (paymentCount ?? 0) > 0 ? "That page is past the end of the list" : "No payments yet"
            }
            emptyDescription={
              (paymentCount ?? 0) > 0
                ? "Use the page links below to get back."
                : settings.razorpayEnabled
                  ? "Anything they buy in the app shows up here with its order id."
                  : "Online payment is switched off, so everything arrives through Add credits."
            }
          />

          {(paymentCount ?? 0) > 0 ? (
            <Pager
              className="border-t border-divider px-5 py-3"
              page={paymentsPage}
              total={paymentCount ?? paymentRows.length}
              pageSize={PAYMENTS_PER_PAGE}
              noun="payments"
              href={{ path: base, params: carry, pageKey: "ppage" }}
            />
          ) : null}
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel
          title="Balance"
          description="One balance pays for every search and every background check."
          actions={<Badge tone={balanceTone(balance)}>{formatCredits(balance)} left</Badge>}
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

        <Panel
          title="What their actions cost"
          description="Set for everyone, under Plans & credits."
          actions={
            <Link
              href="/admin/plans?tab=rules"
              className="text-xs text-brand-400 hover:underline"
            >
              Change
            </Link>
          }
        >
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
