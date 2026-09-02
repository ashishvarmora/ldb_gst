import Link from "next/link";
import {
  AlertTriangle,
  Bell,
  ClipboardList,
  Coins,
  CreditCard,
  Gauge,
  Gift,
  IndianRupee,
  Search,
  Truck,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import { loadDailyCalls } from "./usage/ledger";
import { LOW_BALANCE } from "./tables";
import { MetricCard } from "@/components/charts";
import { ShowMore } from "@/components/Pager";
import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import {
  EmptyState,
  LinkButton,
  LinkCard,
  PageHeader,
  Panel,
  PanelAction,
} from "@/components/ui";
import {
  loadFunnel,
  loadRevenueSeries,
  percentChange,
  resolveRange,
  shiftDate,
  sumBy,
} from "@/lib/analytics";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtNumber, fmtRelative, fmtRupees, istToday } from "@/lib/format";
import { usageRatio } from "@/lib/limits";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview, Payment } from "@/lib/types";

export const metadata = { title: "Overview — Admin" };

/**
 * The way in, and nothing more.
 *
 * This page used to carry a money panel, a credit-source panel and a busiest-
 * accounts table, each a smaller and slightly different copy of a report that
 * already existed elsewhere - and two of them summed a payment status this
 * schema never writes, so they showed Rs 0 for ever without anybody noticing.
 * A number that appears in two places is a number that can be wrong in one of
 * them.
 *
 * So: every figure here is a headline with a link under it, and the report it
 * links to is the only place that figure is worked out. What stays in full is
 * the attention list, because it is the one thing on this console that is not
 * available anywhere else - it is a judgement about which accounts are stuck,
 * assembled from four different tables.
 */

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

  /*
   * "Today" and "this month" in IST, resolved by the same function the reports
   * use rather than by hand-rolled arithmetic here. The old version built the
   * boundaries out of Date.UTC and a 5.5-hour offset in three places, which is
   * three places to get the half-hour wrong.
   */
  const today = istToday();
  const todayRange = resolveRange({ range: "today" });
  const monthRange = resolveRange({ range: "mtd" });
  const lastMonthRange = resolveRange({ range: "lastmonth" });

  const [
    { data: overview, error: overviewError },
    dailyCalls,
    { count: failedCalls },
    todayRevenue,
    monthRevenue,
    lastMonthRevenue,
    funnel,
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
    loadRevenueSeries(admin, todayRange),
    loadRevenueSeries(admin, monthRange),
    loadRevenueSeries(admin, lastMonthRange),
    loadFunnel(admin),
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

  const receivedToday = sumBy(todayRevenue, (row) => row.gross_inr);
  const receivedMonth = sumBy(monthRevenue, (row) => row.gross_inr);
  const receivedLastMonth = sumBy(lastMonthRevenue, (row) => row.gross_inr);

  const rows = (overview ?? []) as OfficerOverview[];
  const stuck = (stuckPayments ?? []) as PaymentRow[];

  const trucks = rows.reduce((sum, row) => sum + row.active_trucks, 0);
  const creditsToday = rows.reduce((sum, row) => sum + Number(row.credits_spent_today ?? 0), 0);
  const creditsMonth = rows.reduce((sum, row) => sum + Number(row.credits_spent_month ?? 0), 0);
  const callsMonth = rows.reduce(
    (sum, row) =>
      sum + Number(row.manual_searches_month ?? 0) + Number(row.tracking_queries_month ?? 0),
    0,
  );

  const series = buildUsageSeries(dailyCalls, 30);

  /* ----------------------------------------------------------------------- */
  /* What is stuck                                                            */
  /* ----------------------------------------------------------------------- */

  const attention: Attention[] = [];

  for (const account of rows) {
    const who = account.full_name ?? account.email;
    const href = `/admin/officers/${account.id}`;

    if (account.status === "suspended") {
      attention.push({
        key: `${account.id}-suspended`,
        href,
        who,
        reason: "Account suspended",
        tone: "warn",
      });
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

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={`Everything running on ${settings.brandName} right now. Every figure below opens the report it comes from.`}
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

      {/* Money first. It is the question that gets asked most, and it was the
          one this page got wrong for longest. */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          label="Received today"
          value={fmtRupees(receivedToday)}
          hint="all methods"
          icon={<IndianRupee size={15} />}
          href="/admin/finance?range=today"
        />
        <MetricCard
          label="Received this month"
          value={fmtRupees(receivedMonth)}
          change={percentChange(receivedMonth, receivedLastMonth)}
          hint={`vs ${fmtRupees(receivedLastMonth)} last month`}
          icon={<CreditCard size={15} />}
          href="/admin/finance?range=mtd"
        />
        <MetricCard
          label="Accounts"
          value={fmtNumber(funnel.total)}
          hint={`${fmtNumber(funnel.paying)} have ever paid`}
          icon={<Users size={15} />}
          href="/admin/users"
        />
        <MetricCard
          label="Never bought"
          value={fmtNumber(funnel.never_bought)}
          hint={funnel.never_bought > 0 ? "signed up, nothing bought" : "everyone has bought"}
          goodWhen="down"
          icon={<UserPlus size={15} />}
          href="/admin/users?stage=never_bought"
        />
        <MetricCard
          label="Credits outstanding"
          value={formatCredits(funnel.credits_held)}
          hint="held by accounts right now"
          goodWhen="neither"
          icon={<Wallet size={15} />}
          href="/admin/finance?section=credits"
        />
        <MetricCard
          label="Credits spent today"
          value={formatCredits(creditsToday)}
          hint={`${formatCredits(creditsMonth)} this month`}
          goodWhen="neither"
          icon={<Coins size={15} />}
          href="/admin/usage"
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

          {/* The four reports, named rather than half-copied. Each carries the
              one number that says whether it is worth opening today. */}
          <div className="grid gap-3 sm:grid-cols-2">
            <LinkCard
              href="/admin/finance"
              icon={<IndianRupee size={16} />}
              title="Finance"
              description="Revenue by day and by method, the credit economy, and every receipt."
              value={fmtRupees(receivedMonth)}
            />
            <LinkCard
              href="/admin/users"
              icon={<Users size={16} />}
              title="Users"
              description="Sign-ups, conversion, and where every account stands right now."
              value={fmtNumber(funnel.total)}
            />
            <LinkCard
              href="/admin/usage"
              icon={<Gauge size={16} />}
              title="Usage"
              description="Who is spending credits, on what, and which calls are failing."
              value={formatCredits(creditsMonth)}
            />
            <LinkCard
              href="/admin/trucks"
              icon={<Truck size={16} />}
              title="Trucks"
              description="Every truck under automatic checking, across all accounts."
              value={fmtNumber(trucks)}
            />
          </div>
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
                        className="flex items-start gap-3 px-4 py-3 transition hover:bg-raised/60 sm:px-5"
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

          <LinkCard
            href="/admin/alerts/log"
            icon={<Bell size={16} />}
            title="Alerts, last 24 hours"
            description={
              (failedCalls ?? 0) > 0
                ? `${fmtNumber(failedCalls ?? 0)} LDB call${failedCalls === 1 ? "" : "s"} failed in the same period.`
                : "No failed LDB calls in the same period."
            }
            value={fmtNumber(alertsToday ?? 0)}
            tone={(failedCalls ?? 0) > 0 ? "warn" : "neutral"}
          />

          <LinkCard
            href="/admin/rewards"
            icon={<Gift size={16} />}
            title="Rewards"
            description="Referral terms and discount codes, and what each has cost."
          />

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
