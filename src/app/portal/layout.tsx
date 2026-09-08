import { NavProgress } from "@/components/NavProgress";
import Link from "next/link";
import { ShieldCheck, Truck } from "lucide-react";

import { AccountMenu, type AccountMenuProps } from "@/components/AccountMenu";
import { AlertBell, type AlertBellItem } from "@/components/AlertBell";
import { AlertDeliveryBanner, loadAlertDelivery } from "@/components/AlertDeliveryBanner";
import { CreditPill } from "@/components/CreditBalance";
import { LogoBadge } from "@/components/Logo";
import { PortalBottomNav, PortalSidebar } from "@/components/PortalNav";
import { InstallPrompt } from "@/components/Pwa";
import { SiteFooter, publicSettings } from "@/components/SiteFooter";
import { cx } from "@/components/ui";
import { creditStanding, searchesLeft } from "@/lib/credits";
import { initials } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { loadSearchCost, requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** How many rows the bell can show. Enough history to be the only alerts view. */
const BELL_LIMIT = 20;

/** Small "3 / 10" pill. Trucks still have a hard cap, so this one stays. */
function TruckPill({ used, limit }: { used: number; limit: number }) {
  const unlimited = limit === -1;
  const full = !unlimited && used >= limit;

  return (
    <span
      title="Trucks under tracking"
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap",
        full ? "border-warn-500/40 bg-warn-500/12 text-warn-500" : "border-line bg-raised text-muted",
      )}
    >
      <Truck size={12} />
      <span className="font-medium tabular-nums">
        {used.toLocaleString("en-IN")}
        <span className="opacity-60"> / {unlimited ? "∞" : formatLimit(limit)}</span>
      </span>
    </span>
  );
}

function PlanPill({ name }: { name: string | null }) {
  return name ? (
    <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-xs whitespace-nowrap text-brand-400">
      {name}
    </span>
  ) : (
    /* A fresh account has no plan yet. That is the next step, not a fault, so
       the pill is an invitation in a warning colour rather than an error. */
    <Link
      href="/portal/plan"
      className="rounded-full border border-warn-500/40 bg-warn-500/12 px-2.5 py-1 text-xs whitespace-nowrap text-warn-500 transition hover:bg-warn-500/20"
    >
      Choose a plan
    </Link>
  );
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortalSession();
  const { overview } = session;

  const [
    { brandName, referralEnabled, supportEmail, supportPhone },
    searchCost,
    { data: alertRows },
    delivery,
  ] = await Promise.all([
    publicSettings(),
    // What a search costs, so "low" means "nearly out of searches" rather than
    // a number picked in this file. Cached per request - see loadSearchCost.
    loadSearchCost(),
    // Loaded here rather than inside the bell so the panel opens with no wait.
    getSupabaseAdmin()
      .from("alert_logs")
      .select("id,title,truck_number,delivered,read_at,created_at")
      .eq("user_id", overview.id)
      // Cleared rows are kept in the table for the admin log and the account's
      // own history; the bell is the one surface that stops listing them.
      .is("cleared_at", null)
      .order("created_at", { ascending: false })
      .limit(BELL_LIMIT),
    /* Whether an alert would actually reach this account, for the strip at the
       top of the header. Skipped entirely for an account with no truck yet, because
       that is the one case where the answer cannot change what is shown - see
       AlertDeliveryBanner, which needs a truck before it says anything. A
       round trip to Tokyo is worth avoiding on every page of a fresh account. */
    overview.total_trucks > 0 ? loadAlertDelivery(overview.id) : Promise.resolve("ready" as const),
  ]);

  const alerts = (alertRows ?? []) as AlertBellItem[];

  // The email is the one label every account has - a name and a company are
  // both optional, so neither can be the thing the header depends on.
  const displayName = session.profile.full_name ?? session.email.split("@")[0];

  /**
   * One set of numbers, two triggers: the profile button in the phone's tab bar
   * and the avatar in the desktop header. Built once here so the two can never
   * show different balances, and so the sheet has its figures the instant it
   * opens rather than after a round trip.
   */
  const standing = creditStanding(overview.credits, searchCost);

  const account: Omit<AccountMenuProps, "variant"> = {
    name: displayName,
    email: session.email,
    initials: initials(session.profile.full_name, session.email),
    credits: overview.credits,
    // Classified here, in the one server component that has the rate, so the
    // sheet does not need a threshold of its own to disagree with.
    standing,
    searchesLeft: searchesLeft(overview.credits, searchCost),
    creditsSpentMonth: overview.credits_spent_month,
    activeTrucks: overview.active_trucks,
    truckLimit: overview.truck_limit,
    planName: overview.plan_name,
    planActive: overview.plan_active,
    isSuperAdmin: session.profile.role === "super_admin",
    referralsEnabled: referralEnabled,
    supportEmail,
    supportPhone,
  };

  return (
    <div className="theme-light flex min-h-screen">
      <NavProgress />

      <PortalSidebar brandName={brandName} referralsEnabled={referralEnabled} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          One row on every size now. The phone used to carry a second row of
          three pills under the title, all three of which the profile sheet
          reports better; only the balance is left, because that is the one
          number that decides whether the next tap will work.
        */}
        {/*
          The padding moved off <header> and onto the row below it, so the
          delivery strip can run edge to edge - a warning that stops short of
          both margins reads as a card somebody put on the page, and one that
          spans it reads as an announcement about the whole site.

          INSIDE the sticky block rather than above it: a strip that scrolls
          away is one the reader passes once, and this is the notice that says
          their credits are buying nothing. It costs about 36px of a phone's
          screen and it is gone the moment they fix it.
        */}
        <header className="sticky top-0 z-30 border-b border-divider bg-page/85 backdrop-blur">
          <AlertDeliveryBanner delivery={delivery} trucks={overview.total_trucks} />

          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <Link
              href="/portal"
              className="-ml-1 flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-1 lg:hidden"
            >
              <LogoBadge size="sm" />
              <span className="truncate text-sm font-semibold text-strong">{brandName}</span>
            </Link>

            <div className="hidden items-center gap-2 lg:flex">
              <CreditPill credits={overview.credits} standing={standing} />
              <TruckPill used={overview.active_trucks} limit={overview.truck_limit} />
              <PlanPill name={overview.plan_name} />
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* The balance follows the reader on a phone too, where the pill
                  row it used to sit in is gone. */}
              <span className="lg:hidden">
                <CreditPill credits={overview.credits} standing={standing} />
              </span>

              {account.isSuperAdmin ? (
                <Link
                  href="/admin"
                  className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:bg-sunken hover:text-ink lg:inline-flex"
                >
                  <ShieldCheck size={13} />
                  Admin console
                </Link>
              ) : null}

              <AlertBell alerts={alerts} unreadCount={overview.alerts_unread} />

              {/* Phones get this as the profile button in the tab bar instead,
                  where the thumb already is. */}
              <span className="hidden lg:inline-flex">
                <AccountMenu {...account} variant="avatar" />
              </span>
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
          {/* Offered to a signed-in customer only: somebody who has not got an
              account yet has nothing to open the installed app onto. */}
          <InstallPrompt />
          {children}
        </main>

        {/* Support details belong to a signed-in customer as much as to a
            visitor. The bottom tab bar floats over the page on phones, so the
            footer carries the clearance the main column used to. */}
        <div className="pb-24 lg:pb-6">
          <SiteFooter />
        </div>
      </div>

      <PortalBottomNav account={<AccountMenu {...account} variant="tab" />} />
    </div>
  );
}
