"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CreditCard,
  FolderOpen,
  Gift,
  History,
  Home,
  MessageSquare,
  ReceiptText,
  Search,
  Truck,
  Wallet,
} from "lucide-react";

import { NavSpinner, NavTabPending } from "@/components/NavPending";
import { SignOutButton } from "@/components/SignOutButton";
import { cx } from "@/components/ui";

/** Everything in the sidebar. Alerts live under the bell in the header. */
const NAV = [
  { href: "/portal", label: "Home", icon: Home },
  { href: "/portal/search", label: "Search", icon: Search },
  { href: "/portal/trucks", label: "My trucks", icon: Truck },
  /*
   * Records is gone, not moved. It was a fourth way to read the same
   * truck_events rows - a view switch, four filters and a fold of pattern
   * charts on top of a flat log - and the owner's verdict was that a customer
   * does not need that complexity. What it was actually opened for survives in
   * the three places that were already better at it: a truck's own page and its
   * search result both list that truck's whole history, and a group lists every
   * truck in it on one timeline.
   */
  // The route keeps its /cases path - the table behind it is truck_groups and
  // the label is what a customer reads, so only the label is neutral wording.
  { href: "/portal/cases", label: "Groups", icon: FolderOpen },
  /*
   * The money group, in the order the questions are actually asked, and each
   * one answering a different one:
   *
   *   My plan         what am I on, and what does it cost
   *   Payments        what have I paid, and what is the reference
   *   Credit history  where did the credits come from and go, per day
   *   Activity        what exactly did the spending buy, charge by charge
   *
   * These were two pages until now, and both were doing three jobs: payment
   * history was a collapsed panel inside My plan, and Activity carried grants
   * and spending together. Splitting them is only an improvement if each still
   * reads as one question, hence the order rather than alphabetically.
   */
  { href: "/portal/plan", label: "My plan", icon: Wallet },
  { href: "/portal/payments", label: "Payments", icon: CreditCard },
  { href: "/portal/credits", label: "Credit history", icon: ReceiptText },
  { href: "/portal/activity", label: "Activity", icon: History },
  { href: "/portal/referrals", label: "Invite and earn", icon: Gift },
  /*
   * Last, and on its own. It is not one of the money questions above and it is
   * not something anybody comes to the portal to do - it is where they go when
   * one of the other pages has not answered them.
   */
  { href: "/portal/support", label: "Messages", icon: MessageSquare },
] as const;

/**
 * Home, Search, My trucks - then the account, which is not a route.
 *
 * FOUR SLOTS, NOT FIVE, and nothing is promoted to backfill the one Records
 * left. Five was the ceiling before labels stop being legible on a small
 * phone, not a quota to fill: the row divides itself with flex-1, so three
 * links and the profile button take a quarter each - 97px on a 390px screen
 * against the 78px they had at five - and "My trucks" stopped being the label
 * closest to wrapping. The candidates for a fourth are all wrong for a thumb:
 * a folder is set up once, and "where did my credits go" is asked when the
 * balance looks wrong rather than several times a day.
 *
 * Every one of these three is daily work: Search is how work starts, My trucks
 * is what is being watched, Home is the balance and what today has cost.
 *
 * The last slot is the profile button rather than a page, because My plan was
 * one of six account things competing for it - the settings gear was stranded
 * in the header, Invite and earn had no route at all on a phone, and there was
 * nowhere to change your own name. All six are behind it now, with the credit
 * balance and a top-up on top of them, so the slot carries more than the single
 * page it used to. Groups and the money pages are in the sidebar on a large
 * screen and behind that button on a phone.
 */
const TAB_HREFS = ["/portal", "/portal/search", "/portal/trucks"] as const;
const TABS = TAB_HREFS.map((href) => NAV.find((item) => item.href === href)!);

function isActive(pathname: string, href: string): boolean {
  if (href === "/portal") return pathname === "/portal";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function PortalSidebar({
  brandName,
  /** False hides Invite and earn, matching the page, which shows nothing. */
  referralsEnabled,
  /** Messages from the desk this customer has not opened yet. */
  unreadMessages = 0,
}: {
  brandName: string;
  referralsEnabled: boolean;
  unreadMessages?: number;
}) {
  const pathname = usePathname();
  const items = NAV.filter((item) => referralsEnabled || item.href !== "/portal/referrals");

  return (
    /*
     * The border stays on the outer box so it runs the whole height of the
     * document; the contents are sticky inside it, so the nav and the sign-out
     * under it are still on screen halfway down a long truck list. Padding
     * moved inwards with them.
     */
    <div className="hidden w-56 shrink-0 border-r border-divider lg:block">
      <div className="sticky top-0 flex h-screen flex-col px-3 py-4">
        <Link href="/portal" className="flex shrink-0 items-center gap-2.5 px-1">
          <span className="inline-flex size-8 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
            <Truck size={16} />
          </span>
          <span className="leading-tight">
            <span className="block truncate text-sm font-semibold text-strong">{brandName}</span>
            <span className="block text-[11px] text-faint">Truck tracking</span>
          </span>
        </Link>

        {/* flex-1 with min-h-0, so a short desktop window scrolls the nav
            rather than pushing the sign-out below the fold - which is the
            whole point of pinning it. */}
        <nav className="mt-5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
          {items.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                className={cx(
                  "flex min-h-10 shrink-0 items-center gap-2.5 rounded-lg px-3 text-sm transition",
                  active
                    ? "bg-brand-500/10 font-semibold text-brand-500"
                    : "text-muted hover:bg-sunken hover:text-ink",
                )}
              >
                <Icon size={16} className="shrink-0" />
                {label}
                {/* Only ever on Messages, and only when there is something to
                    see. A zero badge is a permanent small distraction. */}
                {href === "/portal/support" && unreadMessages > 0 ? (
                  <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] font-semibold text-on-brand tabular-nums">
                    {unreadMessages}
                  </span>
                ) : null}
                <NavSpinner />
              </Link>
            );
          })}
        </nav>

        {/*
          SIGN OUT WAS NOT ON THIS SCREEN AT ALL.

          On a desktop it existed only behind the avatar in the top right - two
          clicks deep, in a panel of ten other rows, and past the bottom edge of
          the window on a laptop - while the sidebar, the one piece of chrome
          that is permanently visible and already carries every other way out of
          a page, had nothing. That is the "sign out shows proper" half of the
          owner's complaint.

          At the foot of a sticky, viewport-high column, so it is at the bottom
          of the sidebar on a short page and still at the bottom of the sidebar
          halfway down a long one. It stays in the account menu as well: that
          is the phone's only route to it, and somebody who opens a panel
          labelled Account looking for the way out has to find it there.
        */}
        <div className="mt-3 shrink-0 border-t border-divider pt-3">
          <SignOutButton variant="secondary" size="sm" className="w-full" />
        </div>
      </div>
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
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line app-bar bg-panel/95 backdrop-blur lg:hidden"
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
                "pressable relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 text-[11px] font-medium transition-colors",
                active ? "text-brand-600" : "text-muted active:text-ink",
              )}
            >
              <NavTabPending />
              {/*
                The active tab's icon sits in a pill, the way Android's own
                navigation bar marks it - shape as well as colour, so it reads
                for a colour-blind reader too. Keyed on the state so the pill
                grows in each time a tab becomes active.
              */}
              <span className="relative inline-flex h-8 w-14 items-center justify-center">
                {active ? (
                  <span
                    aria-hidden
                    key={`pill-${href}`}
                    className="pill-in absolute inset-0 rounded-full bg-brand-500/14"
                  />
                ) : null}
                <Icon
                  size={21}
                  strokeWidth={active ? 2.3 : 1.8}
                  className="relative transition-transform duration-200"
                />
              </span>
              <span className={active ? "font-semibold" : undefined}>{label}</span>
            </Link>
          );
        })}
        {account}
      </div>
      {/* Breathing room for iOS home-indicator gestures. */}
      <div className="h-[var(--sab)]" />
    </nav>
  );
}
