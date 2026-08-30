import Link from "next/link";
import { Coins, IndianRupee, Settings, TrendingDown, Wallet } from "lucide-react";

import { RateCard } from "./RateCard";
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
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { CREDIT_REASON_LABEL, formatCredits, loadCreditRates } from "@/lib/credits";
import { fmtDateTime, fmtNumber, fmtRelative, initials } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditTransaction, OfficerOverview } from "@/lib/types";

export const metadata = { title: "Credits — Admin" };

export default async function CreditsPage() {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  const [rates, { data: officers }, { data: ledger }, settings] = await Promise.all([
    loadCreditRates(admin),
    admin.from("officer_overview").select("*").eq("role", "officer"),
    // No embed: credit_transactions points at profiles twice - once as the
    // owner, once as the admin who granted - so the name is looked up here.
    admin
      .from("credit_transactions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(40),
    loadSettings(admin),
  ]);

  const rows = (officers ?? []) as OfficerOverview[];
  const movements = (ledger ?? []) as CreditTransaction[];

  const nameOf = new Map(rows.map((row) => [row.id, row.full_name ?? row.email]));

  const outstanding = rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const spentToday = rows.reduce((sum, row) => sum + Number(row.credits_spent_today ?? 0), 0);
  const spentMonth = rows.reduce((sum, row) => sum + Number(row.credits_spent_month ?? 0), 0);
  const empty = rows.filter((row) => Number(row.credits ?? 0) <= 0).length;

  const ranked = [...rows].sort(
    (a, b) => Number(b.credits_spent_month ?? 0) - Number(a.credits_spent_month ?? 0),
  );

  return (
    <>
      <PageHeader
        title="Credits"
        subtitle="One balance pays for everything an officer does. You decide what each action draws from it."
        actions={
          <LinkButton href="/admin/settings" variant="secondary">
            <Settings size={14} />
            Payment settings
          </LinkButton>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Credits outstanding"
          value={formatCredits(outstanding)}
          sub={`Worth about Rs ${(outstanding * settings.creditPriceInr).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
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
        className="mb-5"
        title="How debiting works"
        description="Read this once and the numbers below make sense."
      >
        <div className="grid grid-cols-1 gap-4 text-xs leading-relaxed text-muted lg:grid-cols-3">
          <p>
            <span className="text-ink">Rates are written the way you say them.</span> &ldquo;1 credit
            = 1 manual search&rdquo; is one credit buying one search. &ldquo;1 credit = 2 automatic
            checks&rdquo; is one credit buying two. Both are set below, per action, and either can be
            changed at any time.
          </p>
          <p>
            <span className="text-ink">Nothing is free and nothing is capped.</span> There is no
            per-day or per-month allowance any more. An officer works until the balance runs out,
            then you top them up — or, once the payment gateway is live, they buy more themselves.
          </p>
          <p>
            <span className="text-ink">Every movement is on the ledger.</span> Each debit records
            which truck it was for, so &ldquo;where did my credits go&rdquo; has an answer. The last
            forty movements are at the bottom of this page.
          </p>
        </div>
      </Panel>

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
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

      <Panel
        className="mb-5"
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
              <th className="th text-right">Included with plan</th>
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
                      {officer.included_credits === null
                        ? "--"
                        : formatCredits(officer.included_credits)}
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
