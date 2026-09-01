import { cache } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Mail, MapPin, Phone } from "lucide-react";

import { LogoBadge } from "@/components/Logo";
import { LinkButton, cx } from "@/components/ui";
import { getSessionUser } from "@/lib/auth";
import { loadSettings, SETTINGS_FALLBACK } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { reportError } from "@/lib/errors";
import type { AppSettings } from "@/lib/types";

/**
 * The furniture every signed-out page wears - settings, header, shell, footer.
 *
 * They live together because they are always used together: a page that needs
 * the footer needs the brand name for its title and the header above it, and
 * splitting three tiny modules apart would mean three imports on every page to
 * describe one thing. The file keeps its old name so nothing that already
 * imports the footer has to move.
 */

/**
 * Settings for the signed-out pages.
 *
 * Cached per request so a page can name the brand in generateMetadata and again
 * while rendering off a single query, and it falls back to the defaults instead
 * of throwing: somebody who cannot sign in needs the form on screen, not an
 * error page because a settings row or the service-role key is missing.
 */
export const publicSettings = cache(async (): Promise<AppSettings> => {
  try {
    return await loadSettings(getSupabaseAdmin());
  } catch (error) {
    reportError("Loading public settings", error);
    return SETTINGS_FALLBACK;
  }
});

/** The one action a public header offers, beside the pricing link. */
export type HeaderAction = { href: string; label: string };

/**
 * The way out of a public page, for whoever is reading it.
 *
 * Every one of these pages is readable signed in or signed out, so the only
 * thing that changes between the two is where the button goes: back to the
 * account for somebody who has one, to sign-in for somebody who does not. Kept
 * here because six pages asking the same question in six slightly different
 * ways is how a header ends up offering the page you are already on.
 */
export async function publicHeaderAction(): Promise<HeaderAction> {
  const session = await getSessionUser();
  const signedIn = session !== null && session.profile.status === "active";
  if (!signedIn) return { href: "/login", label: "Sign in" };
  return {
    href: session.profile.role === "super_admin" ? "/admin" : "/portal",
    label: "Your account",
  };
}

/**
 * Header for the signed-out pages.
 *
 * Pricing is on every one of them because a visitor who cannot sign in still
 * has a right to know what this costs. The second slot is whatever that
 * particular page is not - sign-in offers registration, registration offers
 * sign-in - so the header never advertises the page the reader is already on.
 */
export async function SiteHeader({ action }: { action?: HeaderAction | null }) {
  const { brandName } = await publicSettings();

  return (
    <header className="border-b border-line/70">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
        <Link
          href="/"
          className="-ml-1 flex min-h-10 min-w-0 items-center gap-2 rounded-lg px-1 transition hover:opacity-80"
        >
          <LogoBadge size="sm" />
          <span className="truncate text-sm font-semibold text-strong">{brandName}</span>
        </Link>

        <nav className="flex shrink-0 items-center gap-1.5">
          <Link
            href="/pricing"
            className="inline-flex min-h-10 items-center rounded-lg px-2.5 text-sm font-medium text-muted transition hover:bg-sunken hover:text-ink"
          >
            Pricing
          </Link>
          {action ? (
            <LinkButton href={action.href} variant="secondary" size="sm">
              {action.label}
            </LinkButton>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

/**
 * Page frame for everything a signed-out visitor can reach. Same header, same
 * footer, same column width on all of them, so moving between the landing page,
 * pricing and the four auth forms never feels like leaving the product.
 */
export function PublicShell({
  action,
  children,
  mainClassName,
}: {
  action?: HeaderAction | null;
  children: ReactNode;
  /** Layout for the main column. Forms centre themselves; content pages do not. */
  mainClassName?: string;
}) {
  return (
    <div className="theme-light flex min-h-screen flex-col">
      <SiteHeader action={action} />
      <main className={cx("flex-1", mainClassName ?? "px-4 py-10")}>{children}</main>
      <SiteFooter />
    </div>
  );
}

/**
 * The narrow centred card the four auth forms share - sign in, register, forgot
 * and reset. Passing the icon in keeps the key pages (password recovery) looking
 * different from the account pages without a second copy of this layout.
 */
export function AuthCard({
  icon,
  title,
  intro,
  children,
  footer,
}: {
  icon: ReactNode;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
  /** The "already have an account?" line under the card, when there is one. */
  footer?: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col justify-center">
      <div className="mb-7 flex flex-col items-center text-center">
        <span className="mb-4 inline-flex size-12 items-center justify-center rounded-2xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
          {icon}
        </span>
        <h1 className="text-xl font-semibold text-strong">{title}</h1>
        {intro ? <p className="mt-1.5 text-sm leading-relaxed text-muted">{intro}</p> : null}
      </div>

      <div className="panel p-6">{children}</div>

      {footer ? <div className="mt-6 text-center text-sm text-muted">{footer}</div> : null}
    </div>
  );
}

/**
 * Footer for every public page.
 *
 * It was one centred column: brand, contacts, address, then Pricing plus
 * whatever policy URLs an admin had pasted in - which was usually neither, so
 * most deployments shipped a footer whose entire legal section was missing.
 * The policies are our own pages now, so they are always there, and the
 * external settings survive only as an override for an operator who keeps
 * theirs elsewhere.
 *
 * Grouped into named columns rather than one long row of links. Three short
 * labelled lists are scannable; eleven links in a wrapped row are a wall, and
 * on a phone that wall is most of a screen.
 *
 * The independence line is the reason this component is worth the trouble. It
 * has to appear on every public page, because "is this the government?" is the
 * one thing a visitor can most damagingly assume - and the footer is the only
 * thing every page already has.
 */
export async function SiteFooter({ className }: { className?: string }) {
  const { brandName, supportEmail, supportPhone, supportAddress, privacyUrl, termsUrl } =
    await publicSettings();

  const linkClass =
    "inline-flex min-h-8 items-center rounded-lg transition hover:text-brand-500";

  /* Our own page unless the admin has pointed somewhere else, so a deployment
     with its policies on a corporate site is not forced to duplicate them. */
  const groups: { heading: string; links: { key: string; href: string; label: string }[] }[] = [
    {
      heading: "Product",
      links: [
        { key: "pricing", href: "/pricing", label: "Plans and pricing" },
        { key: "sources", href: "/data-sources", label: "Where the data comes from" },
      ],
    },
    {
      heading: "Company",
      links: [
        { key: "about", href: "/about", label: "About us" },
        { key: "contact", href: "/contact", label: "Contact" },
        { key: "support", href: "/support", label: "Help and support" },
      ],
    },
    {
      heading: "Legal",
      links: [
        { key: "privacy", href: privacyUrl || "/privacy", label: "Privacy policy" },
        { key: "terms", href: termsUrl || "/terms", label: "Terms of use" },
      ],
    },
  ];

  return (
    <footer className={cx("w-full border-t border-line/70 px-4 py-8", className)}>
      <div className="mx-auto w-full max-w-5xl">
        <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
          {/* Who we are, and how to reach us. */}
          <div className="min-w-0 sm:max-w-xs">
            <Link href="/" className="inline-flex items-center gap-2">
              <LogoBadge size="sm" />
              <span className="truncate text-sm font-semibold text-strong">{brandName}</span>
            </Link>

            <p className="mt-2.5 text-xs leading-relaxed text-muted">
              Toll-plaza crossing records, arranged into a journey you can follow.
            </p>

            {supportEmail || supportPhone ? (
              <ul className="mt-3.5 space-y-1.5 text-xs text-muted">
                {supportEmail ? (
                  <li>
                    <a href={`mailto:${supportEmail}`} className={cx(linkClass, "gap-1.5")}>
                      <Mail size={13} className="shrink-0" />
                      <span className="break-all">{supportEmail}</span>
                    </a>
                  </li>
                ) : null}
                {supportPhone ? (
                  <li>
                    <a
                      href={`tel:${supportPhone.replace(/[^\d+]/g, "")}`}
                      className={cx(linkClass, "gap-1.5")}
                    >
                      <Phone size={13} className="shrink-0" />
                      <span>{supportPhone}</span>
                    </a>
                  </li>
                ) : null}
              </ul>
            ) : null}

            {supportAddress ? (
              <p className="mt-2.5 flex items-start gap-1.5 text-xs leading-relaxed text-faint">
                <MapPin size={13} className="mt-0.5 shrink-0" />
                <span className="whitespace-pre-line">{supportAddress}</span>
              </p>
            ) : null}
          </div>

          {/* Everything else, in named columns. */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-7 sm:flex sm:gap-12">
            {groups.map(({ heading, links }) => (
              <div key={heading} className="min-w-0">
                <p className="text-[11px] font-semibold tracking-wider text-faint uppercase">
                  {heading}
                </p>
                <ul className="mt-2 space-y-1.5 text-xs text-muted">
                  {links.map(({ key, href, label }) => (
                    <li key={key}>
                      {href.startsWith("/") ? (
                        <Link href={href} className={linkClass}>
                          {label}
                        </Link>
                      ) : (
                        <a
                          href={href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className={linkClass}
                        >
                          {label}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8 flex flex-col gap-2 border-t border-line/70 pt-5 text-[11px] leading-relaxed text-faint sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <p>
            © {new Date().getFullYear()} {brandName}. An independent platform — not affiliated with
            or endorsed by any government department or agency.
          </p>
          <p className="shrink-0">
            Records may be delayed or incomplete.{" "}
            <Link href="/data-sources" className="underline underline-offset-2 hover:text-brand-500">
              Read the limits
            </Link>
            .
          </p>
        </div>
      </div>
    </footer>
  );
}
