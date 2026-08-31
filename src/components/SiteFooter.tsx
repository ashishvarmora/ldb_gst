import { cache } from "react";
import { Mail, MapPin, Phone } from "lucide-react";

import { loadSettings, SETTINGS_FALLBACK } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { reportError } from "@/lib/errors";
import type { AppSettings } from "@/lib/types";

/**
 * Settings for the signed-out pages, and the one thing every one of them
 * already imports - hence its home here rather than in a module of its own.
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

/**
 * Footer for the signed-out pages. Every field below is set by an admin and any
 * of them may be blank, so each one is rendered only when it has a value - an
 * empty label or a mailto: with nothing after it is worse than no footer row.
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
                <a
                  href={href}
                  className="inline-flex min-h-8 items-center gap-1.5 rounded-lg px-1 transition hover:text-brand-500"
                >
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

        {privacyUrl || termsUrl ? (
          <ul className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1">
            {privacyUrl ? (
              <li>
                <a href={privacyUrl} className="inline-flex min-h-8 items-center rounded-lg px-1 transition hover:text-brand-500">
                  Privacy policy
                </a>
              </li>
            ) : null}
            {termsUrl ? (
              <li>
                <a href={termsUrl} className="inline-flex min-h-8 items-center rounded-lg px-1 transition hover:text-brand-500">
                  Terms of use
                </a>
              </li>
            ) : null}
          </ul>
        ) : null}

        <p className="text-faint">
          © {new Date().getFullYear()} {brandName}
        </p>
      </div>
    </footer>
  );
}
