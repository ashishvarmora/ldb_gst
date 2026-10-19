import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BellRing,
  Coins,
  History,
  MessageSquare,
  Search,
  Truck,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { InviteCard } from "./referrals/InviteCard";
import { InfoTip } from "@/components/InfoTip";
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
import { TopUpLink } from "@/components/CreditBalance";
import {
  TOPUP_HREF,
  creditStanding,
  formatCredits,
  searchesLeft,
  searchesLeftLabel,
} from "@/lib/credits";
import { fmtDate, fmtNumber, fmtRelative, fmtRupees, istToday } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { loadSearchCost, requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertLog, OfficerOverview } from "@/lib/types";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Dashboard — ${brandName}` };
}

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
  const [{ overview, profile }, { referralEnabled }, searchCost] = await Promise.all([
    requirePortalSession(),
    // Already resolved for the layout on this request, so this costs nothing.
    publicSettings(),
    // Same again - the header pill above has already read the search rate.
    loadSearchCost(),
  ]);

  const firstName = (profile.full_name ?? "").split(" ")[0];

  if (!overview.plan_active) {
    return (
      <WelcomeHome overview={overview} firstName={firstName} referralEnabled={referralEnabled} />
    );
  }

  const expiresOn = overview.plan_expires_on;
  const expired = expiresOn !== null && expiresOn < istToday();
  const daysLeft = expiresOn
    ? Math.ceil((new Date(`${expiresOn}T23:59:59+05:30`).getTime() - Date.now()) / 86_400_000)
    : null;

  const standing = creditStanding(overview.credits, searchCost);

  const balanceTone =
    standing === "empty" ? "text-bad-500" : standing === "low" ? "text-warn-500" : "text-strong";

  /**
   * An empty balance gets the banner at the top of the page, because it has
   * stopped the account working and that is page-level news. A merely low one
   * does not: it gets the nudge on the balance itself, further down.
   *
   * Either way there is exactly one way out on this screen. The banner and the
   * credits panel are a few centimetres apart, so whichever of them is
   * speaking is the one that carries the link.
   */
  const bannerCarriesTopUp = standing === "empty";

  return (
    <>
      {/* No subtitle. "Your credits, your plan, and what happened today" was
          the three panels below it - Credits left, Your plan, Today's alerts -
          listed in a sentence the reader had to get past to reach them. */}
      <PageHeader title={firstName ? `Good to see you, ${firstName}` : "Dashboard"} />

      <QuickActions />

      {/* The plan is live, so the only thing that can stop a search here is an
          empty balance - and the fix is one tap away, not a support request. */}
      {bannerCarriesTopUp ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <p className="flex items-start gap-2.5 text-sm text-warn-500">
            <Coins size={16} className="mt-0.5 shrink-0" />
            {/* Not "you have run out": a balance still showing a figure can be
                under the price of one search, and is refused just the same.

                And no longer "your trucks are still being watched". 0038 rated
                automatic checks zero and that sentence was true; 0041 charges
                for them again, so an empty balance stops the watching as well.
                A banner that says the trucks are fine while nothing is being
                checked is the failure this whole screen exists to prevent. */}
            Your balance is too low, so searching is paused and your trucks have stopped being
            checked. Both start again the moment you top up.
          </p>
          {/* Straight to the top-up panel rather than the top of the plan page,
              which on a phone is two screens above the thing being asked for. */}
          <LinkButton href={TOPUP_HREF} size="sm" variant="secondary">
            Top up
          </LinkButton>
        </div>
      ) : null}

      {/*
        THE TELEGRAM WARNING LIVES IN THE LAYOUT NOW, not here.
        
        It used to be this block, and it was both duplicated and weaker. Weaker
        in two ways: it required active_alerts > 0, and it sat after the early
        return for an account with no live plan - so it never fired for exactly
        the accounts most likely to be caught. And it read
        overview.telegram_connected, which is `chat_id is not null and
        is_enabled` and therefore cannot tell a missing chat id from a switched-
        off one, while treating an empty string as connected where the worker
        treats it as missing.

        See AlertDeliveryBanner, which asks the question the way dispatchAlerts
        asks it and appears on every portal page.
      */}

      {/* ------------------------------- 1. credits ---------------------- */}
      <Panel className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          {/*
            WHAT A CREDIT BUYS IS BEHIND THE (i), NOT UNDER THE FIGURE.

            A healthy balance used to carry "Credits pay for every look at a
            lorry, typed or automatic, and never expire" as a line of its own,
            on the first screen of the app, every single visit. It is worth
            knowing once - the rate is set in the console and is nowhere on
            this page - so it is on the number it explains, where somebody
            looking at the number can ask for it.

            The whole block is the (i)'s row rather than just the label, so the
            explanation opens under the figure instead of between the words
            "Credits left" and the figure they belong to.
          */}
          <InfoTip
            label="credits"
            className="min-w-0"
            info={
              <p>
                Credits pay for every look at a lorry — the searches you type and each automatic
                check of a truck you are watching, at{" "}
                {formatCredits(searchCost)} credit{searchCost === 1 ? "" : "s"} a look. They never
                expire, and your plan sets how many trucks may be watched rather than what the
                looking costs.
              </p>
            }
          >
            <span className="block min-w-0">
              <span className="block text-[11px] font-semibold tracking-wider text-muted uppercase">
                Credits left
              </span>
              <span
                className={cx(
                  "mt-1 block text-4xl font-semibold tabular-nums sm:text-5xl",
                  balanceTone,
                )}
              >
                {formatCredits(overview.credits)}
              </span>

              {/* The state, still on the figure and still in the words rather
                  than the colour - and the link only when the banner above is
                  not already offering it. Nothing explanatory left here: a
                  healthy balance now says nothing at all, which is the correct
                  amount to say about a balance that is fine. */}
              {standing === "ok" ? null : (
                <span
                  className={cx(
                    "mt-1.5 flex flex-wrap items-center gap-x-2 text-xs",
                    standing === "empty" ? "text-bad-500" : "text-warn-500",
                  )}
                >
                  <span>
                    {standing === "empty"
                      ? "Too low to search."
                      : `Only ${searchesLeftLabel(searchesLeft(overview.credits, searchCost))} at today's rate.`}
                  </span>
                  {bannerCarriesTopUp ? null : <TopUpLink standing={standing} />}
                </span>
              )}
            </span>
          </InfoTip>
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

        {/* The dashboard stays four totals. Anyone who wants the entries behind
            them is asking a different question, and it has its own page - so
            this is the question, in the words it is asked in, as the link. */}
        <div className="mt-4 border-t border-divider pt-3">
          <Link
            href="/portal/activity"
            className="-mx-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-brand-500 transition hover:bg-brand-500/8 hover:text-brand-600"
          >
            <History size={14} />
            Where did my credits go?
            <ArrowRight size={14} />
          </Link>
        </div>
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
            {/* What the plan cost, once. It read "... a month" off a column
                called price_per_month that had never held a monthly figure, so
                a customer who paid Rs 999 for ninety days was told they were
                on Rs 999 a month. */}
            {overview.price_inr ? (
              <DescRow label="Price">{fmtRupees(overview.price_inr)}</DescRow>
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

      {referralEnabled ? <InviteCard className="mt-5" /> : null}
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
  referralEnabled,
}: {
  overview: OfficerOverview;
  firstName: string;
  referralEnabled: boolean;
}) {
  const ended =
    overview.plan_expires_on !== null && overview.plan_expires_on < istToday();

  /*
   * Kept open, unlike the explanation on every other page: this is the whole
   * of a first-run screen, and folding away the only thing on it would leave a
   * blank page. Trimmed to one line each instead - three short steps read as a
   * short job, three long ones read as homework.
   */
  const steps = [
    {
      icon: Wallet,
      title: "Choose a plan",
      body: "Sets how many trucks you can watch, and comes with credits to start.",
    },
    {
      icon: Search,
      title: "Search a truck",
      body: "Type a registration number to see where it was last picked up.",
    },
    {
      icon: BellRing,
      title: "Get told on Telegram",
      body: "An alert reaches your phone whenever a truck you watch moves.",
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
          /* Automatic checking is what a plan buys, so that is the only thing
             a lapsed plan stops. Searching runs off the credit balance and is
             not gated on a plan at all - saying otherwise sent somebody with
             credits in hand away from a screen they could still use. */
          ended
            ? "Automatic checks and alerts are paused until you renew. Searching still works, and everything already on record is kept."
            : "You are a couple of minutes away from tracking your first truck."
        }
        actions={
          /* Full width on a phone. This is the only thing anyone can usefully
             do on this screen, so it should not be a small button in a corner. */
          <LinkButton href="/portal/plan" variant="primary" className="w-full sm:w-auto">
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

        {/* The header button is above the fold; this one is where someone
            finishes reading the three steps and asks what to do next. On a
            phone that is a whole screen apart. */}
        <div className="border-t border-divider px-5 py-4">
          {/* The line under this button said "Plans start from one month. You
              can change or top up at any time." Every plan card on the page it
              leads to states its own term and price, so the first half was a
              guess about a term this file cannot see - and since a plan carries
              its own duration it was not even reliably true. */}
          <LinkButton href="/portal/plan" variant="primary" className="w-full sm:w-auto">
            {ended ? "Renew your plan" : "Choose your plan"}
          </LinkButton>
        </div>
      </Panel>

      {/* Credits outlive a plan, so a returning customer is told the balance is
          still theirs rather than left wondering what happened to it. One
          clause each for the two facts that are not on screen anywhere - the
          figure, and that it is still spendable. The three sentences this used
          to be spent two of them insisting the credits had not been frozen,
          which nobody had suggested. */}
      {overview.credits > 0 ? (
        <p className="mt-4 text-xs text-muted">
          {formatCredits(overview.credits)} credits are still on your balance — they never expire,
          and still buy a search today.
        </p>
      ) : null}

      {referralEnabled ? <InviteCard className="mt-4" /> : null}
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
    /*
      The count, and only the count.

      Both branches used to end "The bell in the top corner keeps the rest" -
      a pointer to a control that is on screen, repeated on every visit, in a
      panel header. And the empty branch said "Nothing so far today" directly
      above an empty state already headed "No alerts yet". So the description
      is now a figure when there is one and absent when there is not, which is
      what a panel header is for.
    */
    <Panel
      title="Today's alerts"
      description={alertsToday === 0 ? undefined : `${fmtNumber(alertsToday)} so far today`}
      bodyClassName="p-0"
    >
      {alerts.length === 0 ? (
        <EmptyState title="No alerts yet" />
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

/**
 * The four things people open the app to do, as big tiles - phones only.
 *
 * On a desktop the sidebar is always in view and does this job; on a phone the
 * tab bar carries three of the destinations, but "top up" and "message us" are
 * two taps deep in the account sheet, and the first screen of an app is where a
 * thumb expects to find them.
 */
const QUICK_ACTIONS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/portal/search", label: "Search", icon: Search },
  { href: "/portal/trucks", label: "My trucks", icon: Truck },
  { href: TOPUP_HREF, label: "Top up", icon: Wallet },
  { href: "/portal/support", label: "Messages", icon: MessageSquare },
];

function QuickActions() {
  return (
    <nav aria-label="Quick actions" className="stagger mb-5 grid grid-cols-4 gap-2 lg:hidden">
      {QUICK_ACTIONS.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className="pressable flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-2xl border border-line bg-panel px-1 text-center text-[11px] font-medium text-ink [box-shadow:var(--shadow-card)]"
        >
          <span className="inline-flex size-9 items-center justify-center rounded-xl bg-brand-500/10 text-brand-500">
            <Icon size={18} />
          </span>
          {label}
        </Link>
      ))}
    </nav>
  );
}
