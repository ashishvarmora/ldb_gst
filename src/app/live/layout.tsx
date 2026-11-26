import Link from "next/link";
import { UserRound } from "lucide-react";

import { AlertBell, type AlertBellItem } from "@/components/AlertBell";
import { AppSwitcher } from "@/components/AppSwitcher";
import { LogoMark } from "@/components/Logo";
import { MessageBell } from "@/components/MessageBell";
import { NavProgress } from "@/components/NavProgress";
import { PushAutoOn } from "@/components/PushAutoOn";
import { publicSettings } from "@/components/SiteFooter";
import { unreadForCustomer } from "@/lib/chat";
import { integrationHealth } from "@/lib/env";
import { isMissingRelation, liveSchemaReady, requireLiveSession } from "@/lib/live/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

import { LiveBottomNav, LiveSidebar } from "./LiveNav";
import { EnableLive } from "./EnableLive";
import "./live.css";

/**
 * /live - the Live tracking app. Same login as the portal, its own space:
 * own header, own navigation, own dashboard. Nothing here reads the toll
 * module's tables and the toll module reads nothing of this.
 *
 * Access: profiles.modules must contain 'live' (0079). Until then every /live
 * route shows the one-tap "Switch on Live tracking" screen instead.
 */

export const metadata = { robots: { index: false, follow: false } };

/** v5: the Live bell lists only Live alerts (alert_logs kind live_*). Never throws. */
async function liveAlerts(userId: string): Promise<AlertBellItem[]> {
  const q = (cols: string) =>
    getSupabaseAdmin().from("alert_logs").select(cols).eq("user_id", userId).like("kind", "live_%").is("cleared_at", null).order("created_at", { ascending: false }).limit(20);
  let { data, error } = await q("id,title,truck_number,delivered,read_at,created_at,url");
  if (error && isMissingRelation(error)) ({ data, error } = await q("id,title,truck_number,delivered,read_at,created_at"));
  return error ? [] : ((data ?? []) as unknown as AlertBellItem[]);
}

export default async function LiveLayout({ children }: { children: React.ReactNode }) {
  const [live, { brandName }, ready81] = await Promise.all([requireLiveSession(), publicSettings(), liveSchemaReady()]);
  const [alerts, unreadMessages] = await Promise.all([
    live.enabled ? liveAlerts(live.ownerId).catch(() => [] as AlertBellItem[]) : Promise.resolve([] as AlertBellItem[]),
    unreadForCustomer(getSupabaseAdmin(), live.session.overview.id).catch(() => 0),
  ]);

  return (
    <div className="theme-light portal-shell live-shell flex min-h-screen">
      <NavProgress />
      <PushAutoOn platformReady={integrationHealth().webPush} appReady={integrationHealth().fcm} />
      {live.enabled ? <LiveSidebar brandName={brandName} /> : null}

      <div className="portal-workspace flex min-w-0 flex-1 flex-col">
        <header className="portal-header safe-top sticky top-0 z-30 app-bar">
          {/* v6: same strip as the toll app (portal layout): brand left on phones, app name as quiet
              text on desktop, then App switcher, Help chat, Bell, Profile. No coloured "Live" pill. */}
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <Link href="/live/sending" className="-ml-1 flex min-h-10 min-w-[7.5rem] shrink-0 items-center gap-2 rounded-lg px-1 lg:hidden">
              <LogoMark size={30} className="text-saffron" />
              <span className="truncate font-display text-xl font-extrabold tracking-tight text-strong">{brandName}</span>
            </Link>
            <p className="hidden text-sm font-semibold text-muted lg:block">Live tracking</p>
            <div className="flex shrink-0 items-center gap-2">
              <AppSwitcher current="live" />
              <MessageBell unread={unreadMessages} href="/portal/support" className="support-chat-trigger" />
              {live.enabled ? <AlertBell alerts={alerts} unreadCount={alerts.filter((a) => a.read_at === null).length} scope="live" /> : null}
              <span className="hidden lg:inline-flex">
                <Link href="/live/profile" aria-label="Open profile" className="app-header-avatar">
                  <UserRound size={21} />
                </Link>
              </span>
            </div>
          </div>
        </header>

        <main className="portal-content live-content min-w-0 flex-1 px-4 py-5 sm:px-6 lg:px-8">
          {!live.available ? (
            <div className="panel mx-auto max-w-lg p-6 text-center">
              <h1 className="text-xl font-bold text-strong">Live tracking is almost ready</h1>
              <p className="mt-2 text-sm text-muted">
                A database update is pending (migration 0079). Once it is applied, this space switches on.
              </p>
              <Link href="/portal" className="mt-4 inline-block text-sm font-semibold text-brand-600">
                Back to Toll tracking
              </Link>
            </div>
          ) : live.enabled && !ready81 ? (
            <div className="panel mx-auto max-w-lg p-6 text-center">
              <h1 className="text-xl font-bold text-strong">Live tracking is being upgraded</h1>
              <p className="mt-2 text-sm text-muted">
                Driver-first tracking needs a database update (migration 0081). Driver links keep working meanwhile.
              </p>
            </div>
          ) : live.enabled ? (
            children
          ) : (
            <EnableLive />
          )}
        </main>
        <div className="pb-28 lg:pb-6" />
      </div>

      {live.enabled ? <LiveBottomNav /> : null}
    </div>
  );
}
