"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
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
  MessageSquare,
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
      // Under OPERATE rather than CONFIGURE: answering a customer is the day's
      // work, not a setting.
      { href: "/admin/chat", label: "Messages", icon: MessageSquare },
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

function NavLinks({
  onNavigate,
  unreadMessages = 0,
}: {
  onNavigate?: () => void;
  unreadMessages?: number;
}) {
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
                  {/* Customers waiting on a reply. Same rule as the portal
                      side: shown only when it is not zero. */}
                  {href === "/admin/chat" && unreadMessages > 0 ? (
                    <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-on-brand tabular-nums">
                      {unreadMessages}
                    </span>
                  ) : null}
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

export function AdminSidebar({
  brandName,
  unreadMessages = 0,
}: {
  brandName?: string;
  unreadMessages?: number;
}) {
  return (
    /* Its own scroller, pinned: fourteen entries plus three headings is taller
       than a laptop viewport, and a sidebar that scrolls the page away from the
       report you are reading is worse than one that scrolls itself. */
    <div className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-divider px-3 py-4 lg:block">
      <Brand brandName={brandName} />
      <div className="mt-5">
        <NavLinks unreadMessages={unreadMessages} />
      </div>
    </div>
  );
}

export function AdminMobileNav({
  brandName,
  unreadMessages = 0,
}: {
  brandName?: string;
  unreadMessages?: number;
}) {
  const [open, setOpen] = useState(false);

  /*
   * THE DRAWER HAS TO LEAVE THE HEADER TO BE A DRAWER AT ALL.
   *
   * It is `fixed inset-0`, which everyone reads as "cover the viewport". It
   * did not. The header it is mounted in carries `backdrop-blur`, and
   * backdrop-filter - like transform and filter - makes an element a
   * CONTAINING BLOCK for its fixed-position descendants. So inset-0 resolved
   * against the header, and the whole overlay was laid out inside a 68px-tall
   * strip: the panel came out 68px tall instead of full height, the backdrop
   * dimmed only the header rather than the page, and the navigation spilled
   * out below the box it was supposed to be inside. On a phone it read as a
   * small card stuck to the top of an undimmed page, which is what the owner
   * photographed and reported as the menu being broken.
   *
   * A portal to document.body is the fix that stays fixed: it puts the overlay
   * outside every ancestor, so no future transform, filter or `contain` on
   * anything above it can capture it again. mounted gates it because
   * document.body does not exist while this renders on the server.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  /*
   * The page behind a modal drawer must not scroll. Without this, dragging
   * anywhere outside the 256px panel scrolls the console underneath it, so the
   * reader closes the drawer to find they have lost their place in a long
   * table. Restored on close and on unmount, including when the drawer is open
   * as the route changes.
   */
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  /* Escape closes it, the way every other dismissible layer in this app does. */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const overlay = (
    <div className="fixed inset-0 z-50 flex lg:hidden">
      <div className="fixed inset-0 bg-strong/25 backdrop-blur-sm" onClick={() => setOpen(false)} />
      {/* max-w-[85vw] so the drawer never covers the whole screen on a small
          phone - the strip of dimmed page behind it is what tells a reader
          this closes rather than navigates. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="animate-in relative z-10 flex h-full w-64 max-w-[85vw] flex-col border-r border-line bg-panel px-3 py-4"
      >
        <div className="flex shrink-0 items-center justify-between">
          <Brand brandName={brandName} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close navigation"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-sunken hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto">
          <NavLinks onNavigate={() => setOpen(false)} unreadMessages={unreadMessages} />
        </div>

        {/*
         * OFFICER VIEW LIVES HERE ON A PHONE, AND ONLY HERE.
         *
         * The header's copy of this link is `hidden sm:inline-flex`, and this
         * drawer is the whole of the navigation below that width - so between
         * them there was no way at all to reach the customer-facing side of
         * the product from a phone. Not a cramped way: none. The link was
         * display:none and nothing else on the page pointed at /portal.
         *
         * Pinned under the scroller rather than added to NavLinks, because it
         * leaves the console rather than moving around inside it, and a
         * fourteenth entry in a list of admin destinations is exactly how
         * somebody ends up in the portal without meaning to be.
         */}
        <div className="mt-3 shrink-0 border-t border-line pt-3">
          <Link
            href="/portal"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition hover:bg-sunken/70 hover:text-ink"
          >
            <LayoutDashboard size={16} className="shrink-0" />
            Officer view
            <NavSpinner />
          </Link>
        </div>
      </div>
    </div>
  );

  return (
    <div className="lg:hidden">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open navigation"
        aria-expanded={open}
        /*
         * size-9 rather than p-2, which came out at 34px. Every other control
         * in this console has a 36px floor - see BUTTON_SIZES in ui.tsx - and
         * this is the one a phone user has to hit before they can reach any of
         * them, so it was the worst possible place to be two pixels short.
         */
        className="inline-flex size-9 items-center justify-center rounded-lg border border-line bg-raised text-ink transition hover:bg-sunken"
      >
        <Menu size={16} />
      </button>

      {open && mounted ? createPortal(overlay, document.body) : null}
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
