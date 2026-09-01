import Link from "next/link";
import { AlertTriangle, Download, Search } from "lucide-react";

import { loadDailyCalls } from "./ledger";
import { balanceTone } from "../tables";
import { Pager, pageFromParam, pageSlice } from "@/components/Pager";
import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import {
  Avatar,
  Badge,
  EmptyState,
  LinkCard,
  PageHeader,
  Panel,
  PanelAction,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
  cx,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtNumber, fmtRelative, initials, istMonthStart } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview } from "@/lib/types";

export const metadata = { title: "Usage — Admin" };

/** One list on this page now; the call log lives on the log screen. */
const ACCOUNTS_PAGE = 25;

/**
 * Consumption, per account and then call by call.
 *
 * This page owns what accounts have SPENT. Who they are, what plan they are on
 * and how to reach them is the Accounts page's answer, so those columns are not
 * repeated here - the customer's name links across instead. The call table is
 * the shared one, the same component an account's own Activity tab renders.
 */
type UsageSearchParams = {
  accounts?: string;
  sort?: string;
};

/**
 * Four ways to rank the same accounts.
 *
 * Credits spent is the default because it is the money question, but "who has
 * nearly run out" and "who has gone quiet" are the two that lead to action, and
 * neither is visible when the list is only ever sorted by spending.
 */
const USAGE_SORTS = [
  { key: "spent", label: "Spent this month" },
  { key: "today", label: "Spent today" },
  { key: "low", label: "Lowest balance" },
  { key: "quiet", label: "Least active" },
] as const;

type UsageSort = (typeof USAGE_SORTS)[number]["key"];

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<UsageSearchParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const admin = getSupabaseAdmin();

  const sort: UsageSort =
    (USAGE_SORTS.find((option) => option.key === params.sort)?.key ?? "spent") as UsageSort;

  const accountsPage = pageFromParam(params.accounts);
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  const [{ data: overview }, dailyCalls, { count: failedDay }] =
    await Promise.all([
      // Every account, because the totals below are sums of these rows and a
      // page of them would not add up. The table itself is still paged.
      admin.from("officer_overview").select("*").eq("role", "officer"),
      loadDailyCalls(admin, { days: 30 }),
      // Counted over a day rather than over the page on screen: "failures on
      // this page" changed meaning every time somebody turned a page.
      admin
        .from("search_logs")
        .select("id", { count: "exact", head: true })
        .eq("ok", false)
        .gte("created_at", dayAgo),
    ]);

  const rows = (overview ?? []) as OfficerOverview[];
  const failures = failedDay ?? 0;

  const monthStart = istMonthStart();

  const creditsToday = rows.reduce((sum, row) => sum + Number(row.credits_spent_today ?? 0), 0);
  const creditsMonth = rows.reduce((sum, row) => sum + Number(row.credits_spent_month ?? 0), 0);
  const outstanding = rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);

  // Month-to-date call counts come from the same view the account holder sees,
  // so a per-account row and the platform total can never disagree.
  const monthCalls = rows.reduce(
    (acc, row) => {
      acc.manual += Number(row.manual_searches_month ?? 0);
      acc.auto += Number(row.tracking_queries_month ?? 0);
      return acc;
    },
    { manual: 0, auto: 0 },
  );

  const series = buildUsageSeries(dailyCalls, 30);

  const num = (value: unknown) => Number(value ?? 0);
  const ranked = [...rows].sort((a, b) => {
    if (sort === "today") return num(b.credits_spent_today) - num(a.credits_spent_today);
    if (sort === "low") return num(a.credits) - num(b.credits);
    if (sort === "quiet") {
      // Never-active accounts first: they are the ones worth a phone call.
      const at = a.last_active_at ? Date.parse(a.last_active_at) : 0;
      const bt = b.last_active_at ? Date.parse(b.last_active_at) : 0;
      return at - bt;
    }
    return num(b.credits_spent_month) - num(a.credits_spent_month);
  });
  const shown = pageSlice(ranked, accountsPage, ACCOUNTS_PAGE);


  return (
    <>
      <PageHeader
        title="Usage"
        subtitle={`Credits consumed in ${monthStart.slice(0, 7)}. There are no per-day or per-month allowances any more — an account works until its balance runs out.`}
        actions={
          <a href="/admin/usage/export" className={buttonClass("secondary")}>
            <Download size={14} />
            Export CSV
          </a>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Credits spent this month"
          value={formatCredits(creditsMonth)}
          sub={`${formatCredits(creditsToday)} today`}
          tone="brand"
        />
        <StatCard
          label="Credits outstanding"
          value={formatCredits(outstanding)}
          sub="Still held by accounts"
          tone="good"
        />
        <StatCard
          label="LDB calls this month"
          value={fmtNumber(monthCalls.manual + monthCalls.auto)}
          sub={`${fmtNumber(monthCalls.manual)} manual · ${fmtNumber(monthCalls.auto)} automatic`}
        />
        <StatCard
          label="Failed calls (24h)"
          value={fmtNumber(failures)}
          tone={failures > 0 ? "warn" : "neutral"}
          sub={failures > 0 ? "Filter the log below to failures" : "Every call in the last day worked"}
        />
      </div>

      <Panel
        className="mb-5"
        title="LDB calls, last 30 days"
        description="Counted from the credit ledger, so this is exactly what was charged, across every account."
      >
        <UsageChart series={series} />
      </Panel>

      <Panel
        className="mb-2"
        title="Per-account consumption"
        description="Plans, contact details and truck limits are on the Accounts page; top an account up from its own page."
        bodyClassName="p-0"
        actions={<PanelAction href="/admin/officers?sort=spending">Accounts page</PanelAction>}
      >
        {/* Four ways to rank the same accounts. Which one matters depends on
            the question - who owes attention, who is busiest, who has stopped. */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-divider px-4 py-2.5">
          <span className="mr-0.5 text-[11px] font-semibold tracking-wider text-faint uppercase">
            Rank by
          </span>
          {USAGE_SORTS.map(({ key, label }) => (
            <Link
              key={key}
              href={`/admin/usage?sort=${key}`}
              className={cx(
                "inline-flex min-h-8 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap transition",
                sort === key
                  ? "border-brand-500 bg-brand-500/10 text-brand-500"
                  : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink",
              )}
            >
              {label}
            </Link>
          ))}
        </div>

        {shown.length === 0 ? (
          <EmptyState
            title={ranked.length > 0 ? "That page is past the end of the list" : "No accounts yet"}
            description={ranked.length > 0 ? "Use the page links below to get back." : undefined}
          />
        ) : (
          <TableWrap>
            <Thead>
              <th className="th">Account</th>
              <th className="th text-right">Credits left</th>
              <th className="th text-right">Spent today</th>
              <th className="th text-right">Spent this month</th>
              <th className="th text-right">Searches</th>
              <th className="th text-right">Auto checks</th>
              <th className="th">Last active</th>
            </Thead>
            <Tbody>
              {shown.map((account) => (
                <Tr key={account.id}>
                  <td className="td">
                    <Link
                      href={`/admin/officers/${account.id}?tab=activity`}
                      className="group flex items-center gap-2.5"
                    >
                      <Avatar size="sm" text={initials(account.full_name, account.email)} />
                      <span className="min-w-0">
                        <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                          {account.full_name ?? account.email}
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
                    {formatCredits(account.credits_spent_today)}
                  </td>
                  <td className="td text-right text-sm font-medium tabular-nums text-ink">
                    {formatCredits(account.credits_spent_month)}
                  </td>
                  <td className="td text-right text-sm tabular-nums text-muted">
                    {fmtNumber(account.manual_searches_month)}
                  </td>
                  <td className="td text-right text-sm tabular-nums text-muted">
                    {fmtNumber(account.tracking_queries_month)}
                  </td>
                  <td className="td text-xs whitespace-nowrap text-muted">
                    {fmtRelative(account.last_active_at)}
                  </td>
                </Tr>
              ))}
            </Tbody>
          </TableWrap>
        )}
      </Panel>

      <Pager
        className="mt-3 mb-5"
        page={accountsPage}
        pageSize={ACCOUNTS_PAGE}
        total={ranked.length}
        noun="accounts"
        // Two lists on one page, so each keeps the other's page number and the
        // call filters.
        href={{ path: "/admin/usage", params: { sort }, pageKey: "accounts" }}
      />

      {/*
        "Every LDB call" was here as a filtered search_logs list with its own
        source and outcome dropdowns - a fourth copy of a list that now has one
        home. Naming it and carrying the number that would make somebody look is
        more use than the list itself in a page about consumption.
      */}
      <div className="space-y-2">
        <LinkCard
          href="/admin/logs?type=searches"
          icon={<Search size={16} />}
          title="Every search and background check"
          description="Across all accounts, filterable by account, truck or day."
        />
        {failures > 0 ? (
          <LinkCard
            href="/admin/logs?type=searches&status=failed"
            icon={<AlertTriangle size={16} />}
            title="Failed calls in the last day"
            description="Usually a registration number the toll network cannot answer for."
            value={fmtNumber(failures)}
            tone="warn"
          />
        ) : null}
      </div>
    </>
  );
}
