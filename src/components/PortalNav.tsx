"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, FolderOpen, Home, Rows3, Search, Truck, Wallet } from "lucide-react";

import { NavSpinner, NavTabPending } from "@/components/NavPending";
import { cx } from "@/components/ui";

/** Everything in the sidebar. */
const NAV = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/search", label: "Search", icon: Search },
  { href: "/portal/trucks", label: "My trucks", icon: Truck },
  { href: "/portal/records", label: "Records", icon: Rows3 },
  { href: "/portal/alerts", label: "Alerts", icon: Bell },
  { href: "/portal/cases", label: "Cases", icon: FolderOpen },
  { href: "/portal/plan", label: "My plan", icon: Wallet },
] as const;

/**
 * Five is the most a bottom bar can hold before the labels stop being legible
 * on a small phone. Records earns its place over Cases: it is the view an
 * officer opens repeatedly, where a case folder is set up once.
 */
const TAB_HREFS = ["/portal", "/portal/search", "/portal/trucks", "/portal/records", "/portal/alerts"] as const;
const TABS = TAB_HREFS.map((href) => NAV.find((item) => item.href === href)!);

function isActive(pathname: string, href: string): boolean {
  if (href === "/portal") return pathname === "/portal";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalSidebar() {
  const pathname = usePathname();

  return (
    <div className="hidden w-56 shrink-0 border-r border-divider px-3 py-4 lg:block">
      <Link href="/portal" className="flex items-center gap-2.5 px-1">
        <span className="inline-flex size-8 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
          <Truck size={16} />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold text-strong">Truck Watch</span>
          <span className="block text-[11px] text-faint">GST officer</span>
        </span>
      </Link>

      <nav className="mt-5 flex flex-col gap-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={cx(
                "flex min-h-10 items-center gap-2.5 rounded-lg px-3 text-sm transition",
                active
                  ? "bg-brand-500/10 font-semibold text-brand-500"
                  : "text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              <Icon size={16} className="shrink-0" />
              {label}
              <NavSpinner />
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

/** Thumb-reachable tab bar. The officer's phone is the primary device. */
export function PortalBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 backdrop-blur lg:hidden"
    >
      <div className="mx-auto flex max-w-lg">
        {TABS.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition",
                active ? "text-brand-500" : "text-muted active:text-ink",
              )}
            >
              {/* A bar on the edge the tab touches reads faster than colour
                  alone, and still works for a colour-blind officer. */}
              <span
                aria-hidden
                className={cx(
                  "absolute inset-x-3 top-0 h-0.5 rounded-full transition",
                  active ? "bg-brand-500" : "bg-transparent",
                )}
              />
              <NavTabPending />
              <Icon size={20} strokeWidth={active ? 2.3 : 1.8} />
              {label}
            </Link>
          );
        })}
      </div>
      {/* Breathing room for iOS home-indicator gestures. */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
