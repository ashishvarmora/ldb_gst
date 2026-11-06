"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronRight,
  Coins,
  Gift,
  History,
  MessageSquare,
  Receipt,
  ReceiptText,
  Settings,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { SignOutButton } from "@/components/SignOutButton";
import { SupportPanel } from "@/components/SupportLine";
import { Avatar, Badge, QuotaBar, buttonClass, cx } from "@/components/ui";
import { TOPUP_HREF, formatCredits, searchesLeftLabel, type CreditStanding } from "@/lib/credits";

/**
 * Everything about *this account*, behind one control.
 *
 * It exists because the pieces were scattered: a My plan tab in the bottom bar,
 * a settings gear in the header, a referral card repeated on three pages, and
 * no way at all to change your own name. A phone has room for five tabs and all
 * five should be daily work, so the account gets the profile icon instead and
 * everything account-shaped moves in behind it.
 *
 * Nothing here renders a list of its own. Credit history and payments live on
 * the plan page and are linked to with the section already open, so there is
 * one copy of each list rather than a summary that can disagree with it.
 *
 * Order is deliberate, most-asked first: the balance that gates every search,
 * then where it went, then the money records, then the way to earn more, and
 * only then the settings somebody touches once.
 */

export type AccountMenuProps = {
  name: string;
  email: string;
  initials: string;
  credits: number;
  /**
   * Whether that balance is worth mentioning, decided by the layout against
   * the search rate. Passed in rather than worked out here: this is a Client
   * Component and the rate lives in the database.
   */
  standing: CreditStanding;
  /** Whole searches the balance still covers, for saying so in words. */
  searchesLeft: number;
  creditsSpentMonth: number;
  activeTrucks: number;
  truckLimit: number;
  planName: string | null;
  planActive: boolean;
  isSuperAdmin: boolean;
  referralsEnabled: boolean;
  /** Whoever the owner told us to send people to. Either may be blank. */
  supportEmail: string;
  supportPhone: string;
  /** Bottom-bar profile button on a phone, header avatar on a desktop. */
  variant: "tab" | "avatar";
};

type Item = {
  href: string;
  label: string;
  icon: LucideIcon;
  hint: string;
  /** Right-hand flag. Draws the eye to the one item that pays. */
  flag?: string;
};

function itemGroups({
  isSuperAdmin,
  referralsEnabled,
}: Pick<AccountMenuProps, "isSuperAdmin" | "referralsEnabled">): Item[][] {
  /*
   * Each is its own route now, so none of them needs a `show=` to open a
   * section on arrival - the trick that used to be needed here, and the thing
   * that made the old payment link so easy to break.
   */
  const money: Item[] = [
    { href: "/portal/plan", label: "My plan", icon: Wallet, hint: "Balance, renewals and truck limit" },
    {
      /*
       * Its own route now. This pointed at /portal/plan?show=payments#payments,
       * a collapsed panel inside the plan page - and that panel has been moved
       * out, so the link was about to land on a heading that no longer exists.
       */
      href: "/portal/payments",
      label: "Payments",
      icon: Receipt,
      hint: "Every payment, its reference and what it bought",
    },
    {
      href: "/portal/credits",
      label: "Credit history",
      icon: ReceiptText,
      hint: "Credits added, and what was used each day",
    },
    {
      href: "/portal/activity",
      label: "Activity",
      icon: History,
      hint: "Every charge, per truck per day",
    },
  ];

  if (referralsEnabled) {
    money.push({
      href: "/portal/referrals",
      label: "Invite and earn",
      icon: Gift,
      hint: "Credits when someone you invited pays",
      flag: "earn",
    });
  }

  /*
   * ONE ROW, BECAUSE IT IS ONE ROUTE.
   *
   * This listed "My profile" -> /portal/profile/edit and "Settings" ->
   * /portal/settings: two icons, two labels, two descriptions and two hrefs
   * into the same page, one of them an anchor into the other. That is where the
   * owner's "merge /portal/settings and /portal/profile/edit, i guess both
   * are same so" came from - they had been handed two names for one screen by
   * this menu and reasonably assumed there were two screens.
   *
   * Merging them here rather than making the anchors land somewhere more
   * distinct, because there is no distinction to make: the page is three
   * panels, all three of them settings, one of them the profile form. A second
   * row could only ever point at the same page.
   *
   * Both words are kept in the one label on purpose. Somebody hunting for
   * "profile" and somebody hunting for "settings" are looking for the same
   * place, and each needs to see their own word to believe they have found it.
   */
  const account: Item[] = [
    /*
     * MESSAGES IS ONLY REACHABLE FROM HERE ON A PHONE.
     *
     * The bottom bar carries three tabs and this button; the sidebar that
     * carries everything else is lg: and up. So a row missing from this list is
     * a page a phone cannot open at all, which is what happened to Invite and
     * earn once already - see the note above TAB_HREFS in PortalNav.
     *
     * First in the account group, above settings: somebody opening this menu
     * because something has gone wrong is looking for a way to ask about it,
     * not for a form.
     */
    {
      href: "/portal/support",
      label: "Messages",
      icon: MessageSquare,
      hint: "Talk to the team directly",
    },
    {
      href: "/portal/settings",
      label: "Profile and settings",
      icon: Settings,
      hint: "Your details, where alerts go, and backup",
    },
  ];

  if (isSuperAdmin) {
    account.push({
      href: "/admin",
      label: "Admin console",
      icon: ShieldCheck,
      hint: "Manage accounts, plans and pricing",
    });
  }

  return [money, account];
}

export function AccountMenu(props: AccountMenuProps) {
  const {
    name,
    email,
    initials,
    credits,
    standing,
    searchesLeft,
    creditsSpentMonth,
    activeTrucks,
    truckLimit,
    planName,
    planActive,
    supportEmail,
    supportPhone,
    variant,
  } = props;

  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  const sheet = variant === "tab";

  // The layout stays mounted across navigations, so a tap that goes somewhere
  // has to shut the panel it was tapped in.
  useEffect(close, [pathname, close]);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      // The sheet is portalled to <body>, so it is not inside wrapRef and a
      // tap in it would otherwise read as a tap outside.
      if (wrapRef.current?.contains(target) || sheetRef.current?.contains(target)) return;
      close();
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown);

    /* The sheet covers the page, so the page behind it must not scroll under
       the reader's thumb while they are trying to scroll the sheet. */
    const previous = sheet ? document.body.style.overflow : null;
    if (sheet) document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown);
      if (previous !== null) document.body.style.overflow = previous;
    };
  }, [open, close, sheet]);

  const empty = standing === "empty";
  const groups = itemGroups(props);

  /*
   * Built once, mounted two ways. The tab bar carries backdrop-blur, and a
   * blurred ancestor becomes the containing block for its fixed descendants -
   * so a sheet rendered inside it would lay itself out against a 60px-tall bar
   * rather than the viewport. The portal is what puts it on the screen.
   */
  const panel = (
    <>
      {/* Phone only. A sheet that dims the page reads as a layer over it
          rather than part of it, and gives a miss somewhere to land. */}
      {sheet ? (
        <div
          aria-hidden
          onClick={close}
          className="backdrop-in fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      ) : null}

      <div
        ref={sheetRef}
        role="menu"
        aria-label="Account"
        className={cx(
          "z-50 overflow-hidden border border-line bg-panel [box-shadow:var(--shadow-pop)]",
          sheet
            ? "sheet-up fixed inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-3xl border-b-0 pb-[var(--sab)] lg:hidden"
            : /* The 320px dropdown is capped against the viewport as well as
                 anchored to the button. It is the avatar variant, so it is
                 normally on a desktop header - but a narrow window puts the
                 button close enough to the left edge that a fixed 320px panel
                 hangs off the screen, and an absolutely positioned overflow
                 scrolls the whole document sideways rather than itself.

                 CAPPED VERTICALLY TOO, which it was not. The panel is about
                 880px tall with every row in it, and it hung off the bottom of
                 any window shorter than that with no way to scroll to what was
                 missing - on a 1280x800 laptop the thing cut off was the sign
                 out button, 128px below the fold. It is the same fault the
                 phone sheet has, and the shared overflow-hidden above is why
                 neither could be scrolled: 5rem leaves room for the header the
                 panel hangs from and a gap at the bottom. */
              "animate-in absolute top-full right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-5rem)] overflow-y-auto overscroll-contain rounded-xl",
        )}
      >
        {/* A grab handle: the mark every phone uses to say "this is a sheet". */}
        {sheet ? (
          <div aria-hidden className="flex justify-center pt-2.5">
            <span className="h-1 w-10 rounded-full bg-line-strong" />
          </div>
        ) : null}

        {/* ---------------- who you are ---------------- */}
        <div className="flex items-center gap-3 border-b border-divider px-4 py-3.5">
          <Avatar text={initials} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-strong">{name}</span>
            <span className="block truncate text-xs text-faint">{email}</span>
          </span>
          {sheet ? (
            <button
              type="button"
              onClick={close}
              aria-label="Close"
              className="-mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-faint transition hover:bg-sunken hover:text-ink"
            >
              <X size={17} />
            </button>
          ) : null}
        </div>

        {/* ---------------- the numbers that gate everything ---------------- */}
        <div className="border-b border-divider bg-raised/50 px-4 py-3.5">
          <div className="flex items-start justify-between gap-3">
            <span>
              <span className="flex items-center gap-1.5 text-xs font-semibold text-muted">
                <Coins size={11} />
                Credits left
              </span>
              <span
                className={cx(
                  "mt-1 block text-2xl font-semibold tabular-nums",
                  empty
                    ? "text-bad-500"
                    : standing === "low"
                      ? "text-warn-500"
                      : "text-brand-500",
                )}
              >
                {formatCredits(credits)}
              </span>

              {/* What that number means, since the rate it is spent at is not
                  on this screen. Said in words as well as in a colour, and
                  only when it is news - a healthy balance needs no comment. */}
              {standing === "ok" ? null : (
                <span
                  className={cx(
                    "mt-0.5 block text-[11px] font-medium",
                    empty ? "text-bad-500" : "text-warn-500",
                  )}
                >
                  {empty ? "Searching is paused" : `Only ${searchesLeftLabel(searchesLeft)}`}
                </span>
              )}

              <span className="mt-0.5 block text-[11px] tabular-nums text-faint">
                {formatCredits(creditsSpentMonth)} used this month
              </span>
            </span>

            <span className="shrink-0 text-right">
              {planName ? (
                <Badge tone={planActive ? "good" : "warn"}>
                  {planActive ? planName : "expired"}
                </Badge>
              ) : (
                <Badge tone="warn">no plan</Badge>
              )}
              <span className="mt-2.5 block">
                <QuotaBar used={activeTrucks} limit={truckLimit} label="Trucks" />
              </span>
            </span>
          </div>

          {/* This panel's own top-up, a full-width button two lines under the
              balance - so no TopUpLink beside the number as well. The same
              warning twice inside one block is noise; the sentence above says
              what is wrong and this says what to do about it.

              THE BALANCE OUTRANKS THE PLAN when the balance is not ok, which
              is the reverse of what this did. "Choose a plan" used to win on
              any account without one, so a lapsed customer down to their last
              credit got a plan button and no way to buy the searches that were
              about to be refused. The balance is what stops the very next tap;
              a missing plan stops automatic checking, is already reported by
              the badge two lines above this, and has a nav row of its own. */}
          <Link
            href={standing === "ok" && !planActive ? "/portal/plan" : TOPUP_HREF}
            onClick={close}
            className={buttonClass(
              standing !== "ok" || !planActive ? "primary" : "secondary",
              "sm",
              "mt-3 w-full",
            )}
          >
            <Wallet size={13} />
            {/* Same condition as the href above, said once: a plan is the
                answer only when the balance is not the more urgent one. */}
            {empty ? "Top up now" : standing === "ok" && !planActive ? "Choose a plan" : "Top up credits"}
          </Link>
        </div>

        {/* ---------------- everywhere else ---------------- */}
        {groups.map((group, index) => (
          <div key={index} className={index > 0 ? "border-t border-divider" : undefined}>
            {group.map(({ href, label, icon: Icon, hint, flag }) => (
              <Link
                key={href}
                href={href}
                role="menuitem"
                onClick={close}
                className="flex min-h-14 items-center gap-3 px-4 py-2.5 transition hover:bg-sunken"
              >
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-raised text-muted">
                  <Icon size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">{label}</span>
                    {flag ? <Badge tone="brand">{flag}</Badge> : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-faint">{hint}</span>
                </span>
                <ChevronRight size={15} className="shrink-0 text-faint" />
              </Link>
            ))}
          </div>
        ))}

        {/*
          Support sits here rather than only in the footer because this is where
          somebody goes when something is wrong with THEIR account, and it is
          the one screen they can reach from every page. mailto and tel, so a
          phone dials or composes instead of handing over a string to copy.
        */}
        {/* Unconditional now. This was wrapped in a check for either
            setting being present, so with both blank - which is how the
            platform is configured today - a customer who hit a bug had no
            route to anybody. SupportPanel falls back to /contact rather than
            to nothing. */}
        <SupportPanel
          support={{ email: supportEmail, phone: supportPhone }}
          report
          className="border-t border-divider px-4 py-3"
        />

        {/* The website footer is hidden inside the portal on a phone, so the
            pages it linked to are reached from here instead. Plain links, one
            line, below everything a customer actually came to this sheet for. */}
        <nav
          aria-label="About this service"
          className="flex flex-wrap gap-x-4 gap-y-1 border-t border-divider px-4 py-3 text-xs lg:hidden"
        >
          {[
            { href: "/guide", label: "User guide" },
            { href: "/data-sources", label: "Where the data comes from" },
            { href: "/privacy", label: "Privacy" },
            { href: "/terms", label: "Terms" },
          ].map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              onClick={close}
              className="inline-flex min-h-9 items-center text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {label}
            </Link>
          ))}
        </nav>

        {/*
          STICKY, IN BOTH VARIANTS.

          This panel is nine rows tall - who you are, the balance, a top-up,
          five money rows, one or two account rows and the support block - about
          820px of it, having lost a row to the profile/settings merge above.
          The phone sheet is capped at 85vh and the dropdown is now capped
          against the window, so in both cases the last thing in the panel was
          off the end of it: measured at 390x844 the sign-out button was 150px
          below the fold, and on a 1280x800 desktop 128px below it. The merge
          above took one min-h-14 row out, so both figures improve by 56px and
          neither reaches zero - the button is still off the end on both
          devices, which is why this stays. The one
          control somebody opens this panel to hunt for by name was the one
          control they had to scroll to the very bottom to reach - which is the
          "make it workable" half of the owner's complaint, on both devices.

          Pinned to the bottom of the scroll container instead, with the panel's
          own colour behind it so the rows do not show through as they pass
          underneath. In a panel short enough not to scroll, sticky is inert and
          the button sits exactly where it always did.
        */}
        <div className="sticky bottom-0 border-t border-divider bg-panel px-4 py-3">
          <SignOutButton variant="secondary" size="sm" className="w-full" />
        </div>
      </div>
    </>
  );

  return (
    <div ref={wrapRef} className={sheet ? "contents" : "relative"}>
      {sheet ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Account"
          className={cx(
            "pressable relative flex min-h-16 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-[11px] font-medium transition-colors",
            open ? "font-semibold text-strong" : "text-muted active:text-ink",
          )}
        >
          {/* Sized like the other tabs' icons in PortalNav, so the bar is one set. */}
          <span className="relative inline-flex h-[26px] w-14 items-center justify-center">
            {/* The initials are the profile icon: it is the reader's own account,
                and a monogram says that faster than a generic silhouette. */}
            <span
              className={cx(
                "relative inline-flex size-[26px] items-center justify-center rounded-full border text-[10px] font-bold transition",
                open
                  ? "border-navy bg-navy text-white"
                  : "border-navy/20 bg-tile-blue text-navy",
              )}
            >
              {initials}
            </span>
          </span>
          Account
          {/* An empty balance stops every search, so it is flagged on the tab
              itself rather than only inside the panel nobody has opened.

              Kept to empty rather than extended to merely low: the header pill
              two inches above already carries a low balance and a way to fix
              it, and a dot cannot be tapped for the fix. A blocker earns the
              second marker, a nudge does not. */}
          {empty ? (
            <span
              aria-hidden
              className="absolute top-2.5 right-[calc(50%-16px)] size-2 rounded-full border-2 border-panel bg-bad-500"
            />
          ) : null}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className={cx(
            "flex min-h-10 items-center gap-2 rounded-lg border py-1 pr-2 pl-1.5 text-left transition",
            open ? "border-line-strong bg-sunken" : "border-line bg-panel hover:bg-sunken",
          )}
        >
          <Avatar size="sm" text={initials} />
          <span className="hidden min-w-0 sm:block">
            <span className="block max-w-36 truncate text-xs font-medium text-ink">{name}</span>
            <span className="block max-w-36 truncate text-[11px] text-faint">{email}</span>
          </span>
          <ChevronRight
            size={14}
            aria-hidden
            className={cx("shrink-0 text-faint transition", open && "rotate-90")}
          />
        </button>
      )}

      {!open ? null : sheet ? createPortal(panel, document.body) : panel}
    </div>
  );
}
