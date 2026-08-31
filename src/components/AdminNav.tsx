"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  ClipboardList,
  Coins,
  LayoutDashboard,
  Menu,
  Search,
  Settings,
  Truck,
  Users,
  Gauge,
  X,
} from "lucide-react";

import { NavSpinner } from "@/components/NavPending";
import { cx } from "@/components/ui";

/**
 * Ten destinations, each one a question an admin arrives with.
 *
 * Plans and credits are one entry, not two: what a customer buys and what it
 * costs them to use were separate pages that could only be read together, and
 * the split sent people to the wrong one about half the time. They are tabs
 * inside /admin/plans now.
 *
 * The route is still /admin/officers - renaming a path breaks every bookmark
 * and every link already written against it. Only the word a reader sees
 * changed.
 */
const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/explore", label: "Explore", icon: Search },
  { href: "/admin/officers", label: "Accounts", icon: Users },
  { href: "/admin/plans", label: "Plans & credits", icon: Coins },
  { href: "/admin/trucks", label: "Trucks", icon: Truck },
  { href: "/admin/usage", label: "Usage", icon: Gauge },
  { href: "/admin/alerts", label: "Alert rules", icon: Bell },
  { href: "/admin/audit", label: "Audit log", icon: ClipboardList },
  { href: "/admin/settings", label: "Settings", icon: Settings },
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
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
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
    </nav>
  );
}

/**
 * The product's own name, which an admin sets in settings. This is a client
 * component and cannot read app_settings itself, so the server layout passes it
 * down; until it does, the fallback keeps the sidebar from naming a customer.
 */
const DEFAULT_BRAND = "Truck Watch";

export function AdminSidebar({ brandName }: { brandName?: string }) {
  return (
    <div className="hidden w-60 shrink-0 border-r border-divider px-3 py-4 lg:block">
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
        className="rounded-lg border border-line bg-raised p-2 text-ink transition hover:bg-sunken"
      >
        <Menu size={16} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-strong/25 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="animate-in relative z-10 h-full w-64 border-r border-line bg-panel px-3 py-4">
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
            <div className="mt-5">
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
      <span className="leading-tight">
        <span className="block truncate text-sm font-semibold text-strong">
          {brandName || DEFAULT_BRAND}
        </span>
        <span className="block text-[11px] text-faint">Admin console</span>
      </span>
    </Link>
  );
}
