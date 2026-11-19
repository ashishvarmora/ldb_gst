import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bell, MapPin, ShieldCheck } from "lucide-react";

import { Bullets, ContentPage, Section } from "@/components/ContentPage";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";
import { LinkButton } from "@/components/ui";

/* Cached at the edge and rebuilt at most every five minutes - see
   publicHeaderAction in src/components/SiteFooter.tsx. */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `About — ${brandName}`,
    alternates: { canonical: "/about" },
    openGraph: { title: `About — ${brandName}`, url: "/about", images: "/opengraph-image" },
    description:
      "Rahdari helps transport businesses see which toll plazas their trucks crossed, by vehicle number, and get alerts on new crossings.",
  };
}

/**
 * About.
 *
 * Written to answer the question a cautious visitor actually has, which is not
 * "what are your values" but "who am I handing vehicle movement queries to, and
 * what will you do with them". So it is short, concrete, and says what the
 * platform cannot do as plainly as what it can.
 */
export default async function AboutPage() {
  const [{ brandName }, action] = await Promise.all([publicSettings(), publicHeaderAction()]);

  return (
    <PublicShell action={action} mainClassName="flex-1">
      <ContentPage
        title={`About ${brandName}`}
        intro={`${brandName} turns toll plaza crossing records into a clear answer to one question: which toll plazas has this truck crossed, and when?`}
      >
        <Section id="what" title="What it does">
          <p>
            A truck passing a toll plaza is recorded electronically through FASTag. On their own,
            these records are just time-stamped entries.{" "}
            {brandName} collects them by vehicle number, arranges them into a journey, and alerts you
            when a tracked truck crosses a plaza.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              {
                icon: MapPin,
                title: "Search a truck",
                body: "Enter a vehicle number to see its recorded toll crossings in order.",
              },
              {
                icon: Bell,
                title: "Track it",
                body: "Choose which alerts you want and how often the truck is checked.",
              },
              {
                icon: ShieldCheck,
                title: "Keep the record",
                body: "Results are saved to your account, so you can refer back to them later.",
              },
            ].map(({ icon: Icon, title, body }) => (
              <div key={title} className="rounded-xl border border-line bg-panel p-4">
                <span className="inline-flex size-9 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-500">
                  <Icon size={16} />
                </span>
                <p className="mt-2.5 text-sm font-medium text-ink">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
              </div>
            ))}
          </div>
        </Section>

        <Section id="who" title="Who it is for">
          <p>
            Built for transport businesses, fleet owners and logistics teams tracking their own or
            contracted trucks.
          </p>
          <p>
            It is not a consumer product and it is not for tracking people. Every account belongs to
            a named holder, and every search is recorded against that account.
          </p>
        </Section>

        <Section id="not" title="What it is not">
          <Bullets
            items={[
              <>
                <strong className="text-ink">Not a government service.</strong> {brandName} is an
                independent platform. It is not operated, endorsed or certified by any government
                department or agency. See{" "}
                <Link href="/data-sources" className="font-medium text-brand-500 hover:underline">
                  where the data comes from
                </Link>
                .
              </>,
              <>
                <strong className="text-ink">Not live GPS.</strong> A truck is recorded when it
                crosses a toll plaza, not continuously. Between two plazas there is nothing to
                report, and a gap does not mean the truck stopped.
              </>,
              <>
                <strong className="text-ink">Not proof on its own.</strong> Records may be delayed,
                incomplete, or missing on routes without toll plazas. Use it as an operational
                record; verify through official channels where proof is needed.
              </>,
              <>
                <strong className="text-ink">Not a people-tracking tool.</strong> Using it to follow
                an individual, rather than a truck you have a legitimate business reason to track,
                breaks the{" "}
                <Link href="/terms" className="font-medium text-brand-500 hover:underline">
                  terms of use
                </Link>{" "}
                and ends the account.
              </>,
            ]}
          />
        </Section>

        <Section id="how-paid" title="How it is paid for">
          <p>
            A plan sets how many trucks you can track and for how long, and is charged once for its
            whole term. Credits pay for searches and automatic checks at the published rates. Credits
            never expire, and a paused truck uses no credits. See Pricing for current
            plans and rates.
          </p>
          {/* The consequence, said here because "one credit per check" above is
              exactly the sentence that raises it. A reader who works out what a
              fifteen-minute beat costs will ask what happens when the balance
              runs out, and the honest answer - the vehicles stop rather than
              quietly go unwatched - is a reason to trust the product, not a
              caveat to bury. */}
          <p>
            If your balance runs out, tracked trucks pause and you are notified. Top up to resume.
          </p>
          <p>
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1 font-medium text-brand-500 hover:underline"
            >
              See plans and pricing
              <ArrowRight size={14} />
            </Link>
          </p>
        </Section>

        <Section id="talk" title="Talk to us">
          <p>
            Questions about coverage, billing or whether {brandName} fits your needs are answered by
            our team.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton href="/contact" variant="primary" size="sm">
              Contact us
            </LinkButton>
            <LinkButton href="/support" variant="secondary" size="sm">
              Support
            </LinkButton>
          </div>
        </Section>
      </ContentPage>
    </PublicShell>
  );
}
