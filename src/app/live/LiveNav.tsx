"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { Database, House, Plus, Receipt, UserRound } from "lucide-react";

import { NavSpinner, NavTabPending } from "@/components/NavPending";
import { LogoBadge } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";
import { cx } from "@/components/ui";

/**
 * Live tracking's navigation (v4, docs/LIVE-PLAN-v4.md §8). THREE tabs:
 *   Home     - trips: "We are sending" | "We are receiving"
 *   Masters  - drivers, trucks, warehouses
 *   Profile  - Live's own profile (/live/profile, v5): settings, alerts, logbook (v6)
 * "Trips" duplicated Home and "New trip" sat idle most of the day, so both
 * went; the one New-trip entry point is the "+" in the Home header (and the
 * sidebar button on desktop). The notch is re-drawn for 3 tabs in live.css.
 */

const NAV = [
  { href: "/live/trips", label: "Home", icon: House },
  { href: "/live/masters", label: "Masters", icon: Database },
  { href: "/live/profile", label: "Profile", icon: UserRound },
];

function isActive(path: string, href: string) {
  if (href === "/live/trips") return path.startsWith("/live/trips") || path === "/live" || path === "/live/today";
  if (href === "/live/masters") return path.startsWith("/live/masters") || path.startsWith("/live/places") || path.startsWith("/live/drivers") || path.startsWith("/live/fleet");
  if (href === "/live/profile") return path.startsWith("/live/profile") || path.startsWith("/live/history") || path.startsWith("/live/activity") || path.startsWith("/live/logbook");
  return path === href || path.startsWith(`${href}/`);
}

export function LiveSidebar({ brandName }: { brandName: string }) {
  const pathname = usePathname();
  return (
    <aside className="portal-sidebar hidden w-56 shrink-0 border-r border-divider lg:block">
      <div className="sticky top-0 flex h-dvh flex-col px-4 py-6">
        <Link href="/live" className="app-sidebar-brand">
          <LogoBadge size="sm" />
          <span>
            {brandName}
            <small>Live tracking</small>
          </span>
        </Link>
        <Link href="/live/trips/new" className="live-cta live-cta-sm mb-3 justify-center">
          <Plus size={15} /> New trip
        </Link>
        <nav className="app-sidebar-links" aria-label="Live tracking">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={isActive(pathname, href) ? "page" : undefined}>
              <Icon size={19} />
              {label}
              <NavSpinner />
            </Link>
          ))}
        </nav>
        <Link href="/portal" className="live-switch-side">
          <Receipt size={18} />
          <span>
            Toll tracking
            <small>Switch app</small>
          </span>
        </Link>
        <div className="mt-auto border-t border-divider pt-4">
          <SignOutButton variant="ghost" className="w-full" />
        </div>
      </div>
    </aside>
  );
}

export function LiveBottomNav() {
  const pathname = usePathname();
  return (
    <>
      <nav
        aria-label="Live tracking"
        style={{ "--active-tab": Math.max(0, NAV.findIndex((item) => isActive(pathname, item.href))) } as CSSProperties}
        className="portal-bottom-nav live-bottom-nav app-chrome fixed z-40 app-bar lg:hidden"
      >
        <div className="app-tab-bar mx-auto flex max-w-lg items-stretch">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                aria-current={active ? "page" : undefined}
                className={cx("app-tab", active && "app-tab-active")}
              >
                <NavTabPending />
                <span className="app-tab-icon">
                  <Icon size={21} strokeWidth={active ? 2.3 : 1.7} />
                </span>
                <span>{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
