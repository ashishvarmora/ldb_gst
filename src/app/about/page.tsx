import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Bell, MapPin, ShieldCheck } from "lucide-react";

import { Bullets, ContentPage, Section } from "@/components/ContentPage";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";
import { LinkButton } from "@/components/ui";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `About — ${brandName}`,
    description:
      "Who runs this platform, what it does with commercial vehicle movement data, and what it deliberately does not do.",
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
        intro={`${brandName} turns toll-plaza crossing records into a plain answer to one question: where has this lorry been, and where is it now?`}
      >
        <Section id="what" title="What it does">
          <p>
            A commercial vehicle passing a tolled highway is recorded electronically at the plaza.
            Those records exist, but individually they are just timestamps at gantries.{" "}
            {brandName} collects them against a registration number, arranges them into a journey,
            and tells you when something you asked to know about happens.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {[
              {
                icon: MapPin,
                title: "Look up a vehicle",
                body: "One registration number, and the crossings recorded against it in order.",
              },
              {
                icon: Bell,
                title: "Watch it from then on",
                body: "Pick what is worth an alert and how often to check. The rest stays quiet.",
              },
              {
                icon: ShieldCheck,
                title: "Keep the record",
                body: "What was found is kept and exportable, so a finding can be shown later.",
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
            Anyone with a lawful reason to know where a commercial vehicle has been. In practice
            that has meant two groups: businesses following their own consignments, contracted
            carriers and supplier vehicles; and officers carrying out statutory functions who need
            to establish the movement of a specific vehicle.
          </p>
          <p>
            It is not a consumer product and it is not for tracking people. Every account is tied to
            a named holder, and every lookup is recorded against that account.
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
                <strong className="text-ink">Not live GPS.</strong> A vehicle is visible when it
                passes a reading point, not continuously. Between two plazas there is nothing to
                report, and that silence is not evidence that a vehicle stopped.
              </>,
              <>
                <strong className="text-ink">Not proof on its own.</strong> Records may be delayed,
                incomplete, or missing for routes without reading points. Treat what you find as a
                lead to be corroborated, never as a finding in itself.
              </>,
              <>
                <strong className="text-ink">Not a people-tracking tool.</strong> Using it to follow
                an individual, rather than a vehicle you have a lawful basis to enquire about, is a
                breach of the{" "}
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
            A plan sets how many vehicles may be watched at once, and until when. Its price is for
            the whole plan and is charged once, not per month. Credits pay for the checking itself,
            at one credit per check — whether we ran it automatically or you ran the lookup
            yourself. Credits you have paid for never expire, and the price of every action is
            published before you buy. That is also why a paused vehicle costs nothing: no checks,
            no credits.
          </p>
          {/* The consequence, said here because "one credit per check" above is
              exactly the sentence that raises it. A reader who works out what a
              fifteen-minute beat costs will ask what happens when the balance
              runs out, and the honest answer - the vehicles stop rather than
              quietly go unwatched - is a reason to trust the product, not a
              caveat to bury. */}
          <p>
            When the balance runs out, checking does not go quiet on you: every vehicle you have
            live is paused and says so, and stops spending. Top up and take the ones you still need
            live again. The free trial is the one thing with an end date on its credits — they come
            with it and finish with it.
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
            Questions about coverage, billing or whether this fits what you need are answered by a
            person, not a form letter.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <LinkButton href="/contact" variant="primary" size="sm">
              Contact us
            </LinkButton>
            <LinkButton href="/support" variant="secondary" size="sm">
              Help and support
            </LinkButton>
          </div>
        </Section>
      </ContentPage>
    </PublicShell>
  );
}
