import Link from "next/link";
import { Coins, Settings, ShieldCheck, Truck } from "lucide-react";

import { AlertBell, type AlertBellItem } from "@/components/AlertBell";
import { PortalBottomNav, PortalSidebar } from "@/components/PortalNav";
import { SignOutButton } from "@/components/SignOutButton";
import { Avatar, cx } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { initials } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/** Roughly a day of ordinary work - worth a warning colour before it hits zero. */
const LOW_CREDITS = 10;

/** How many rows the bell can show. Enough history to be the only alerts view. */
const BELL_LIMIT = 20;

/**
 * The balance the whole app runs on, on every page. An officer should never
 * have to open the dashboard to find out whether their next search will work.
 */
function CreditPill({ credits }: { credits: number }) {
  const tone =
    credits <= 0
      ? "border-bad-500/40 bg-bad-500/12 text-bad-500"
      : credits < LOW_CREDITS
        ? "border-warn-500/40 bg-warn-500/12 text-warn-500"
        : "border-line bg-raised text-muted";

  return (
    <span
      title="Credits left"
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap",
        tone,
      )}
    >
      <Coins size={12} />
      <span className="font-medium tabular-nums">{formatCredits(credits)}</span>
      <span className="opacity-70">left</span>
    </span>
  );
}

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
    <span className="rounded-full border border-bad-500/40 bg-bad-500/12 px-2.5 py-1 text-xs whitespace-nowrap text-bad-500">
      No plan assigned
    </span>
  );
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortalSession();
  const { overview } = session;

  // Loaded here rather than inside the bell so the panel opens with no wait.
  const { data: alertRows } = await getSupabaseAdmin()
    .from("alert_logs")
    .select("id,title,truck_number,delivered,read_at,created_at")
    .eq("user_id", overview.id)
    .order("created_at", { ascending: false })
    .limit(BELL_LIMIT);

  const alerts = (alertRows ?? []) as AlertBellItem[];

  return (
    <div className="theme-light flex min-h-screen">
      <PortalSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-divider bg-page/85 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <Link
              href="/portal"
              className="-ml-1 flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-1 lg:hidden"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
                <Truck size={16} />
              </span>
              <span className="truncate text-sm font-semibold text-strong">Truck Watch</span>
            </Link>

            <div className="hidden items-center gap-2 lg:flex">
              <CreditPill credits={overview.credits} />
              <TruckPill used={overview.active_trucks} limit={overview.truck_limit} />
              <PlanPill name={overview.plan_name} />
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {session.profile.role === "super_admin" ? (
                <Link
                  href="/admin"
                  className="hidden items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:bg-sunken hover:text-ink sm:inline-flex"
                >
                  <ShieldCheck size={13} />
                  Admin console
                </Link>
              ) : null}

              <AlertBell alerts={alerts} unreadCount={overview.alerts_unread} />

              <Link
                href="/portal/settings"
                aria-label="Settings"
                className="inline-flex size-10 items-center justify-center rounded-lg border border-line bg-panel text-muted transition hover:bg-sunken hover:text-ink"
              >
                <Settings size={15} />
              </Link>

              <span className="hidden text-right sm:block">
                <span className="block text-xs font-medium text-ink">
                  {session.profile.full_name ?? "Officer"}
                </span>
                <span className="block text-[11px] text-faint">
                  {session.profile.office ?? session.email}
                </span>
              </span>
              {/* The avatar is decoration next to the name, so it goes first
                  when the bell needs the room on a phone. */}
              <span className="hidden sm:inline-flex">
                <Avatar size="sm" text={initials(session.profile.full_name, session.email)} />
              </span>
              <SignOutButton />
            </div>
          </div>

          {/* The pills move under the title bar on small screens. */}
          <div className="mt-2.5 flex items-center gap-2 overflow-x-auto lg:hidden">
            <CreditPill credits={overview.credits} />
            <TruckPill used={overview.active_trucks} limit={overview.truck_limit} />
            <PlanPill name={overview.plan_name} />
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:pb-8">{children}</main>
      </div>

      <PortalBottomNav />
    </div>
  );
}
