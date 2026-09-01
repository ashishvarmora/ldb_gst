import Link from "next/link";
import {
  AlertTriangle,
  ClipboardList,
  Bell,
  Coins,
  CreditCard,
  Search,
  Truck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import { loadDailyCalls } from "./usage/ledger";
import { LOW_BALANCE, balanceTone } from "./tables";
import { ShowMore } from "@/components/Pager";
import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import {
  Avatar,
  Badge,
  DescRow,
  EmptyState,
  LinkButton,
  LinkCard,
  PageHeader,
  Panel,
  PanelAction,
  QuotaBar,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtNumber, fmtRelative, fmtRupees, initials, istToday } from "@/lib/format";
import { usageRatio } from "@/lib/limits";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview, Payment } from "@/lib/types";

export const metadata = { title: "Overview — Admin" };

/**
 * A payment sits at 'created' for the few seconds between opening the checkout
 * and the webhook settling it. Past this it is not in flight any more - either
 * the person walked away, or money moved and nothing told us.
 */
const PAYMENT_STUCK_MINUTES = 30;

/** How many attention rows before "Show more". */
const ATTENTION_STEP = 12;

type Tone = "bad" | "warn" | "neutral";

type Attention = { key: string; href: string; who: string; reason: string; tone: Tone };

/** Worst first, so the row that stops someone working is never below the noise. */
const TONE_RANK: Record<Tone, number> = { bad: 0, warn: 1, neutral: 2 };

type PaymentRow = Payment & { profiles: { full_name: string | null; email: string } | null };

export default async function AdminOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ attention?: string }>;
}) {
  await requireSuperAdmin();
  const { attention: attentionParam } = await searchParams;
  const admin = getSupabaseAdmin();

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const stuckBefore = new Date(Date.now() - PAYMENT_STUCK_MINUTES * 60_000).toISOString();
  /* IST boundaries, so "today" and "this month" mean what they mean in the
     office rather than in UTC - a payment at 3am IST belongs to that day. */
  const istNow = new Date(Date.now() + 5.5 * 3_600_000);
  const todayStart = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - 5.5 * 3_600_000,
  ).toISOString();
  const monthStart = new Date(
    Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1) - 5.5 * 3_600_000,
  ).toISOString();

  const [
    { data: overview, error: overviewError },
    dailyCalls,
    { count: failedCalls },
    { data: revenueRows },
    { count: alertsToday },
    { data: stuckPayments, count: stuckCount },
    settings,
  ] = await Promise.all([
    admin.from("officer_overview").select("*").eq("role", "officer"),
    loadDailyCalls(admin, { days: 30 }),
    admin
      .from("search_logs")
      .select("id", { count: "exact", head: true })
      .eq("ok", false)
      .gte("created_at", dayAgo),
    // Money. Captured payments only - a "created" row is an intention, not
    // revenue, and counting it would overstate every figure on the dashboard.
    admin
      .from("payments")
      .select("amount_inr, credits, created_at")
      .eq("status", "captured")
      .gte("created_at", monthStart),
    admin
      .from("alert_logs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", dayAgo),
    // Only the oldest few are listed; the count says how many there really are.
    admin
      .from("payments")
      .select("*, profiles(full_name, email)", { count: "exact" })
      .eq("status", "created")
      .lt("created_at", stuckBefore)
      .order("created_at", { ascending: true })
      .limit(ATTENTION_STEP),
    loadSettings(admin),
  ]);

  /*
   * The financial picture, worked out from captured payments in one pass. Kept
   * here rather than in a view: it is three sums over a month of rows, and
   * another aggregate is another thing that can disagree with the payments
   * table it came from.
   */
  const revenue = ((revenueRows ?? []) as { amount_inr: number; credits: number; created_at: string }[])
    .reduce(
      (acc, row) => {
        const amount = Number(row.amount_inr) || 0;
        acc.month += amount;
        acc.creditsSold += Number(row.credits) || 0;
        acc.payments += 1;
        if (row.created_at >= todayStart) acc.today += amount;
        return acc;
      },
      { month: 0, today: 0, creditsSold: 0, payments: 0 },
    );

  const rows = (overview ?? []) as OfficerOverview[];
  const stuck = (stuckPayments ?? []) as PaymentRow[];

  const active = rows.filter((row) => row.status === "active").length;
  const suspended = rows.length - active;
  const trucks = rows.reduce((sum, row) => sum + row.active_trucks, 0);
  // A signup with no plan is the ordinary starting state now that the
  // default-plan trigger is gone, so it is counted, not flagged as broken.
  const planless = rows.filter((row) => !row.plan_id).length;

  const today = istToday();
  const creditsOutstanding = rows.reduce((sum, row) => sum + Number(row.credits ?? 0), 0);
  const creditsToday = rows.reduce((sum, row) => sum + Number(row.credits_spent_today ?? 0), 0);
  const creditsMonth = rows.reduce((sum, row) => sum + Number(row.credits_spent_month ?? 0), 0);
  const callsMonth = rows.reduce(
    (sum, row) =>
      sum + Number(row.manual_searches_month ?? 0) + Number(row.tracking_queries_month ?? 0),
    0,
  );

  const series = buildUsageSeries(dailyCalls, 30);

  const attention: Attention[] = [];

  for (const account of rows) {
    const who = account.full_name ?? account.email;
    const href = `/admin/officers/${account.id}`;

    if (account.status === "suspended") {
      attention.push({ key: `${account.id}-suspended`, href, who, reason: "Account suspended", tone: "warn" });
      continue;
    }
    if (!account.plan_id) {
      attention.push({
        key: `${account.id}-no-plan`,
        href,
        who,
        reason: "No plan yet — a signup waiting to buy one, or one to assign by hand",
        tone: "neutral",
      });
      continue;
    }
    if (account.plan_expires_on && account.plan_expires_on < today) {
      attention.push({
        key: `${account.id}-expired`,
        href,
        who,
        reason: `Plan expired on ${account.plan_expires_on}`,
        tone: "bad",
      });
      continue;
    }

    const credits = Number(account.credits ?? 0);
    if (credits <= 0) {
      attention.push({
        key: `${account.id}-empty`,
        href,
        who,
        reason: "Out of credits — every search and background check is refused",
        tone: "bad",
      });
      continue;
    }
    if (credits < LOW_BALANCE) {
      attention.push({
        key: `${account.id}-low`,
        href,
        who,
        reason: `${formatCredits(credits)} credits left — top them up before they run dry`,
        tone: "warn",
      });
      continue;
    }
    if (usageRatio(account.active_trucks, account.truck_limit) >= 1) {
      attention.push({
        key: `${account.id}-trucks`,
        href,
        who,
        reason: "Truck limit reached — no more trucks can be added",
        tone: "warn",
      });
    }
  }

  for (const payment of stuck) {
    attention.push({
      key: `payment-${payment.id}`,
      href: `/admin/officers/${payment.user_id}`,
      who: payment.profiles?.full_name ?? payment.profiles?.email ?? "Unknown account",
      reason: `${fmtRupees(payment.amount_inr)} ${payment.kind === "plan" ? "plan" : "credits"} payment started ${fmtRelative(payment.created_at)} and never completed`,
      tone: "bad",
    });
  }

  attention.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);

  const wanted = Number.parseInt(attentionParam ?? "", 10);
  const attentionShown =
    Number.isFinite(wanted) && wanted > ATTENTION_STEP
      ? Math.min(wanted, attention.length)
      : ATTENTION_STEP;

  const busiest = [...rows]
    .sort((a, b) => Number(b.credits_spent_month ?? 0) - Number(a.credits_spent_month ?? 0))
    .slice(0, 6);

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Everything running on ${settings.brandName} right now, across every account.`}
        actions={
          <>
            <LinkButton href="/admin/explore" variant="secondary">
              <Search size={14} />
              Search a truck or account
            </LinkButton>
            <LinkButton href="/admin/officers">Manage accounts</LinkButton>
          </>
        }
      />

      {overviewError ? (
        <Panel className="mb-6 border-bad-500/40">
          <p className="text-sm text-bad-500">
            Could not read <code className="font-mono">officer_overview</code>:{" "}
            {overviewError.message}
          </p>
          <p className="mt-2 text-xs text-muted">
            Run every file in <code className="font-mono">supabase/migrations</code> against your
            Supabase project, then reload.
          </p>
        </Panel>
      ) : null}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <StatCard
          label="Accounts"
          value={rows.length}
          sub={`${active} active · ${suspended} suspended`}
          icon={<Users size={15} />}
        />
        <StatCard
          label="Waiting on a plan"
          value={fmtNumber(planless)}
          sub={planless > 0 ? "Signed up, nothing bought yet" : "Everyone has a plan"}
          tone={planless > 0 ? "warn" : "neutral"}
          icon={<UserPlus size={15} />}
        />
        <StatCard
          label="Trucks tracked"
          value={fmtNumber(trucks)}
          sub="Across all accounts"
          tone="brand"
          icon={<Truck size={15} />}
        />
        <StatCard
          label="Credits outstanding"
          value={formatCredits(creditsOutstanding)}
          sub="Held by accounts right now"
          tone="brand"
          icon={<Wallet size={15} />}
        />
        <StatCard
          label="Credits spent today"
          value={formatCredits(creditsToday)}
          sub={`${formatCredits(creditsMonth)} this month`}
          icon={<Coins size={15} />}
        />
        <StatCard
          label="Alerts (24h)"
          value={fmtNumber(alertsToday ?? 0)}
          sub={
            (failedCalls ?? 0) > 0
              ? `${fmtNumber(failedCalls ?? 0)} failed LDB call${failedCalls === 1 ? "" : "s"}`
              : "No failed LDB calls"
          }
          tone={(failedCalls ?? 0) > 0 ? "warn" : "neutral"}
          icon={<Bell size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title="Platform usage, last 30 days"
            description={`Every charged LDB call, split by manual and automatic. ${fmtNumber(callsMonth)} so far this month.`}
            actions={<PanelAction href="/admin/usage">Call by call</PanelAction>}
          >
            <UsageChart series={series} />
          </Panel>

          <Panel
            title="Busiest accounts this month"
            description="The top six by credits spent. The usage report has the rest, and their plans and contact details are on the Accounts page."
            bodyClassName="p-0"
            actions={<PanelAction href="/admin/usage">Full usage report</PanelAction>}
          >
            {busiest.length === 0 ? (
              <EmptyState
                title="No accounts yet"
                description="Create an account to get started."
                action={<LinkButton href="/admin/officers">Go to accounts</LinkButton>}
              />
            ) : (
              <TableWrap>
                <Thead>
                  <th className="th">Account</th>
                  <th className="th">Trucks</th>
                  <th className="th text-right">Credits left</th>
                  <th className="th text-right">Spent this month</th>
                </Thead>
                <Tbody>
                  {busiest.map((account) => (
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
                              {account.office ?? account.district ?? "--"}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="td">
                        <QuotaBar used={account.active_trucks} limit={account.truck_limit} />
                      </td>
                      <td className="td text-right">
                        <Badge tone={balanceTone(account.credits)}>
                          {formatCredits(account.credits)}
                        </Badge>
                      </td>
                      <td className="td text-right text-sm tabular-nums text-muted">
                        {formatCredits(account.credits_spent_month)}
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
            title="Needs attention"
            description={
              attention.length === 0
                ? "Nobody is blocked, and no payment is hanging."
                : `${attention.length} item${attention.length === 1 ? "" : "s"} to look at.`
            }
            bodyClassName="p-0"
          >
            {attention.length === 0 ? (
              <EmptyState
                title="All clear"
                description="Every account is running, and every payment finished."
              />
            ) : (
              <>
                <ul className="divide-y divide-divider">
                  {attention.slice(0, attentionShown).map((item) => (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        className="flex items-start gap-3 px-5 py-3 transition hover:bg-raised/60"
                      >
                        {item.key.startsWith("payment-") ? (
                          <CreditCard size={15} className="mt-0.5 shrink-0 text-bad-500" />
                        ) : (
                          <AlertTriangle
                            size={15}
                            className={
                              item.tone === "bad"
                                ? "mt-0.5 shrink-0 text-bad-500"
                                : item.tone === "warn"
                                  ? "mt-0.5 shrink-0 text-warn-500"
                                  : "mt-0.5 shrink-0 text-faint"
                            }
                          />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm text-ink">{item.who}</span>
                          <span className="block text-xs text-muted">{item.reason}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
                {attention.length > attentionShown ? (
                  <div className="border-t border-divider px-3 py-2">
                    <ShowMore
                      href={`/admin?attention=${attentionShown + ATTENTION_STEP}`}
                      remaining={attention.length - attentionShown}
                    />
                  </div>
                ) : null}
              </>
            )}
          </Panel>

          {(stuckCount ?? 0) > stuck.length ? (
            <Panel bodyClassName="px-5 py-3">
              <p className="text-xs text-muted">
                {fmtNumber(stuckCount ?? 0)} payments are still at “created”. The oldest{" "}
                {stuck.length} are listed above.
              </p>
            </Panel>
          ) : null}

          {/*
            The last eight audit entries used to sit here. A dashboard is for
            deciding whether to look closer, not for reading a log eight lines
            at a time - so this names the log and links to it, and the space
            goes to the money instead.
          */}
          <Panel
            title="Money this month"
            description="Captured payments only. A payment still at “created” is an intention, not revenue."
          >
            <dl className="space-y-0">
              <DescRow label="Received today">{fmtRupees(revenue.today)}</DescRow>
              <DescRow label="Received this month">{fmtRupees(revenue.month)}</DescRow>
              <DescRow label="Payments this month">{fmtNumber(revenue.payments)}</DescRow>
              <DescRow label="Credits sold">{fmtNumber(revenue.creditsSold)}</DescRow>
              <DescRow label="Credits held by accounts">{fmtNumber(creditsOutstanding)}</DescRow>
            </dl>
          </Panel>

          <LinkCard
            href="/admin/logs"
            icon={<ClipboardList size={16} />}
            title="Logs"
            description="Every search, alert and console change — filter by account, truck or day."
          />
        </div>
      </div>
    </>
  );
}
