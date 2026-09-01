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
  LifeBuoy,
  Mail,
  Phone,
  Receipt,
  Settings,
  ShieldCheck,
  User,
  Wallet,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { SignOutButton } from "@/components/SignOutButton";
import { Avatar, Badge, QuotaBar, buttonClass, cx } from "@/components/ui";
import { formatCredits } from "@/lib/credits";

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

/** Roughly a day of ordinary work - worth a warning colour before it hits zero. */
const LOW_CREDITS = 10;

function itemGroups({
  isSuperAdmin,
  referralsEnabled,
}: Pick<AccountMenuProps, "isSuperAdmin" | "referralsEnabled">): Item[][] {
  /*
   * `show=` opens the matching section on arrival. Without it these two land on
   * a heading that is still shut, which reads as a broken link.
   */
  const money: Item[] = [
    { href: "/portal/plan", label: "My plan", icon: Wallet, hint: "Balance, renewals and truck limit" },
    {
      href: "/portal/plan?show=history#history",
      label: "Credit history",
      icon: History,
      hint: "Top-ups, and what each day used",
    },
    {
      href: "/portal/plan?show=payments#payments",
      label: "Payment history",
      icon: Receipt,
      hint: "Every payment and what it bought",
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

  const account: Item[] = [
    { href: "/portal/settings#profile", label: "My profile", icon: User, hint: "Your name, phone and organisation" },
    { href: "/portal/settings", label: "Settings", icon: Settings, hint: "Alerts and history backup" },
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

  const lowCredits = credits <= 0;
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
          className="animate-in fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      ) : null}

      <div
        ref={sheetRef}
        role="menu"
        aria-label="Account"
        className={cx(
          "z-50 overflow-hidden border border-line bg-panel [box-shadow:var(--shadow-pop)]",
          sheet
            ? "animate-in fixed inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto overscroll-contain rounded-t-2xl border-b-0 pb-[env(safe-area-inset-bottom)] lg:hidden"
            : "animate-in absolute top-full right-0 mt-2 w-80 rounded-xl",
        )}
      >
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
              <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
                <Coins size={11} />
                Credits left
              </span>
              <span
                className={cx(
                  "mt-1 block text-2xl font-semibold tabular-nums",
                  lowCredits
                    ? "text-bad-500"
                    : credits < LOW_CREDITS
                      ? "text-warn-500"
                      : "text-brand-500",
                )}
              >
                {formatCredits(credits)}
              </span>
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

          <Link
            href={planActive ? "/portal/plan#topup" : "/portal/plan"}
            onClick={close}
            className={buttonClass(
              lowCredits || !planActive ? "primary" : "secondary",
              "sm",
              "mt-3 w-full",
            )}
          >
            <Wallet size={13} />
            {!planActive ? "Choose a plan" : lowCredits ? "Top up now" : "Top up credits"}
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
        {supportEmail || supportPhone ? (
          <div className="border-t border-divider px-4 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
              <LifeBuoy size={11} />
              Need help?
            </p>
            <div className="mt-2 flex flex-col gap-1.5">
              {supportEmail ? (
                <a
                  href={`mailto:${supportEmail}`}
                  className="inline-flex min-h-9 items-center gap-2 text-sm text-brand-500 transition hover:underline"
                >
                  <Mail size={14} className="shrink-0" />
                  <span className="truncate">{supportEmail}</span>
                </a>
              ) : null}
              {supportPhone ? (
                <a
                  href={`tel:${supportPhone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex min-h-9 items-center gap-2 text-sm text-brand-500 transition hover:underline"
                >
                  <Phone size={14} className="shrink-0" />
                  <span className="truncate">{supportPhone}</span>
                </a>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="border-t border-divider px-4 py-3">
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
            "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-1 px-1 text-[10px] font-medium transition",
            open ? "text-brand-500" : "text-muted active:text-ink",
          )}
        >
          <span
            aria-hidden
            className={cx(
              "absolute inset-x-3 top-0 h-0.5 rounded-full transition",
              open ? "bg-brand-500" : "bg-transparent",
            )}
          />
          {/* The initials are the profile icon: it is the reader's own account,
              and a monogram says that faster than a generic silhouette. */}
          <span
            className={cx(
              "inline-flex size-5 items-center justify-center rounded-full border text-[9px] font-semibold transition",
              open
                ? "border-brand-500 bg-brand-500 text-on-brand"
                : "border-brand-500/40 bg-brand-500/12 text-brand-400",
            )}
          >
            {initials}
          </span>
          Account
          {/* An empty balance stops every search, so it is flagged on the tab
              itself rather than only inside the panel nobody has opened. */}
          {lowCredits ? (
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
