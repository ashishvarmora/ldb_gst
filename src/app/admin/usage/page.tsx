import Link from "next/link";
import { Download, Filter } from "lucide-react";

import { loadDailyCalls } from "./ledger";
import { pageRange } from "../pager";
import { SearchLogTable, balanceTone, type SearchLogRow } from "../tables";
import { Select } from "@/components/form";
import { Pager, pageFromParam, pageSlice } from "@/components/Pager";
import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import {
  Avatar,
  Badge,
  EmptyState,
  PageHeader,
  Panel,
  PanelAction,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtNumber, fmtRelative, initials, istMonthStart } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview } from "@/lib/types";

export const metadata = { title: "Usage — Admin" };

/** Two lists on one page, so each carries its own page number. */
const ACCOUNTS_PAGE = 25;
const CALLS_PAGE = 25;

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
  calls?: string;
  source?: string;
  outcome?: string;
};

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<UsageSearchParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const admin = getSupabaseAdmin();

  const source = params.source === "manual" || params.source === "tracking" ? params.source : null;
  const outcome = params.outcome === "ok" || params.outcome === "failed" ? params.outcome : null;

  const accountsPage = pageFromParam(params.accounts);
  const callsPage = pageFromParam(params.calls);
  const { from, to } = pageRange(callsPage, CALLS_PAGE);

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  let callQuery = admin
    .from("search_logs")
    .select("*, profiles(full_name, email)", { count: "exact" })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  if (source) callQuery = callQuery.eq("source", source);
  if (outcome) callQuery = callQuery.eq("ok", outcome === "ok");

  const [{ data: overview }, dailyCalls, { data: recent, count: callCount }, { count: failedDay }] =
    await Promise.all([
      // Every account, because the totals below are sums of these rows and a
      // page of them would not add up. The table itself is still paged.
      admin.from("officer_overview").select("*").eq("role", "officer"),
      loadDailyCalls(admin, { days: 30 }),
      callQuery,
      // Counted over a day rather than over the page on screen: "failures on
      // this page" changed meaning every time somebody turned a page.
      admin
        .from("search_logs")
        .select("id", { count: "exact", head: true })
        .eq("ok", false)
        .gte("created_at", dayAgo),
    ]);

  const rows = (overview ?? []) as OfficerOverview[];
  const calls = (recent ?? []) as SearchLogRow[];
  const callTotal = callCount ?? calls.length;
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

  const ranked = [...rows].sort(
    (a, b) => Number(b.credits_spent_month ?? 0) - Number(a.credits_spent_month ?? 0),
  );
  const shown = pageSlice(ranked, accountsPage, ACCOUNTS_PAGE);

  const filtered = Boolean(source || outcome);

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
        description="Sorted by credits spent this month. Plans, contact details and truck limits are on the Accounts page; top an account up from its own page."
        bodyClassName="p-0"
        actions={<PanelAction href="/admin/officers?sort=spending">Accounts page</PanelAction>}
      >
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
        href={{
          path: "/admin/usage",
          params: { calls: params.calls, source, outcome },
          pageKey: "accounts",
        }}
      />

      <Panel
        title="Every LDB call"
        description="Newest first, across all accounts. Every manual search, plus the background checks that found a movement or failed — a quiet check that changed nothing is charged but not listed."
        bodyClassName="p-0"
      >
        <form
          method="get"
          className="flex flex-wrap items-center gap-2 border-b border-divider px-5 py-3"
        >
          {/* No page number carried: a new filter starts at page 1, because the
              row you were looking at is not on page 4 of a different list. */}
          <Select name="source" defaultValue={source ?? ""} className="w-36 py-1.5 text-xs">
            <option value="">Any kind</option>
            <option value="manual">Manual</option>
            <option value="tracking">Automatic</option>
          </Select>
          <Select name="outcome" defaultValue={outcome ?? ""} className="w-36 py-1.5 text-xs">
            <option value="">Any outcome</option>
            <option value="ok">Worked</option>
            <option value="failed">Failed</option>
          </Select>
          <button type="submit" className={buttonClass("secondary", "sm")}>
            <Filter size={13} />
            Apply
          </button>
          {filtered ? (
            <Link href="/admin/usage" className={buttonClass("ghost", "sm")}>
              Clear
            </Link>
          ) : null}
        </form>

        <SearchLogTable
          rows={calls}
          showAccount
          emptyTitle={
            callTotal > 0
              ? "That page is past the end of the log"
              : filtered
                ? "No calls match those filters"
                : "No calls logged yet"
          }
          emptyDescription={
            callTotal > 0
              ? "Use the page links below to get back."
              : filtered
                ? "Clear the filters to see everything."
                : undefined
          }
        />
      </Panel>

      <Pager
        page={callsPage}
        pageSize={CALLS_PAGE}
        total={callTotal}
        noun="calls"
        href={{
          path: "/admin/usage",
          params: { accounts: params.accounts, source, outcome },
          pageKey: "calls",
        }}
      />
    </>
  );
}
