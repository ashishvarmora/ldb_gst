"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, FolderOpen, Home, Search, Truck } from "lucide-react";

import { cx } from "@/components/ui";

const NAV = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/search", label: "Search", icon: Search },
  { href: "/portal/trucks", label: "My trucks", icon: Truck },
  { href: "/portal/alerts", label: "Alerts", icon: Bell },
  { href: "/portal/cases", label: "Cases", icon: FolderOpen },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/portal") return pathname === "/portal";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalSidebar() {
  const pathname = usePathname();

  return (
    <div className="hidden w-56 shrink-0 border-r border-ink-800 px-3 py-4 lg:block">
      <Link href="/portal" className="flex items-center gap-2.5 px-1">
        <span className="inline-flex size-8 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
          <Truck size={16} />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold text-white">Truck Watch</span>
          <span className="block text-[11px] text-ink-500">GST officer</span>
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
                "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                active
                  ? "bg-brand-500/12 font-medium text-brand-400"
                  : "text-ink-300 hover:bg-ink-800/70 hover:text-ink-100",
              )}
            >
              <Icon size={16} className="shrink-0" />
              {label}
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
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-800 bg-ink-950/95 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-lg">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              className={cx(
                "flex flex-1 flex-col items-center gap-0.5 px-1 py-2.5 text-[10px] transition",
                active ? "text-brand-400" : "text-ink-400 active:text-ink-200",
              )}
            >
              <Icon size={19} strokeWidth={active ? 2.4 : 1.8} />
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
