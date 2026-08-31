import { cache } from "react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Mail, MapPin, Phone, Truck } from "lucide-react";

import { LinkButton, cx } from "@/components/ui";
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
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
            <Truck size={16} />
          </span>
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
 * Footer for the signed-out pages. Support and policy fields are all set by an
 * admin and any of them may be blank, so each one is rendered only when it has a
 * value - an empty label or a mailto: with nothing after it is worse than no
 * footer row. Pricing is the exception: it is our own page, so it is always there.
 */
export async function SiteFooter({ className }: { className?: string }) {
  const { brandName, supportEmail, supportPhone, supportAddress, privacyUrl, termsUrl } =
    await publicSettings();

  const contacts = [
    supportEmail
      ? { key: "email", href: `mailto:${supportEmail}`, icon: Mail, label: supportEmail }
      : null,
    supportPhone
      ? { key: "phone", href: `tel:${supportPhone.replace(/[^\d+]/g, "")}`, icon: Phone, label: supportPhone }
      : null,
  ].filter((item) => item !== null);

  const linkClass =
    "inline-flex min-h-8 items-center rounded-lg px-1 transition hover:text-brand-500";

  return (
    <footer
      className={["w-full border-t border-line/70 px-4 py-6 text-center", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-3 text-xs text-muted">
        <p className="font-medium text-ink">{brandName}</p>

        {contacts.length > 0 ? (
          <ul className="flex flex-col items-center gap-2 sm:flex-row sm:gap-5">
            {contacts.map(({ key, href, icon: Icon, label }) => (
              <li key={key}>
                <a href={href} className={cx(linkClass, "gap-1.5")}>
                  <Icon size={13} className="shrink-0" />
                  <span>{label}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : null}

        {supportAddress ? (
          <p className="flex max-w-md items-start justify-center gap-1.5 leading-relaxed text-faint">
            <MapPin size={13} className="mt-0.5 shrink-0" />
            <span>{supportAddress}</span>
          </p>
        ) : null}

        <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
          <li>
            <Link href="/pricing" className={linkClass}>
              Plans and pricing
            </Link>
          </li>
          {privacyUrl ? (
            <li>
              <a href={privacyUrl} className={linkClass}>
                Privacy policy
              </a>
            </li>
          ) : null}
          {termsUrl ? (
            <li>
              <a href={termsUrl} className={linkClass}>
                Terms of use
              </a>
            </li>
          ) : null}
        </ul>

        <p className="text-faint">
          © {new Date().getFullYear()} {brandName}
        </p>
      </div>
    </footer>
  );
}
