"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { LayoutDashboard, MapPinned, Plus, Receipt, Route, Truck } from "lucide-react";

import { NavSpinner, NavTabPending } from "@/components/NavPending";
import { LogoBadge } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";
import { cx } from "@/components/ui";

/**
 * Live tracking's own navigation. Four tabs on a phone (the shared bottom-bar
 * styling draws its notch for exactly four), a sidebar on a desktop. "New trip"
 * is the floating action on the phone and the first link on the desktop.
 */

const NAV = [
  { href: "/live", label: "Today", icon: LayoutDashboard },
  { href: "/live/trips", label: "Trips", icon: Route },
  { href: "/live/places", label: "Places", icon: MapPinned },
  { href: "/live/fleet", label: "Fleet", icon: Truck },
];

function isActive(path: string, href: string) {
  if (href === "/live") return path === "/live";
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
        <Link href="/live/trips/new" className="live-new-trip-side">
          <Plus size={18} /> New trip
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
        <Link href="/live/trips/new" className="live-fab lg:hidden" aria-label="New trip">
          <Plus size={22} strokeWidth={2.4} />
          <span>New trip</span>
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
