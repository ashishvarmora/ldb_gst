import { NavProgress } from "@/components/NavProgress";
import Link from "next/link";
import { ShieldCheck, Truck, UserRound } from "lucide-react";

import { AlertBell, type AlertBellItem } from "@/components/AlertBell";
import { AlertDeliveryBanner, loadAlertDelivery } from "@/components/AlertDeliveryBanner";
import { Announcements } from "@/components/Announcements";
import { LogoMark } from "@/components/Logo";
import { MessageBell } from "@/components/MessageBell";
import { PortalBottomNav, PortalSidebar } from "@/components/PortalNav";
import { InstallPrompt } from "@/components/Pwa";
import { PushAutoOn } from "@/components/PushAutoOn";
import { PullToRefresh } from "@/components/PullToRefresh";
import { SiteFooter, publicSettings } from "@/components/SiteFooter";
import { cx } from "@/components/ui";
import { loadAnnouncementsFor } from "@/lib/announcements";
import { unreadForCustomer } from "@/lib/chat";
import { integrationHealth } from "@/lib/env";
import { formatLimit } from "@/lib/limits";
import { requirePortalSession } from "@/lib/officer";
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
    { brandName, referralEnabled },
    { data: alertRows },
    delivery,
    announcements,
    unreadMessages,
  ] = await Promise.all([
    publicSettings(),
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
    /* What the desk is telling this customer (/admin/announcements). Never
       throws - a fault there renders no banner, never a broken portal. */
    loadAnnouncementsFor({
      id: overview.id,
      plan_id: overview.plan_id,
      plan_active: overview.plan_active,
    }),
    // Replies from the desk this customer has not opened. Drives the badge on
    // Messages in the sidebar. In the batch rather than after it: it depends on
    // nothing above, and on its own it was one more wait on every page.
    unreadForCustomer(getSupabaseAdmin(), session.id),
  ]);

  const alerts = (alertRows ?? []) as AlertBellItem[];



  return (
    <div className="theme-light portal-shell flex min-h-screen">
      <NavProgress />

      <PushAutoOn platformReady={integrationHealth().webPush} appReady={integrationHealth().fcm} />

      <PortalSidebar
        brandName={brandName}
        referralsEnabled={referralEnabled}
        unreadMessages={unreadMessages}
      />

      <div className="portal-workspace flex min-w-0 flex-1 flex-col">


        <header className="portal-header safe-top sticky top-0 z-30 app-bar">
          <AlertDeliveryBanner delivery={delivery} trucks={overview.total_trucks} />

          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <Link
              href="/portal"
              className="-ml-1 flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-1 lg:hidden"
            >
              <LogoMark size={30} className="text-saffron" />
              <span className="truncate font-display text-xl font-extrabold tracking-tight text-strong">
                {brandName}
              </span>
            </Link>

            <div className="hidden items-center gap-2 lg:flex">
              <TruckPill used={overview.active_trucks} limit={overview.truck_limit} />
              <PlanPill name={overview.plan_name} />
            </div>

            <div className="flex shrink-0 items-center gap-2">

              {session.profile.role === "super_admin" ? (
                <Link
                  href="/admin"
                  className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:bg-sunken hover:text-ink lg:inline-flex"
                >
                  <ShieldCheck size={13} />
                  Admin console
                </Link>
              ) : null}
              <MessageBell unread={unreadMessages} href="/portal/support" className="support-chat-trigger" />

              <AlertBell
                alerts={alerts}
                unreadCount={overview.alerts_unread}
                unreadMessages={unreadMessages}
              />


              <span className="hidden lg:inline-flex">
                <Link href="/portal/profile" aria-label="Open profile" className="app-header-avatar"><UserRound size={21} /></Link>
              </span>
            </div>
          </div>
        </header>


        <Announcements items={announcements} />

        <main className="portal-content min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">

          <InstallPrompt />

          <PullToRefresh />
          {children}
        </main>


        <div className="portal-footer pb-24 lg:pb-6">


          <div className="app-hide hidden lg:block">
            <SiteFooter />
          </div>
        </div>
      </div>

      <PortalBottomNav />
    </div>
  );
}
