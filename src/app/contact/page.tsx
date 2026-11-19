import type { Metadata } from "next";
import Link from "next/link";
import { Clock, Mail, MapPin, Phone } from "lucide-react";

import { Callout, ContentPage, Section } from "@/components/ContentPage";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";

/* Cached at the edge and rebuilt at most every five minutes - see
   publicHeaderAction in src/components/SiteFooter.tsx. */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `Contact — ${brandName}`,
    alternates: { canonical: "/contact" },
    openGraph: { title: `Contact — ${brandName}`, url: "/contact", images: "/opengraph-image" },
    description: "Contact Rahdari by email or phone about your account, payments or coverage.",
  };
}

/**
 * Contact.
 *
 * Every detail on this page is read from the admin's settings rather than
 * written into the file, so there is exactly one place an address or a number
 * is changed and no chance of the footer and this page disagreeing about how to
 * reach the same company.
 *
 * A row is only drawn when it has a value. A contact page that shows an empty
 * "Phone:" label is worse than one that shows only an email - it reads as a
 * company that has stopped maintaining its own site.
 *
 * There is deliberately no contact FORM. A form needs somewhere to deliver to,
 * and this deployment's outbound mail is configured for one thing: password
 * resets. A form that silently failed would be the worst of both, so the page
 * hands over the real address instead.
 */
export default async function ContactPage() {
  const [settings, action] = await Promise.all([publicSettings(), publicHeaderAction()]);
  const { brandName, supportEmail, supportPhone, supportAddress } = settings;

  const rows = [
    supportEmail
      ? {
          key: "email",
          icon: Mail,
          label: "Email",
          value: supportEmail,
          href: `mailto:${supportEmail}`,
          note: "Best for account and billing questions.",
        }
      : null,
    supportPhone
      ? {
          key: "phone",
          icon: Phone,
          label: "Phone",
          value: supportPhone,
          href: `tel:${supportPhone.replace(/[^\d+]/g, "")}`,
          note: "Best for urgent issues.",
        }
      : null,
  ].filter((row) => row !== null);

  return (
    <PublicShell action={action} mainClassName="flex-1">
      <ContentPage
        title="Contact us"
        intro={`Questions about ${brandName}, your account, a payment or coverage — here is how to reach our team.`}
      >
        {rows.length > 0 ? (
          <Section id="reach" title="How to reach us">
            <div className="grid gap-3 sm:grid-cols-2">
              {rows.map(({ key, icon: Icon, label, value, href, note }) => (
                <a
                  key={key}
                  href={href}
                  className="group flex items-start gap-3 rounded-xl border border-line bg-panel p-4 transition hover:border-brand-500/50 hover:bg-sunken"
                >
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-500">
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-muted">
                      {label}
                    </span>
                    <span className="mt-0.5 block text-sm font-medium break-words text-ink transition group-hover:text-brand-500">
                      {value}
                    </span>
                    <span className="mt-1 block text-xs leading-relaxed text-faint">{note}</span>
                  </span>
                </a>
              ))}
            </div>
          </Section>
        ) : (
          <Callout tone="warn" title="Contact details coming soon">
            If you have an account, reply to any email from us and our team will help.
          </Callout>
        )}

        {supportAddress ? (
          <Section id="address" title="Registered address">
            <p className="flex items-start gap-2.5">
              <MapPin size={16} className="mt-0.5 shrink-0 text-faint" />
              <span className="whitespace-pre-line">{supportAddress}</span>
            </p>
          </Section>
        ) : null}

        <Section id="hours" title="When you will hear back">
          <p className="flex items-start gap-2.5">
            <Clock size={16} className="mt-0.5 shrink-0 text-faint" />
            <span>
              We aim to reply within one working day, Monday to Saturday. Billing and sign-in issues
              are handled first.
            </span>
          </p>
        </Section>

        <Section id="what-to-send" title="What to include">
          <p>
            To help us respond quickly, include your account email, the truck number (if relevant)
            and when the issue happened. Never share your password — we will never ask for it.
          </p>
        </Section>

        <Section id="privacy" title="Data and privacy questions">
          <p>
            For a request about your own data — a copy of it, a correction, or deletion — write to
            the same address and say what you are asking for.{" "}
            <Link href="/privacy" className="font-medium text-brand-500 hover:underline">
              The privacy policy
            </Link>{" "}
            sets out what we hold and how those requests are handled.
          </p>
        </Section>
      </ContentPage>
    </PublicShell>
  );
}
