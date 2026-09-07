import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";

import { Bullets, ContentPage, Section } from "@/components/ContentPage";
import { HelpNote } from "@/components/Disclosure";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";
import { AUTO_PAUSE_RULES, PAUSE_HELP_LINE } from "@/lib/pause";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `Help and support — ${brandName}`,
    description:
      "Answers to the questions people actually ask: why a vehicle shows nothing, what credits are spent on, and how alerts reach you.",
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
  const { brandName, supportEmail, supportPhone } = settings;

  return (
    <PublicShell action={action} mainClassName="flex-1">
      <ContentPage
        title="Help and support"
        intro="The questions we are asked most, answered properly. If yours is not here, write to us — a person reads it."
      >
        <Section id="data" title="About the data">
          <div className="space-y-2">
            <HelpNote title="I searched a vehicle and nothing came back. Is it broken?">
              Usually not. A vehicle is only visible where there is a reading point — a tolled
              highway plaza. A lorry on state roads, on a short local run, or one that simply has
              not passed a plaza recently produces no records at all. Nothing found means nothing
              was recorded, which is not the same as the vehicle not moving.
            </HelpNote>

            <HelpNote title="How fresh is what I am seeing?">
              A crossing appears once it has been recorded and passed on to us. That is usually
              quick but it is not instant, and it is not guaranteed. Treat a timestamp as
              &ldquo;recorded at&rdquo;, not as a live position.
            </HelpNote>

            <HelpNote title="The same plaza appears twice. Why?">
              A plaza often reports one physical crossing several times. Repeats inside a short
              window are folded into one so a single crossing is not counted twice; past that window
              the vehicle has genuinely come back, and that is recorded as a new crossing. The
              administrator sets how long that window is.
            </HelpNote>

            <HelpNote title="Can I use this as evidence?">
              Not on its own. Records can be delayed, incomplete or absent, and gaps have innocent
              explanations. Use what you find as a lead to corroborate by other means. See{" "}
              <Link href="/data-sources" className="font-medium text-brand-500 hover:underline">
                where the data comes from
              </Link>{" "}
              for what the records can and cannot show.
            </HelpNote>
          </div>
        </Section>

        <Section id="watching" title="Watching a vehicle">
          <div className="space-y-2">
            <HelpNote title="I added a vehicle but hear nothing.">
              A vehicle is only checked when one of its alerts is due, so a vehicle with no alert
              switched on is never checked at all. Open it and add one. The list marks any live
              vehicle that has no alert on it.
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
            {/* "vehicle", not "truck", only because every other question on
                this page says vehicle and one odd word in a list of five reads
                as a different author. */}
            <HelpNote title="Why was my vehicle paused automatically?">
              <p>
                A tracked vehicle is checked every fifteen minutes and each check spends one credit
                — about 96 a day for one vehicle — so checking stops by itself rather than let
                credits go on checks that cannot tell you anything new. Pausing a vehicle yourself
                does the same thing and is the largest saving available to you; the rest happen
                without you:
              </p>
              <ul className="mt-2 space-y-1.5">
                {AUTO_PAUSE_RULES.map((rule) => (
                  <li key={rule.label}>
                    <span className="font-medium text-ink">{rule.label}.</span> {rule.body}
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                A suspended account stops every vehicle on it at once — that one is not about any
                vehicle&apos;s settings, and support can switch it back on.
              </p>
              <p className="mt-2">
                {PAUSE_HELP_LINE} Every paused vehicle is on your{" "}
                <Link
                  href="/portal/trucks?filter=watchlist"
                  className="font-medium text-brand-500 hover:underline"
                >
                  watchlist
                </Link>
                , where it says why it stopped and can be opened or taken live again.
              </p>
            </HelpNote>

            <HelpNote title="Its checks kept failing. What do I do?">
              That is nearly always a registration number that does not match any vehicle, or one
              the portal has stopped reporting. You are messaged after five failures in a row, and
              if they continue the vehicle is paused — a failed check costs a credit like any other,
              so retrying a number the portal will not answer only buys errors. Nothing is deleted:
              its recorded crossings stay, and it goes live again as soon as the number is
              corrected.
            </HelpNote>

            <HelpNote title="How do alerts reach me?">
              Through Telegram, once you have connected it in Settings, and in the bell inside the
              app either way. If Telegram is not connected the alert is still recorded — you will
              just have to open the app to see it.
            </HelpNote>

            <HelpNote title="How often should I check a vehicle?">
              As often as the vehicle is worth. Every automatic check spends one credit, so a
              fifteen-minute beat is about 96 credits a day and an hourly one is 24 — the choice is
              how soon you want to hear about a crossing against what that costs. A slower beat
              still records every crossing the portal reports, just later. Your plan caps how many
              vehicles may be watched at once; the credits cover how closely.
            </HelpNote>
          </div>
        </Section>

        <Section id="account" title="Account, credits and billing">
          <div className="space-y-2">
            <HelpNote title="What is the difference between a plan and credits?">
              A plan sets how many vehicles you may watch at once, and until when. Credits pay for
              the checking itself — one credit per check, whether we ran it automatically or you
              ran the lookup yourself. So the plan decides how many and the credits decide how
              closely. A plan is priced for its whole term and charged once, not per month.
              Topping up never changes your plan, its end date or its vehicle limit, and credits
              you have paid for never expire — the one exception is the free trial, whose credits
              end with it.
            </HelpNote>

            {/* The answer changed with the empty-balance auto-pause: the
                balance is still the first thing to check, but running out is
                no longer a silent state - the vehicles are paused and say so.
                Left as the first thing to check because it is still the
                commonest cause, and because the reader arriving at this
                question has not seen the message. */}
            <HelpNote title="My checks stopped and I was not told.">
              Three things stop them: an empty balance, the plan itself ending, and a vehicle
              pausing itself. Check your balance first — with nothing in it nothing is checked, and
              every live vehicle is paused and marked{" "}
              <span className="font-medium text-ink">No credits left</span> so it stops costing you
              anything. Top up and take the ones you still need live again. If the balance is fine,
              check whether Telegram is still connected in Settings, then write to us.
            </HelpNote>

            <HelpNote title="I cannot sign in and the reset email never arrives.">
              Check the spam folder first. If nothing is there, write to us from the address you
              registered with — resets depend on outbound mail being correctly configured on the
              deployment, and if it is not, we would rather fix it than leave you locked out.
            </HelpNote>
          </div>
        </Section>

        <Section id="contact" title="Still stuck?">
          <p>Write to us with your account email and roughly when the problem happened.</p>
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
              Contact details for this deployment of {brandName} have not been published yet. See{" "}
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
