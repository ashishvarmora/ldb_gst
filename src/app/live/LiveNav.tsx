"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { Database, Plus, Receipt, Route, UserRound, Users } from "lucide-react";

import { NavSpinner, NavTabPending } from "@/components/NavPending";
import { LogoBadge } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";
import { cx } from "@/components/ui";

/**
 * Live tracking's navigation (0081, driver-first). Four tabs, like the Toll
 * app's bottom bar (its notch is drawn for exactly four):
 *   Drivers  - home: every driver, live / last seen / idle
 *   Trips    - open and closed trips, search, today's summary
 *   Masters  - fixed data: drivers, trucks, warehouses & places
 *   Profile  - business details, sharing defaults, notifications
 * "+ Track" (new driver / truck / trip, one screen) is the floating button on
 * Drivers and Trips, and the first link in the desktop sidebar.
 */

const NAV = [
  { href: "/live", label: "Drivers", icon: Users },
  { href: "/live/trips", label: "Trips", icon: Route },
  { href: "/live/masters", label: "Masters", icon: Database },
  { href: "/live/profile", label: "Profile", icon: UserRound },
];

function isActive(path: string, href: string) {
  if (href === "/live") return path === "/live" || path.startsWith("/live/drivers/") || path === "/live/new";
  if (href === "/live/trips") return path.startsWith("/live/trips") || path === "/live/today";
  if (href === "/live/masters") return path.startsWith("/live/masters") || path.startsWith("/live/places") || path.startsWith("/live/fleet");
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
        <Link href="/live/new" className="live-new-trip-side">
          <Plus size={18} /> Track a driver
        </Link>
        <nav className="app-sidebar-links" aria-label="Live tracking">
          {NAV.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} aria-current={isActive(pathname, href) ? "page" : undefined}>
              <Icon size={21} />
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
  const showFab = pathname === "/live" || pathname === "/live/trips";
  return (
    <>
      {showFab ? (
        <Link href="/live/new" className="live-fab lg:hidden" aria-label="Track a driver">
          <Plus size={22} strokeWidth={2.4} />
          <span>Track</span>
        </Link>
      ) : null}
      <nav
        aria-label="Live tracking"
        style={{ "--active-tab": Math.max(0, NAV.findIndex((item) => isActive(pathname, item.href))) } as CSSProperties}
        className="portal-bottom-nav app-chrome fixed z-40 app-bar lg:hidden"
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
                  <Icon size={23} strokeWidth={active ? 2.3 : 1.7} />
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
