import type { Metadata } from "next";
import Link from "next/link";
import { Mail, Phone } from "lucide-react";

import { Bullets, ContentPage, Section } from "@/components/ContentPage";
import { HelpNote } from "@/components/Disclosure";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";

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

            <HelpNote title="A vehicle paused itself. Why?">
              Because its checks kept failing. That is nearly always a registration number that
              does not match any vehicle, or one the network has stopped reporting. You are
              messaged after five failures in a row, and if they continue the vehicle is paused
              rather than left asking a question with no answer, and its tracking slot is handed
              back. Nothing is deleted — its recorded crossings stay, and you can switch it back on
              once the number is corrected.
            </HelpNote>

            <HelpNote title="How do alerts reach me?">
              Through Telegram, once you have connected it in Settings, and in the bell inside the
              app either way. If Telegram is not connected the alert is still recorded — you will
              just have to open the app to see it.
            </HelpNote>

            <HelpNote title="How often should I check a vehicle?">
              As fast as you find useful. Automatic checks are included in your plan and cost
              nothing, so there is no saving in a slower beat — the only difference is how soon you
              hear about a crossing. Your plan caps how many vehicles may be watched at once, not
              how often.
            </HelpNote>
          </div>
        </Section>

        <Section id="account" title="Account, credits and billing">
          <div className="space-y-2">
            <HelpNote title="What is the difference between a plan and credits?">
              A plan sets how many vehicles you may watch at once, and includes their automatic
              checking however often it runs. Credits are separate and pay only for a lookup you
              run yourself. Topping up credits never changes your plan, its end date or its
              vehicle limit — and your credits never expire.
            </HelpNote>

            <HelpNote title="My checks stopped and I was not told.">
              An empty balance no longer stops automatic checking — that is part of your plan. What
              does stop it is the plan itself ending, and a vehicle pausing itself. Check whether Telegram is
              still connected in Settings, then write to us.
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
