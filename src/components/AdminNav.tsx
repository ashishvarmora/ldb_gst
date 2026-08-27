"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  ClipboardList,
  LayoutDashboard,
  Menu,
  Package,
  Settings,
  Truck,
  Users,
  Gauge,
  X,
} from "lucide-react";

import { cx } from "@/components/ui";

const NAV = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/officers", label: "Officers", icon: Users },
  { href: "/admin/plans", label: "Plans", icon: Package },
  { href: "/admin/trucks", label: "Trucks", icon: Truck },
  { href: "/admin/usage", label: "Usage", icon: Gauge },
  { href: "/admin/alerts", label: "Alerts", icon: Bell },
  { href: "/admin/audit", label: "Audit log", icon: ClipboardList },
  { href: "/admin/settings", label: "Settings", icon: Settings },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
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
                : "text-ink-300 hover:bg-ink-800/70 hover:text-ink-100",
            )}
          >
            <Icon size={16} className="shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminSidebar() {
  return (
    <div className="hidden w-60 shrink-0 border-r border-ink-800 px-3 py-4 lg:block">
      <Brand />
      <div className="mt-5">
        <NavLinks />
      </div>
    </div>
  );
}

export function AdminMobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        className="rounded-lg border border-ink-700 bg-ink-850 p-2 text-ink-200 transition hover:bg-ink-800"
      >
        <Menu size={16} />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="animate-in relative z-10 h-full w-64 border-r border-ink-700 bg-ink-900 px-3 py-4">
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-800 hover:text-ink-100"
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

function Brand() {
  return (
    <Link href="/admin" className="flex items-center gap-2.5 px-1">
      <span className="inline-flex size-8 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
        <Truck size={16} />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold text-white">GST Truck Intel</span>
        <span className="block text-[11px] text-ink-500">Admin console</span>
      </span>
    </Link>
  );
}
