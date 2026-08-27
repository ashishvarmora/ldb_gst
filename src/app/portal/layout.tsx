import Link from "next/link";
import { Search, Settings, ShieldCheck, Truck } from "lucide-react";

import { PortalBottomNav, PortalSidebar } from "@/components/PortalNav";
import { SignOutButton } from "@/components/SignOutButton";
import { Avatar, cx } from "@/components/ui";
import { initials } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { requirePortalSession } from "@/lib/officer";

/** Small "17 / 50" pill. At a glance: how much quota is left today. */
function QuotaPill({
  icon,
  used,
  limit,
  label,
}: {
  icon: React.ReactNode;
  used: number;
  limit: number;
  label: string;
}) {
  const unlimited = limit === -1;
  const ratio = unlimited ? 0 : limit <= 0 ? 1 : used / limit;
  const tone =
    ratio >= 1
      ? "border-bad-500/40 bg-bad-500/12 text-bad-500"
      : ratio >= 0.8
        ? "border-warn-500/40 bg-warn-500/12 text-warn-500"
        : "border-ink-700 bg-ink-850 text-ink-300";

  return (
    <span
      title={label}
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap",
        tone,
      )}
    >
      {icon}
      <span className="font-medium tabular-nums">
        {used.toLocaleString("en-IN")}
        <span className="opacity-60"> / {unlimited ? "∞" : formatLimit(limit)}</span>
      </span>
    </span>
  );
}

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await requirePortalSession();
  const { overview } = session;

  return (
    <div className="flex min-h-screen">
      <PortalSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/85 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <Link href="/portal" className="flex items-center gap-2 lg:hidden">
              <span className="inline-flex size-8 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
                <Truck size={16} />
              </span>
              <span className="text-sm font-semibold text-white">Truck Watch</span>
            </Link>

            <div className="hidden items-center gap-2 lg:flex">
              <QuotaPill
                icon={<Search size={12} />}
                used={overview.manual_searches_today}
                limit={overview.manual_search_limit_per_day}
                label="Manual searches used today"
              />
              <QuotaPill
                icon={<Truck size={12} />}
                used={overview.active_trucks}
                limit={overview.truck_limit}
                label="Trucks under tracking"
              />
              {overview.plan_name ? (
                <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-xs text-brand-400">
                  {overview.plan_name}
                </span>
              ) : (
                <span className="rounded-full border border-bad-500/40 bg-bad-500/12 px-2.5 py-1 text-xs text-bad-500">
                  No plan assigned
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {session.profile.role === "super_admin" ? (
                <Link
                  href="/admin"
                  className="hidden items-center gap-1.5 rounded-lg border border-ink-700 px-2.5 py-1.5 text-xs text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 sm:inline-flex"
                >
                  <ShieldCheck size={13} />
                  Admin console
                </Link>
              ) : null}

              <Link
                href="/portal/settings"
                aria-label="Settings"
                className="rounded-lg border border-ink-700 p-2 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
              >
                <Settings size={15} />
              </Link>

              <span className="hidden text-right sm:block">
                <span className="block text-xs font-medium text-ink-100">
                  {session.profile.full_name ?? "Officer"}
                </span>
                <span className="block text-[11px] text-ink-500">
                  {session.profile.office ?? session.email}
                </span>
              </span>
              <Avatar size="sm" text={initials(session.profile.full_name, session.email)} />
              <SignOutButton />
            </div>
          </div>

          {/* Quota pills move under the title bar on small screens. */}
          <div className="mt-2.5 flex items-center gap-2 overflow-x-auto lg:hidden">
            <QuotaPill
              icon={<Search size={12} />}
              used={overview.manual_searches_today}
              limit={overview.manual_search_limit_per_day}
              label="Manual searches used today"
            />
            <QuotaPill
              icon={<Truck size={12} />}
              used={overview.active_trucks}
              limit={overview.truck_limit}
              label="Trucks under tracking"
            />
            {overview.plan_name ? (
              <span className="rounded-full border border-brand-500/30 bg-brand-500/10 px-2.5 py-1 text-xs whitespace-nowrap text-brand-400">
                {overview.plan_name}
              </span>
            ) : (
              <span className="rounded-full border border-bad-500/40 bg-bad-500/12 px-2.5 py-1 text-xs whitespace-nowrap text-bad-500">
                No plan
              </span>
            )}
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-5 pb-24 sm:px-6 lg:px-8 lg:pb-8">{children}</main>
      </div>

      <PortalBottomNav />
    </div>
  );
}
