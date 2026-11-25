import Link from "next/link";
import { Navigation } from "lucide-react";

import { AppSwitcher } from "@/components/AppSwitcher";
import { LogoMark } from "@/components/Logo";
import { NavProgress } from "@/components/NavProgress";
import { PushAutoOn } from "@/components/PushAutoOn";
import { publicSettings } from "@/components/SiteFooter";
import { integrationHealth } from "@/lib/env";
import { requireLiveSession } from "@/lib/live/server";

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

export default async function LiveLayout({ children }: { children: React.ReactNode }) {
  const [live, { brandName }] = await Promise.all([requireLiveSession(), publicSettings()]);

  return (
    <div className="theme-light portal-shell live-shell flex min-h-screen">
      <NavProgress />
      <PushAutoOn platformReady={integrationHealth().webPush} appReady={integrationHealth().fcm} />
      {live.enabled ? <LiveSidebar brandName={brandName} /> : null}

      <div className="portal-workspace flex min-w-0 flex-1 flex-col">
        <header className="portal-header safe-top sticky top-0 z-30 app-bar">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <Link href="/live" className="-ml-1 flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-1 lg:hidden">
              <LogoMark size={30} className="text-saffron" />
              <span className="truncate font-display text-xl font-extrabold tracking-tight text-strong">{brandName}</span>
              <span className="live-chip">
                <Navigation size={11} /> Live
              </span>
            </Link>
            <p className="hidden text-sm font-semibold text-muted lg:block">Live tracking</p>
            <div className="flex shrink-0 items-center gap-2">
              <AppSwitcher current="live" />
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
