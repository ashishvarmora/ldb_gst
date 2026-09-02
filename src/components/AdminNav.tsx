"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  ClipboardList,
  Gift,
  Coins,
  Database,
  Gauge,
  IndianRupee,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  Truck,
  Users,
  UsersRound,
  X,
} from "lucide-react";

import { NavSpinner } from "@/components/NavPending";
import { cx } from "@/components/ui";

/**
 * Fourteen destinations is too many to scan as one list, so they are three.
 *
 * The grouping is by what the reader came to do, not by what the pages are
 * made of:
 *
 *   ANALYSE    questions with a number for an answer. Money, people, usage.
 *              Nothing here changes anything - it is safe to click on.
 *   OPERATE    the day's work: find an account, fix it, read what happened.
 *   CONFIGURE  the settings that decide how the other two behave.
 *
 * Overview sits above all three because it is the way in rather than a
 * category, and because a heading over a single entry reads as a mistake.
 *
 * The routes under OPERATE and CONFIGURE are unchanged. Renaming a path breaks
 * every bookmark and every link already written against it, so /admin/officers
 * is still /admin/officers even though nobody calls a customer an officer any
 * more - only the word a reader sees is different.
 */
const NAV = [
  {
    group: null,
    items: [{ href: "/admin", label: "Overview", icon: LayoutDashboard }],
  },
  {
    group: "Analyse",
    items: [
      { href: "/admin/finance", label: "Finance", icon: IndianRupee },
      { href: "/admin/users", label: "Users", icon: UsersRound },
      { href: "/admin/usage", label: "Usage", icon: Gauge },
    ],
  },
  {
    group: "Operate",
    items: [
      { href: "/admin/officers", label: "Customers", icon: Users },
      { href: "/admin/trucks", label: "Trucks", icon: Truck },
      { href: "/admin/explore", label: "Explore", icon: Search },
      { href: "/admin/logs", label: "Logs", icon: ClipboardList },
    ],
  },
  {
    group: "Configure",
    items: [
      { href: "/admin/plans", label: "Plans & credits", icon: Coins },
      { href: "/admin/rewards", label: "Rewards", icon: Gift },
      { href: "/admin/alerts", label: "Alert rules", icon: Bell },
      { href: "/admin/storage", label: "Storage", icon: Database },
      { href: "/admin/settings", label: "Settings", icon: Settings },
    ],
  },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  // /admin/credits redirects into the plans section, so it lights the same
  // entry rather than none at all on the way through.
  if (href === "/admin/plans" && pathname.startsWith("/admin/credits")) return true;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-3">
      {NAV.map((section) => (
        <div key={section.group ?? "top"}>
          {section.group ? (
            <p className="mb-1 px-3 text-[10px] font-semibold tracking-widest text-faint uppercase">
              {section.group}
            </p>
          ) : null}
          <div className="flex flex-col gap-0.5">
            {section.items.map(({ href, label, icon: Icon }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition",
                    active
                      ? "bg-brand-500/12 font-medium text-brand-400"
                      : "text-muted hover:bg-sunken/70 hover:text-ink",
                  )}
                >
                  <Icon size={16} className="shrink-0" />
                  {label}
                  <NavSpinner />
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * The product's own name, which an admin sets in settings. This is a client
 * component and cannot read app_settings itself, so the server layout passes it
 * down; until it does, the fallback keeps the sidebar from naming a customer.
 */
const DEFAULT_BRAND = "Rahdari";

export function AdminSidebar({ brandName }: { brandName?: string }) {
  return (
    /* Its own scroller, pinned: fourteen entries plus three headings is taller
       than a laptop viewport, and a sidebar that scrolls the page away from the
       report you are reading is worse than one that scrolls itself. */
    <div className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-divider px-3 py-4 lg:block">
      <Brand brandName={brandName} />
      <div className="mt-5">
        <NavLinks />
      </div>
    </div>
  );
}

export function AdminMobileNav({ brandName }: { brandName?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        className="rounded-lg border border-line bg-raised p-2 text-ink transition hover:bg-sunken"
      >
        <Menu size={16} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-strong/25 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* max-w-[85vw] so the drawer never covers the whole screen on a small
              phone - the strip of dimmed page behind it is what tells a reader
              this closes rather than navigates. */}
          <div className="animate-in relative z-10 flex h-full w-64 max-w-[85vw] flex-col border-r border-line bg-panel px-3 py-4">
            <div className="flex items-center justify-between">
              <Brand brandName={brandName} />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-muted hover:bg-sunken hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>
            <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
              <NavLinks onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Brand({ brandName }: { brandName?: string }) {
  return (
    <Link href="/admin" className="flex items-center gap-2.5 px-1">
      <span className="inline-flex size-8 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
        <Truck size={16} />
      </span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-sm font-semibold text-strong">
          {brandName || DEFAULT_BRAND}
        </span>
        <span className="block text-[11px] text-faint">Admin console</span>
      </span>
    </Link>
  );
}
