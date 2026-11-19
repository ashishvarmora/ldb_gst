import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";

import { Bullets, ContentPage, Section } from "@/components/ContentPage";
import { HelpNote } from "@/components/Disclosure";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";
import { AUTO_PAUSE_RULES, PAUSE_HELP_LINE } from "@/lib/pause";

/* Cached at the edge and rebuilt at most every five minutes - see
   publicHeaderAction in src/components/SiteFooter.tsx. */
export const revalidate = 300;

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `Support — ${brandName}`,
    alternates: { canonical: "/support" },
    openGraph: { title: `Support — ${brandName}`, url: "/support", images: "/opengraph-image" },
    description:
      "Answers about truck search results, toll crossing records, credits, alerts and your account.",
  };
}

/**
 * Support.
 *
 * Not a ticket queue and not a knowledge base with forty stubs. It answers the
 * handful of questions that actually arrive, and the first one is by far the
 * most common: a lookup came back with nothing and the reader assumes the
 * product is broken.
 *
 * Every answer is folded. The point of a support page is that somebody arrives
 * with ONE question - a wall of open prose makes them hunt for it, whereas a
 * list of questions can be scanned in a couple of seconds on a phone.
 */
export default async function SupportPage() {
  const [settings, action] = await Promise.all([publicSettings(), publicHeaderAction()]);
  const { supportEmail, supportPhone } = settings;

  return (
    <PublicShell action={action} mainClassName="flex-1">
      <ContentPage
        title="Support"
        intro="Answers to common questions. If yours is not here, write to us and our team will reply."
      >
        <Section id="data" title="About the data">
          <div className="space-y-2">
            <HelpNote title="Why does a search show no crossings?">
              Crossings appear only where a truck passes a toll plaza. Trucks on untolled or local
              roads, or that have not crossed a plaza recently, show no records. No records does not
              mean the truck has not moved.
            </HelpNote>

            <HelpNote title="How fresh is what I am seeing?">
              A crossing appears once it has been recorded and shared with us. This is usually quick,
              but not instant. Read each time as &ldquo;recorded at&rdquo;, not as a live position.
            </HelpNote>

            <HelpNote title="The same plaza appears twice. Why?">
              A plaza can report one crossing more than once. Repeats within a short window are merged
              into a single crossing. A repeat after that window is a genuine return and is shown as
              a new crossing.
            </HelpNote>

            <HelpNote title="Can I rely on this as proof?">
              Use it as an operational record. Records can be delayed or incomplete, so for legal
              or contractual use, verify through official channels. See{" "}
              <Link href="/data-sources" className="font-medium text-brand-500 hover:underline">
                where the data comes from
              </Link>{" "}
              for what the records can and cannot show.
            </HelpNote>
          </div>
        </Section>

        <Section id="watching" title="Tracking a truck">
          <div className="space-y-2">
            <HelpNote title="I added a truck but get no alerts.">
              A truck is checked only when one of its alerts is due, so a truck with no alert
              switched on is not checked. Open the truck and add an alert. The list marks any live
              truck without one.
            </HelpNote>

            {/*
              The commonest question in this section, and the one the owner
              asked to have answered in full: a vehicle went quiet on its own
              and the reader wants to know whether they have lost anything.
              Every reason, because the old answer gave only the failing one -
              so anybody whose lorry paused because it was parked, or because
              their own end time arrived, read that their number must be wrong.

              The count is deliberately not written out. This said "one of four
              limits" while the list underneath it came from AUTO_PAUSE_RULES,
              so adding the empty-balance rule made the sentence wrong; and
              "four limits" was already wrong about the list, whose first entry
              is a pause the officer made themselves.
            */}
            <HelpNote title="Why was my truck paused automatically?">
              <p>
                Every automatic check uses credits, so tracking pauses by itself when further checks
                are unlikely to show anything new. Pausing a truck yourself is the best way to save
                credits. The reasons a truck can pause:
              </p>
              <ul className="mt-2 space-y-1.5">
                {AUTO_PAUSE_RULES.map((rule) => (
                  <li key={rule.label}>
                    <span className="font-medium text-ink">{rule.label}.</span> {rule.body}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                If an account is on hold, all its trucks pause together. Please contact support to
                resolve it.
              </p>
              <p className="mt-2">
                {PAUSE_HELP_LINE} Every paused truck is on your{" "}
                <Link
                  href="/portal/trucks?filter=watchlist"
                  className="font-medium text-brand-500 hover:underline"
                >
                  watchlist
                </Link>
                , which shows why it paused and lets you switch it back on.
              </p>
            </HelpNote>

            <HelpNote title="A truck's checks keep failing. What should I do?">
              This usually means the vehicle number is wrong. We notify you after five unsuccessful
              checks in a row, and if they continue the truck is paused. Its saved crossings are
              kept. Correct the number and switch the truck back on.
            </HelpNote>

            <HelpNote title="How do alerts reach me?">
              By phone notification, by Telegram (once connected in Settings) and in the bell inside
              the app. Every alert is saved in the app, even if a message could not be delivered.
            </HelpNote>

            <HelpNote title="How often should a truck be checked?">
              Check more often for trucks you need to follow closely and less often for others.
              More frequent checks use more credits; see{" "}
              <Link href="/pricing" className="font-medium text-brand-500 hover:underline">
                Pricing
              </Link>{" "}
              for rates. A longer interval still records every crossing, just later.
            </HelpNote>
          </div>
        </Section>

        <Section id="account" title="Account, credits and billing">
          <div className="space-y-2">
            <HelpNote title="What is the difference between a plan and credits?">
              A plan sets how many trucks you can track and for how long. It is charged once for its
              whole term, not per month. Credits pay for searches and automatic checks at the rates
              shown on{" "}
              <Link href="/pricing" className="font-medium text-brand-500 hover:underline">
                Pricing
              </Link>
              . Topping up does not change your plan. Credits never expire, including trial credits.
            </HelpNote>

            {/* The answer changed with the empty-balance auto-pause: the
                balance is still the first thing to check, but running out is
                no longer a silent state - the vehicles are paused and say so.
                Left as the first thing to check because it is still the
                commonest cause, and because the reader arriving at this
                question has not seen the message. */}
            <HelpNote title="Why did my checks stop?">
              Checks stop when the balance runs out, when the plan ends, or when a truck pauses
              automatically. Check your balance first: when it runs out, every live truck is paused
              and marked{" "}
              <span className="font-medium text-ink">No credits left</span>. Top up and switch back
              on the trucks you need. If your balance is fine, check that notifications are still
              connected in Settings, then write to us.
            </HelpNote>

            <HelpNote title="I cannot sign in and the reset email has not arrived.">
              Check your spam folder. If it is not there, write to us from your registered email and
              we will help you sign in.
            </HelpNote>
          </div>
        </Section>

        <Section id="contact" title="Need more help?">
          <p>Write to us with your account email and when the issue happened.</p>
          {supportEmail || supportPhone ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {supportEmail ? (
                <a
                  href={`mailto:${supportEmail}`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm font-medium text-ink transition hover:border-brand-500/50 hover:text-brand-500"
                >
                  <Mail size={15} />
                  {supportEmail}
                </a>
              ) : null}
              {supportPhone ? (
                <a
                  href={`tel:${supportPhone.replace(/[^\d+]/g, "")}`}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-panel px-3 text-sm font-medium text-ink transition hover:border-brand-500/50 hover:text-brand-500"
                >
                  <Phone size={15} />
                  {supportPhone}
                </a>
              ) : null}
            </div>
          ) : (
            <p>
              See{" "}
              <Link href="/contact" className="font-medium text-brand-500 hover:underline">
                the contact page
              </Link>
              .
            </p>
          )}
        </Section>
      </ContentPage>
    </PublicShell>
  );
}
