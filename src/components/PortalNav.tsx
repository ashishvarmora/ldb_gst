"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderOpen, Gift, History, Home, Rows3, Search, Truck, Wallet } from "lucide-react";

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
  // Next to My plan on purpose: that page has the balance, this one has where
  // it went, and the pair is read in that order.
  { href: "/portal/activity", label: "Activity", icon: History },
  { href: "/portal/referrals", label: "Invite and earn", icon: Gift },
] as const;

/**
 * Home, Search, My trucks, Records - then the account, which is not a route.
 *
 * Five is the most a bottom bar can hold before the labels stop being legible
 * on a small phone, and every one of these four is daily work: Records is the
 * product, Search is how work starts, My trucks is what is being watched.
 *
 * The fifth slot used to be My plan and is now the profile button, because My
 * plan was one of six account things competing for it - the settings gear was
 * stranded in the header, Invite and earn had no route at all on a phone, and
 * there was nowhere to change your own name. All six are behind the profile
 * button now, with the credit balance and a top-up on top of them, so the slot
 * carries more than the single page it used to.
 *
 * Groups and Activity stay off the bar as before: a folder is set up once, and
 * "where did my credits go" is asked when the balance looks wrong rather than
 * several times a day. Both are in the sidebar on a large screen, and reached
 * from Home and the plan page on a phone.
 */
const TAB_HREFS = ["/portal", "/portal/search", "/portal/trucks", "/portal/records"] as const;
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

/**
 * Thumb-reachable tab bar. A phone is the primary device here.
 *
 * `account` is the profile button and its sheet, built on the server so the
 * balance inside it is already there when the sheet opens. It sits in the fifth
 * slot and is the only item that opens something instead of going somewhere.
 */
export function PortalBottomNav({ account }: { account: React.ReactNode }) {
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
        {account}
      </div>
      {/* Breathing room for iOS home-indicator gestures. */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
