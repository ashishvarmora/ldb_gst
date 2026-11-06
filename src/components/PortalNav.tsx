"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";
import { Home, Search, Truck, UserRound, MessageSquare } from "lucide-react";
import { NavSpinner, NavTabPending } from "@/components/NavPending";
import { LogoBadge } from "@/components/Logo";
import { SignOutButton } from "@/components/SignOutButton";
import { cx } from "@/components/ui";

const NAV = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/search", label: "Search", icon: Search },
  { href: "/portal/trucks", label: "My Truck", icon: Truck },
  { href: "/portal/profile", label: "Profile", icon: UserRound },
];

function isActive(path: string, href: string) {
  if (href === "/portal") return path === href;
  if (href === "/portal/profile") return path.startsWith("/portal/") && !["/portal/search", "/portal/trucks", "/portal/cases"].some(route => path === route || path.startsWith(`${route}/`));
  return path === href || path.startsWith(`${href}/`) || (href === "/portal/trucks" && path.startsWith("/portal/cases"));
}

export function PortalSidebar({ brandName, unreadMessages = 0 }: { brandName: string; referralsEnabled: boolean; unreadMessages?: number }) {
  const pathname = usePathname();
  return <aside className="portal-sidebar hidden w-56 shrink-0 border-r border-divider lg:block"><div className="sticky top-0 flex h-dvh flex-col px-4 py-6">
    <Link href="/portal" className="app-sidebar-brand"><LogoBadge size="sm" /><span>{brandName}<small>Your road companion</small></span></Link>
    <nav className="app-sidebar-links" aria-label="Primary">{NAV.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={isActive(pathname, href) ? "page" : undefined}><Icon size={21} />{label}<NavSpinner /></Link>)}</nav>
    <div className="app-sidebar-help"><MessageSquare size={24} /><strong>A hand along the way.</strong><p>We’re here when you need us.</p><Link href="/portal/support">Talk to support{unreadMessages > 0 && <span className="app-unread-count">{unreadMessages}</span>}</Link></div>
    <div className="mt-auto border-t border-divider pt-4"><SignOutButton variant="ghost" className="w-full" /></div>
  </div></aside>;
}

export function PortalBottomNav() {
  const pathname = usePathname();
  return <nav aria-label="Primary" style={{ "--active-tab": Math.max(0, NAV.findIndex(item => isActive(pathname, item.href))) } as CSSProperties} className="portal-bottom-nav app-chrome fixed z-40 app-bar lg:hidden"><div className="app-tab-bar mx-auto flex max-w-lg items-stretch">{NAV.map(({ href, label, icon: Icon }) => {
    const active = isActive(pathname, href);
    return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cx("app-tab", active && "app-tab-active")}><NavTabPending /><span className="app-tab-icon"><Icon size={23} strokeWidth={active ? 2.3 : 1.7} /></span><span>{label}</span></Link>;
  })}</div></nav>;
}
