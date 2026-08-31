import { Suspense } from "react";
import Link from "next/link";
import { BellRing, Coins, Search, Send, Wallet } from "lucide-react";

import { SkeletonPanel } from "@/components/Skeleton";
import { publicSettings } from "@/components/SiteFooter";
import {
  Badge,
  DescRow,
  EmptyState,
  LinkButton,
  Mono,
  PageHeader,
  Panel,
  PanelAction,
  cx,
} from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { fmtDate, fmtNumber, fmtRelative, fmtRupees, istToday } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertLog, OfficerOverview } from "@/lib/types";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Dashboard — ${brandName}` };
}

/** Roughly a day of ordinary work - worth a warning colour before it hits zero. */
const LOW_CREDITS = 10;

/**
 * The three things people open the app to check, in the order they matter: how
 * many credits are left and what today used them on, what the plan allows, and
 * what has been raised today. Everything else has its own page.
 *
 * An account with no live plan never gets that far. Nothing on this page can
 * be anything but zero until a plan is bought, so it is answered with a welcome
 * instead - see WelcomeHome below.
 */
export default async function PortalHome() {
  const { overview, profile } = await requirePortalSession();

  const firstName = (profile.full_name ?? "").split(" ")[0];

  if (!overview.plan_active) return <WelcomeHome overview={overview} firstName={firstName} />;

  // Telegram is the only way an alert reaches a phone, so alerts running with
  // no chat id means the account is quietly getting nothing.
  const telegramGap = overview.active_alerts > 0 && !overview.telegram_connected;

  const expiresOn = overview.plan_expires_on;
  const expired = expiresOn !== null && expiresOn < istToday();
  const daysLeft = expiresOn
    ? Math.ceil((new Date(`${expiresOn}T23:59:59+05:30`).getTime() - Date.now()) / 86_400_000)
    : null;

  const balanceTone =
    overview.credits <= 0 ? "text-bad-500" : overview.credits < LOW_CREDITS ? "text-warn-500" : "text-strong";

  return (
    <>
      <PageHeader
        title={firstName ? `Good to see you, ${firstName}` : "Dashboard"}
        subtitle="Your credits, your plan, and what happened today."
      />

      {/* The plan is live, so the only thing that can stop a search here is an
          empty balance - and the fix is one tap away, not a support request. */}
      {overview.credits <= 0 ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <p className="flex items-start gap-2.5 text-sm text-warn-500">
            <Coins size={16} className="mt-0.5 shrink-0" />
            You have run out of credits, so searches and automatic checks are paused.
          </p>
          <LinkButton href="/portal/plan" size="sm" variant="secondary">
            Top up
          </LinkButton>
        </div>
      ) : null}

      {telegramGap ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <Send size={16} className="mt-0.5 shrink-0 text-warn-500" />
          <p className="text-sm text-warn-500">
            Your trucks have alerts running, but Telegram is not connected — nothing is reaching
            your phone. Add your chat id in{" "}
            <Link href="/portal/settings" className="font-medium underline">
              Settings
            </Link>
            .
          </p>
        </div>
      ) : null}

      {/* ------------------------------- 1. credits ---------------------- */}
      <Panel className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">
              Credits left
            </p>
            <p className={cx("mt-1 text-4xl font-semibold tabular-nums sm:text-5xl", balanceTone)}>
              {formatCredits(overview.credits)}
            </p>
            <p className="mt-1.5 text-xs text-muted">
              One balance pays for every search and every automatic check.
            </p>
          </div>
          <LinkButton href="/portal/plan" size="sm" variant="secondary">
            Plan and credits
          </LinkButton>
        </div>

        {/* What today's spend went on, next to the spend itself - the two
            counts add up to it, so they belong in the same block. */}
        <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-divider pt-4 sm:grid-cols-4">
          <Figure label="Used today" value={formatCredits(overview.credits_spent_today)} />
          <Figure label="Used this month" value={formatCredits(overview.credits_spent_month)} />
          <Figure label="Searches today" value={fmtNumber(overview.manual_searches_today)} />
          <Figure label="Checks today" value={fmtNumber(overview.tracking_queries_today)} />
        </dl>
      </Panel>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* ----------------------------- 2. plan ------------------------- */}
        <Panel
          title="Your plan"
          actions={<PanelAction href="/portal/plan">Details</PanelAction>}
          bodyClassName="px-5 py-1.5"
        >
          <dl>
            <DescRow label="Plan">
              {overview.plan_name ?? <span className="text-muted">None yet</span>}
            </DescRow>
            {overview.price_per_month ? (
              <DescRow label="Price">{fmtRupees(overview.price_per_month)} a month</DescRow>
            ) : null}
            <DescRow label="Ends">
              {expiresOn === null ? (
                <span className="text-good-500">No end date</span>
              ) : expired ? (
                <span className="text-bad-500">Expired {fmtDate(expiresOn)}</span>
              ) : (
                <>
                  {fmtDate(expiresOn)}
                  <span className={cx("ml-1", daysLeft !== null && daysLeft <= 14 && "text-warn-500")}>
                    ({daysLeft} day{daysLeft === 1 ? "" : "s"} left)
                  </span>
                </>
              )}
            </DescRow>
            <DescRow label="Trucks">
              {fmtNumber(overview.active_trucks)} of {formatLimit(overview.truck_limit)} under
              tracking
            </DescRow>
          </dl>
        </Panel>

        {/* ----------------------------- 3. today's alerts --------------- */}
        <Suspense fallback={<SkeletonPanel rows={3} />}>
          <TodaysAlertsPanel userId={overview.id} alertsToday={overview.alerts_today} />
        </Suspense>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * The first screen a new customer sees. They have no plan, no credits and no
 * history, so every figure the real dashboard shows would be a zero and every
 * warning would read as a fault they caused. It is a welcome and a first step
 * instead: choose a plan, then search, then get told on Telegram.
 */
function WelcomeHome({
  overview,
  firstName,
}: {
  overview: OfficerOverview;
  firstName: string;
}) {
  const ended =
    overview.plan_expires_on !== null && overview.plan_expires_on < istToday();

  const steps = [
    {
      icon: Wallet,
      title: "Choose a plan",
      body: "The plan sets how many trucks you can keep under tracking and hands you the credits to start with.",
    },
    {
      icon: Search,
      title: "Search a truck",
      body: "Type any registration number to see where it was last picked up. Add it to tracking and its route builds up for you.",
    },
    {
      icon: BellRing,
      title: "Get told on Telegram",
      body: "Connect Telegram in Settings and an alert reaches your phone whenever a truck you watch moves.",
    },
  ];

  return (
    <>
      <PageHeader
        title={
          ended
            ? "Your plan has ended"
            : firstName
              ? `Welcome, ${firstName}`
              : "Welcome"
        }
        subtitle={
          ended
            ? "Searching and automatic checks are paused until you renew. Everything already on record is kept."
            : "You are a couple of minutes away from tracking your first truck."
        }
        actions={
          <LinkButton href="/portal/plan" variant="primary">
            {ended ? "Renew your plan" : "See the plans"}
          </LinkButton>
        }
      />

      <Panel title={ended ? "Pick up where you left off" : "How it works"} bodyClassName="p-0">
        <ol className="divide-y divide-divider">
          {steps.map(({ icon: Icon, title, body }, index) => (
            <li key={title} className="flex gap-3 px-5 py-4">
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
                <Icon size={15} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-strong">
                  <span className="mr-1.5 text-faint tabular-nums">{index + 1}.</span>
                  {title}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      {/* Credits outlive a plan, so a returning customer is told the balance is
          still theirs rather than left wondering what happened to it. */}
      {overview.credits > 0 ? (
        <p className="mt-4 text-xs text-muted">
          {formatCredits(overview.credits)} credits are still on your balance and will be there when
          your plan is live again.
        </p>
      ) : null}

    </>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}

async function TodaysAlertsPanel({
  userId,
  alertsToday,
}: {
  userId: string;
  alertsToday: number;
}) {
  const { data } = await getSupabaseAdmin()
    .from("alert_logs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(5);

  const alerts = (data ?? []) as AlertLog[];

  return (
    <Panel
      title="Today's alerts"
      description={
        alertsToday === 0
          ? "Nothing so far today. The bell in the top corner keeps the rest."
          : `${fmtNumber(alertsToday)} so far today. The bell in the top corner keeps the rest.`
      }
      bodyClassName="p-0"
    >
      {alerts.length === 0 ? (
        <EmptyState
          title="No alerts yet"
          description="Switch an alert on for a truck and anything it reports shows up here."
        />
      ) : (
        <ul className="divide-y divide-divider">
          {alerts.map((alert) => (
            <li key={alert.id} className="px-5 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 text-sm text-ink">{alert.title}</p>
                {alert.delivered ? null : <Badge tone="warn">not sent</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-faint">
                {alert.truck_number ? (
                  <>
                    <Mono>{alert.truck_number}</Mono> ·{" "}
                  </>
                ) : null}
                {fmtRelative(alert.created_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
