"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, Gift, Home, Rows3, Search, Truck, Wallet } from "lucide-react";

import { NavSpinner, NavTabPending } from "@/components/NavPending";
import { cx } from "@/components/ui";

/** Everything in the sidebar. Alerts live under the bell in the header. */
const NAV = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/search", label: "Search", icon: Search },
  { href: "/portal/trucks", label: "My trucks", icon: Truck },
  { href: "/portal/records", label: "Records", icon: Rows3 },
  // The route keeps its /cases path - the table behind it is truck_groups and
  // the label is what a customer reads, so only the label is neutral wording.
  { href: "/portal/cases", label: "Groups", icon: FolderOpen },
  { href: "/portal/plan", label: "My plan", icon: Wallet },
  { href: "/portal/referrals", label: "Invite and earn", icon: Gift },
] as const;

/**
 * Home, Search, My trucks, Records, My plan. Five is the most a bottom bar can
 * hold before the labels stop being legible on a small phone, so Folders stays
 * in the sidebar only: a folder is set up once, where My plan is where the
 * credit balance is topped up and everything stops without it.
 *
 * Invite and earn is left out for the same reason. It is reached on a phone
 * from the card on Home, the plan page and Settings, all of which can say what
 * it is worth - which a one-word tab label never could.
 */
const TAB_HREFS = ["/portal", "/portal/search", "/portal/trucks", "/portal/records", "/portal/plan"] as const;
const TABS = TAB_HREFS.map((href) => NAV.find((item) => item.href === href)!);

function isActive(pathname: string, href: string): boolean {
  if (href === "/portal") return pathname === "/portal";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalSidebar({
  brandName,
  /** False hides Invite and earn, matching the page, which shows nothing. */
  referralsEnabled,
}: {
  brandName: string;
  referralsEnabled: boolean;
}) {
  const pathname = usePathname();
  const items = NAV.filter((item) => referralsEnabled || item.href !== "/portal/referrals");

  return (
    <div className="hidden w-56 shrink-0 border-r border-divider px-3 py-4 lg:block">
      <Link href="/portal" className="flex items-center gap-2.5 px-1">
        <span className="inline-flex size-8 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
          <Truck size={16} />
        </span>
        <span className="leading-tight">
          <span className="block truncate text-sm font-semibold text-strong">{brandName}</span>
          <span className="block text-[11px] text-faint">Truck tracking</span>
        </span>
      </Link>

      <nav className="mt-5 flex flex-col gap-0.5">
        {items.map(({ href, label, icon: Icon }) => {
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

/** Thumb-reachable tab bar. A phone is the primary device here. */
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
                  alone, and still works for a colour-blind reader. */}
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
