import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  BellRing,
  CircleSlash,
  FolderOpen,
  Gift,
  LifeBuoy,
  Mail,
  PauseCircle,
  Phone,
  Search,
  Truck,
  Wallet,
} from "lucide-react";

import { Bullets, Callout, ContentPage, Section } from "@/components/ContentPage";
import { Disclosure, HelpNote } from "@/components/Disclosure";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";
import { TelegramChatIdInfo } from "@/components/TelegramChatIdInfo";
import { Badge, LinkButton, Mono, Panel, Tbody, Thead, TableWrap, Tr, cx } from "@/components/ui";
import { ALERT_KIND_EXAMPLE, ALERT_KIND_HINT, ALERT_KIND_LABEL } from "@/lib/alerts";
import {
  CREDIT_ACTIONS,
  costOf,
  describeOpenTier,
  describeRate,
  formatCredits,
  loadCreditPacks,
  loadCreditRates,
  planChargeInr,
  planTermLabel,
} from "@/lib/credits";
import { reportError } from "@/lib/errors";
import { fmtRupees } from "@/lib/format";
import { checksPerDay, intervalLabel } from "@/lib/intervals";
import { AUTO_PAUSE_RULES, PAUSE_HELP_LINE } from "@/lib/pause";
import {
  describeWelcomeBonus,
  loadReferralTerms,
  referralExample,
  referralPercent,
} from "@/lib/referrals";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertRuleTemplate, CreditPack, CreditRate, Plan } from "@/lib/types";

import { AlertPath, CreditFlow, Figure, PlanVersusCredits, RecordPipeline, TruckRowMap } from "./Figures";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `User guide — ${brandName}`,
    description:
      "How to use the platform end to end: searching a lorry, putting one under watch, what each check costs, and how alerts reach your phone.",
  };
}

/**
 * The user guide.
 *
 * WHY /guide AND NOT /help. /support already exists and is called "Help and
 * support". A second route called help would put two links with almost the
 * same label side by side in the footer, and the reader would have to open
 * both to learn which is which. They are also two different genres: support
 * answers ONE question for somebody who already uses the product, this teaches
 * the whole product to somebody who does not. "Guide" is also the owner's own
 * word for it.
 *
 * WHY IT IS PUBLIC. Three reasons, in order of weight. A person deciding
 * whether to pay for this has to be able to find out what they would be paying
 * for - which is the same argument that makes /pricing and /data-sources
 * public. An officer whose plan has lapsed, or who cannot sign in, is exactly
 * the reader who needs the section on how to fix it, and they cannot reach the
 * portal to read it. And nothing on this page is account-specific: every figure
 * comes from the catalogue tables an admin edits, which are the same for
 * everybody.
 *
 * WHY NOTHING IS HARD-CODED. A manual that disagrees with the checkout is
 * worse than no manual - the reader trusts the manual, budgets against it, and
 * finds out at the till. So the plans, the packs, the rates, the alert rules,
 * the referral percentages and the pause reasons are all read at request time
 * from the same helpers the pricing page and the portal use. The prose says the
 * RULES, which do not change; the numbers are always the live ones.
 *
 * ON SCREENSHOTS, because the owner asked for them and did not get them: see
 * the header of ./Figures.tsx. The short version is that every screen worth
 * marking up is behind a sign-in and is being rebuilt this week, so the figures
 * draw the facts an officer loses money by not knowing rather than the layout
 * of a button that will have moved by the time anyone reads this.
 */
export default async function GuidePage() {
  const admin = getSupabaseAdmin();

  const [settings, action, referralTerms, catalogue] = await Promise.all([
    publicSettings(),
    publicHeaderAction(),
    // Straight from app_settings, like the pricing page: the four referral
    // percentages belong to the referral scheme and NOT to settings.
    // referralPercent on AppSettings is 0037's abandoned single-event key and
    // still falls back to 10, which would print the wrong promise here.
    loadReferralTerms(admin),
    loadCatalogue(admin),
  ]);

  const { brandName, supportEmail, supportPhone } = settings;
  const { plans, packs, rates, alertRules } = catalogue;

  const searchRate = rates.find((rate) => rate.action === CREDIT_ACTIONS.manualSearch);
  const checkRate = rates.find((rate) => rate.action === CREDIT_ACTIONS.autoCheck);

  return (
    <PublicShell action={action} mainClassName="flex-1">
      <ContentPage
        title="User guide"
        intro={`Everything ${brandName} does, in the order you will meet it. Each part stands on its own — jump to the one you need from the list below rather than reading the lot.`}
      >
        <Contents />

        {/* ------------------------------------------------------------------ */}
        <Section id="what-it-does" title="1. What it does">
          <p>
            You give {brandName} a lorry&apos;s registration number. It asks the national toll
            network what that number has been recorded at, and shows you the plazas it has passed,
            newest first, with the time of each crossing.
          </p>
          <p>
            You can do that once, by hand, whenever you want to know. Or you can put a lorry
            &ldquo;under watch&rdquo;, and {brandName} does the asking for you on a beat you choose
            and sends you a Telegram message when it finds something.
          </p>

          <Figure caption="A crossing is a record made at a toll gantry. It is not a satellite position, and that difference explains most of what surprises people.">
            <RecordPipeline />
          </Figure>

          <Callout tone="warn" title="The one thing to understand before anything else">
            A lorry is only visible where there is a reading point. One on state roads, on a short
            local run, or one that simply has not passed a plaza recently produces no records at
            all. <strong>Nothing found means nothing was recorded</strong> — not that the lorry is
            not moving. Records can also arrive late. Treat every timestamp as
            &ldquo;recorded at&rdquo;, never as &ldquo;is at&rdquo;.
          </Callout>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="first-steps" title="2. Your first ten minutes">
          <p>In this order. The fourth step is the one people skip, and it is the expensive one.</p>

          <ol className="mt-1 space-y-3">
            <Step n={1} title="Open an account">
              {settings.signupEnabled ? (
                <>
                  <Link href="/signup" className="font-medium text-brand-500 hover:underline">
                    Register
                  </Link>{" "}
                  with an email address and a password. Nothing is charged for this.
                </>
              ) : (
                <>
                  New accounts are not being opened at the moment. Existing accounts work as usual
                  — get in touch if you need one.
                </>
              )}
            </Step>

            <Step n={2} title="Confirm your email with the 6-digit code">
              We email you a six-digit code and you type it in. This is not decoration: the free
              trial will not start until the address is confirmed, because the trial is once per
              account and an unconfirmed address can be manufactured.
            </Step>

            <Step n={3} title="Take the free trial, or buy a plan">
              The trial is free, lasts a few days and comes with a small number of credits — one
              lorry, once per account. The exact figures are in{" "}
              <a href="#plans" className="font-medium text-brand-500 hover:underline">
                the plans table
              </a>
              . A plan is what allows automatic checking at all.
            </Step>

            <Step n={4} title="Connect Telegram — before you switch any tracking on">
              Open <strong className="text-ink">Settings</strong> and save your Telegram chat id,
              with the switch on. Do this <em>first</em>. Alerts raised while it is not connected
              are recorded in the app and never sent, and{" "}
              <strong className="text-ink">the credit is spent either way</strong>. See{" "}
              <a href="#alerts" className="font-medium text-brand-500 hover:underline">
                section 9
              </a>
              .
            </Step>

            <Step n={5} title="Add a lorry and give it one alert">
              A lorry with no alert switched on is never checked, so it costs nothing and tells you
              nothing. Add one alert, choose how often, and it goes live.
            </Step>
          </ol>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="plan-credits" title="3. A plan and credits are two different things">
          <p>
            This is the only genuinely confusing thing about the product, and getting it the wrong
            way round is how people buy the wrong thing.
          </p>

          <Figure caption="Both, or nothing gets watched. A plan with an empty balance checks nothing; credits with no plan still search by hand.">
            <PlanVersusCredits />
          </Figure>

          <TableWrap>
            <Thead>
              <th className="th">&nbsp;</th>
              <th className="th">A plan</th>
              <th className="th">Credits</th>
            </Thead>
            <Tbody>
              <Tr>
                <td className="td font-medium text-strong">Decides</td>
                <td className="td">How many lorries at once, and until when</td>
                <td className="td">What each look costs</td>
              </Tr>
              <Tr>
                <td className="td font-medium text-strong">Charged</td>
                <td className="td">Once, for the whole term — not per month</td>
                <td className="td">Whenever you top up</td>
              </Tr>
              <Tr>
                <td className="td font-medium text-strong">Runs out</td>
                <td className="td">On its end date</td>
                <td className="td">Never — except a trial&apos;s</td>
              </Tr>
            </Tbody>
          </TableWrap>

          <HelpNote title="So which do I buy when I run short?">
            If checks are being refused, or every lorry paused itself saying{" "}
            <em>No credits left</em>, you need credits — top up. If the app will not let you add
            another lorry, you need a bigger plan. If your plan has ended, renewing is the only
            thing that brings automatic checking back; credits alone will not.
          </HelpNote>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="credits" title="4. What spends a credit">
          <p>
            Two things, and they cost the same:{" "}
            <strong className="text-ink">a search you type in</strong>, and{" "}
            <strong className="text-ink">each automatic check</strong> of a lorry you are watching.
          </p>

          {rates.length > 0 ? (
            <ul className="mt-1 space-y-2">
              {rates.map((rate) => (
                <li
                  key={rate.action}
                  className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-line bg-panel px-4 py-3"
                >
                  <span className="text-sm font-medium text-ink">{rate.label}</span>
                  <Badge tone="brand">{describeRate(rate)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              The rates have not been published on this deployment yet.{" "}
              <Link href="/pricing" className="font-medium text-brand-500 hover:underline">
                Check the pricing page
              </Link>
              .
            </p>
          )}

          {/*
            The whole reason this section exists, and it is stated before the
            drawing rather than after it. Officers assume a credit buys a
            RESULT. It buys an attempt.
          */}
          <Callout tone="warn" title="A credit is spent when the check runs, not when it finds something">
            The credit goes the moment a check is made. It does{" "}
            <strong>not</strong> depend on whether the lorry moved, whether the plaza changed,
            whether an alert was raised, whether Telegram delivered it, or whether anything was
            found at all. A check that comes back empty costs the same as one that finds a
            crossing. So does one the portal could not answer.
          </Callout>

          <Figure caption="The charge happens above the fork. Everything below it is already paid for.">
            <CreditFlow />
          </Figure>

          <p>
            That is why <strong className="text-ink">how often</strong> you check is the whole cost
            of the product, and why{" "}
            <a href="#pausing" className="font-medium text-brand-500 hover:underline">
              pausing a lorry
            </a>{" "}
            is the biggest saving available to you.
          </p>

          <Disclosure
            title="Do credits expire?"
            hint="No — with one exception, and it is the one most people meet first."
          >
            <p className="text-sm leading-relaxed text-muted">
              Credits you have paid for <strong className="text-ink">never expire</strong>. They are
              a lifetime wallet: they survive your plan ending, they survive a renewal, and they are
              still there months later.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              The exception is the free trial.{" "}
              <strong className="text-ink">
                Trial credits are destroyed when the trial ends
              </strong>{" "}
              — whatever is left of them goes with it. They were free and the trial is over. Buying
              a plan is what carries on from there, and a plan brings its own credits.
            </p>
          </Disclosure>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="plans" title="5. The plans">
          <p>
            Each price below is for <strong className="text-ink">the whole plan</strong>, charged
            once. It is not a monthly price. Every plan comes with credits and sets how many lorries
            you may watch at the same time.
          </p>

          {plans.length === 0 ? (
            <p>
              No plans are on sale on this deployment at the moment.{" "}
              <Link href="/pricing" className="font-medium text-brand-500 hover:underline">
                See pricing
              </Link>
              .
            </p>
          ) : (
            <TableWrap>
              <Thead>
                <th className="th">Plan</th>
                <th className="th">Price</th>
                <th className="th">Term</th>
                <th className="th">Credits</th>
                <th className="th">Lorries</th>
              </Thead>
              <Tbody>
                {plans.map((plan) => (
                  <Tr key={plan.id}>
                    <td className="td font-medium whitespace-nowrap text-strong">
                      {plan.name}
                      {plan.is_trial ? (
                        <Badge tone="good" className="ml-2">
                          free
                        </Badge>
                      ) : null}
                    </td>
                    <td className="td tabular-nums whitespace-nowrap">
                      {fmtRupees(planChargeInr(plan))}
                    </td>
                    <td className="td whitespace-nowrap">{planTermLabel(plan)}</td>
                    <td className="td tabular-nums">{formatCredits(plan.included_credits)}</td>
                    <td className="td tabular-nums">
                      {plan.truck_limit === -1 ? "unlimited" : plan.truck_limit}
                    </td>
                  </Tr>
                ))}
              </Tbody>
            </TableWrap>
          )}

          <HelpNote title="About the free trial">
            <p>
              Once per account, and only after the six-digit email code has been confirmed. The code
              lasts about ten minutes, so ask for it when you are ready to type it in.
            </p>
            <p className="mt-2">
              It watches one lorry, and{" "}
              <strong className="text-ink">its credits die with it</strong> — see section 4. A trial
              cannot be topped up either: a top-up needs a <em>paid</em> plan. So a trial that has
              run out of credits is finished until you choose one, and choosing one is what brings
              fresh credits.
            </p>
          </HelpNote>

          {/*
            The state matrix, and the row nobody guesses right is the third: a
            lapsed plan is not a dead account. The credits are still there and
            they still search.
            Five rows rather than three because the two trial rows behave
            differently from every paid state and from each other - a running
            trial cannot top up, and a finished one cannot do anything - and a
            matrix that folded them into "plan active" would tell a trial user
            the opposite of what they will meet.
          */}
          <h3 className="mt-6 text-sm font-semibold text-strong">What each state lets you do</h3>
          <TableWrap>
            <Thead>
              <th className="th">Your account</th>
              <th className="th">Search by hand</th>
              <th className="th">Automatic tracking</th>
              <th className="th">Top up credits</th>
            </Thead>
            <Tbody>
              <Tr>
                <td className="td font-medium text-strong">Paid plan, running</td>
                <Yes />
                <Yes />
                <Yes />
              </Tr>
              <Tr>
                <td className="td font-medium text-strong">Free trial, running</td>
                <Yes />
                <Yes />
                <No note="a top-up needs a paid plan" />
              </Tr>
              <Tr>
                <td className="td font-medium text-strong">Plan expired, or never bought one</td>
                <Yes note="credits are a lifetime wallet" />
                <No />
                <No note="renew first" />
              </Tr>
              <Tr>
                <td className="td font-medium text-strong">Free trial finished</td>
                <No note="its credits went with it" />
                <No />
                <No note="choose a plan" />
              </Tr>
              <Tr>
                <td className="td font-medium text-strong">No credits left</td>
                <No />
                <No note="every lorry is paused" />
                <Yes note="if a paid plan is running" />
              </Tr>
            </Tbody>
          </TableWrap>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="topups" title="6. Topping up credits">
          <p>
            A top-up adds credits and{" "}
            <strong className="text-ink">changes nothing else</strong> — not your plan, not its end
            date, not how many lorries you may watch. Bigger rungs are better value per credit.
          </p>

          <Callout tone="warn" title="A top-up needs a paid plan that is running right now">
            This catches people out. If your plan has <strong>expired</strong>, if you are on the{" "}
            <strong>free trial</strong>, or if you have <strong>never bought a plan</strong>, a
            top-up is refused. Buy or renew a plan first — and a plan brings credits of its own, so
            that is often the only purchase you needed. Buying a plan and a top-up together in one
            payment is fine.
          </Callout>

          {packs.length === 0 ? (
            <p>No credit packs are on sale on this deployment at the moment.</p>
          ) : (
            <TableWrap>
              <Thead>
                <th className="th">You pay</th>
                <th className="th">You get</th>
              </Thead>
              <Tbody>
                {packs.map((pack) => (
                  <Tr key={pack.id}>
                    <td className="td tabular-nums whitespace-nowrap font-medium text-strong">
                      {fmtRupees(pack.price_inr)}
                      {pack.is_open_ended ? <span className="text-muted"> or more</span> : null}
                    </td>
                    <td className="td">
                      {pack.is_open_ended ? (
                        describeOpenTier(pack, settings.creditsPerRupee)
                      ) : (
                        <>
                          <span className="tabular-nums">{formatCredits(pack.credits)}</span> credits
                        </>
                      )}
                    </td>
                  </Tr>
                ))}
              </Tbody>
            </TableWrap>
          )}

          {settings.razorpayEnabled ? null : (
            <p className="text-warn-500">
              Online payment is switched off on this deployment at the moment
              {supportEmail ? (
                <>
                  {" "}
                  — write to{" "}
                  <a href={`mailto:${supportEmail}`} className="font-medium underline">
                    {supportEmail}
                  </a>{" "}
                  and your account will be set up by hand.
                </>
              ) : (
                " — get in touch and your account will be set up by hand."
              )}
            </p>
          )}
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="search" title="7. Searching a lorry by hand">
          <p>
            <strong className="text-ink">Search</strong> in the menu. Type the registration number
            and send it. One search is one credit, and you get the plazas that number has been
            recorded at, newest first.
          </p>
          <Bullets
            items={[
              "Spaces and case do not matter — GJ01AB1234 and gj 01 ab 1234 are the same lorry.",
              "A search works even when your plan has ended, as long as you have credits. That is the point of credits never expiring.",
              "An empty result is a real answer: nothing has been recorded for that number recently. It still costs the credit, because the asking is what costs.",
            ]}
          />
          <HelpNote title="Search, or put it under watch?">
            Search when you want to know now and will not need to know again. Put it under watch
            when the question is &ldquo;tell me when this moves&rdquo; — that is what alerts are
            for, and it is what a plan buys. One search is one credit; watching is one credit every
            time we look, which adds up quickly. Section 8 has the arithmetic.
          </HelpNote>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="watching" title="8. Putting a lorry under watch">
          <p>
            Add the lorry under <strong className="text-ink">My trucks</strong>, then give it at
            least one alert. A lorry with no alert switched on is never checked at all — it sits on
            the list costing nothing and telling you nothing.
          </p>

          <Figure caption="A sketch of what a row on My trucks tells you — not a photograph. That screen is being reworked, so treat this as the list of facts it carries rather than its layout.">
            <TruckRowMap />
          </Figure>

          <h3 className="mt-6 text-sm font-semibold text-strong">The kinds of alert</h3>
          {alertRules.length === 0 ? (
            <p>No alert rules are published on this deployment at the moment.</p>
          ) : (
            <div className="space-y-2">
              {alertRules.map((rule) => (
                <Panel key={rule.id} bodyClassName="px-4 py-3.5">
                  <p className="text-sm font-semibold text-strong">
                    {ALERT_KIND_LABEL[rule.kind] ?? rule.name}
                  </p>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    {ALERT_KIND_HINT[rule.kind] ?? rule.description}
                  </p>
                  <p className="mt-2 text-xs text-faint">
                    You would get:{" "}
                    <Mono className="text-[12px] text-muted">{ALERT_KIND_EXAMPLE[rule.kind]}</Mono>
                  </p>
                  <p className="mt-1.5 text-xs text-faint">
                    Suggested beat every {intervalLabel(rule.default_interval_minutes)}; the closest
                    allowed is every {intervalLabel(rule.min_interval_minutes)}.
                  </p>
                </Panel>
              ))}
            </div>
          )}

          {/*
            The trap in that list, and it is a money one. "Only when it moves"
            reads like the economical choice, so an officer picks it AND a fast
            beat and is surprised by the bill. All three kinds look just as
            often; the kind decides how noisy your phone is, the beat decides
            what it costs.
          */}
          <Callout tone="warn" title="Choosing “only when it moves” does not save credits">
            All three look just as often — the kind of alert only decides when we{" "}
            <em>message</em> you. A quieter phone is not a cheaper lorry. The only thing that
            changes the cost is a slower beat.
          </Callout>

          <h3 className="mt-6 text-sm font-semibold text-strong">
            How often to look — and what it costs
          </h3>
          <p>
            This is the single decision that sets your bill. Every look is a credit, so the number
            of looks a day <em>is</em> the spend a day, per lorry.
          </p>

          {checkRate ? (
            <>
              <TableWrap>
                <Thead>
                  <th className="th">Look every</th>
                  <th className="th">Times a day</th>
                  <th className="th">Credits a day</th>
                  <th className="th">Credits in 30 days</th>
                </Thead>
                <Tbody>
                  {[15, 30, 60, 180, 360, 720].map((minutes) => {
                    const perDay = checksPerDay(minutes);
                    const credits = costOf(checkRate.units_per_credit, perDay);
                    return (
                      <Tr key={minutes} className={minutes === 15 ? "bg-warn-500/8" : undefined}>
                        <td className="td whitespace-nowrap">{intervalLabel(minutes)}</td>
                        <td className="td tabular-nums">{perDay.toLocaleString("en-IN")}</td>
                        <td className="td tabular-nums font-medium text-strong">
                          {formatCredits(credits)}
                        </td>
                        <td className="td tabular-nums">{formatCredits(credits * 30)}</td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </TableWrap>
              <p className="text-xs text-faint">
                Per lorry. Two lorries on the same beat cost twice this. The highlighted row is the
                fastest beat most people reach for, and it is worth seeing what it comes to before
                switching it on.
              </p>
            </>
          ) : null}

          <HelpNote title="Several alerts on one lorry — do I pay twice?">
            No. One lorry is asked about once per due window however many alerts it has running:
            the check is charged once and shared between every alert that was due. What costs more
            is a <em>faster</em> beat, not more rules on the same beat.
          </HelpNote>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="alerts" title="9. Getting the alerts on your phone">
          <p>
            Alerts reach you over <strong className="text-ink">Telegram</strong>. They also always
            appear on the bell inside the app. WhatsApp is built but has nothing behind it yet — it
            is shown as <Badge tone="neutral">coming soon</Badge> and sends nothing.
          </p>

          <Callout tone="warn" title="Read this one twice. It is the most expensive mistake available.">
            <p>
              If no Telegram chat id is saved — or one is saved but the switch is off —{" "}
              <strong>
                the alert is recorded in the app and never sent to anybody, and the credit is spent
                all the same
              </strong>
              .
            </p>
            <p className="mt-2">
              From the outside it looks like the product is working: rows appear on the bell, the
              balance goes down, and your phone stays silent. Nothing tells you at the moment it
              happens. Connect Telegram before you switch any tracking on.
            </p>
          </Callout>

          <Figure caption="The recording always happens. The sending is what depends on that one field.">
            <AlertPath />
          </Figure>

          <Disclosure
            title="Connecting Telegram, step by step"
            hint="Three steps, then one test. The test is the part that proves it."
            defaultOpen
          >
            <div className="space-y-3 text-sm leading-relaxed text-muted">
              <div>
                <p className="font-medium text-ink">First, find your chat id</p>
                <div className="mt-1.5">
                  <TelegramChatIdInfo />
                </div>
              </div>

              <div className="border-t border-divider pt-3">
                <p className="font-medium text-ink">Then save it and prove it works</p>
                <ol className="mt-1.5 space-y-1.5">
                  <li>
                    Paste the number into <strong className="text-ink">Settings</strong> and turn{" "}
                    <em>Send me alerts on Telegram</em> on. A saved id with the switch off sends
                    nothing.
                  </li>
                  <li>
                    Press <strong className="text-ink">Send test</strong>. If the test message
                    arrives, alerts will arrive.
                  </li>
                  <li>
                    If it does not, the usual cause is that our alerts bot has never been started.
                    Telegram forbids a bot from messaging anyone who has not started it, so open the
                    conversation with our bot and send it a{" "}
                    <Mono className="text-[12px]">/start</Mono>, then test again.
                  </li>
                </ol>
              </div>
            </div>
          </Disclosure>

          <HelpNote title="Why two different bots?">
            The first bot only <em>tells you your own id</em> — it is a public utility and does not
            send you anything afterwards. The alerts themselves come from our own bot, which is why
            it needs its own <Mono className="text-[12px]">/start</Mono> before it is allowed to
            message you. The <strong className="text-ink">Send test</strong> button in Settings is
            the only reliable way to know both halves are done.
          </HelpNote>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="pausing" title="10. Pausing — how you stop spending">
          <p>
            Pausing is not tidying up. It is{" "}
            <strong className="text-ink">the main lever you have on your bill</strong>. A paused
            lorry is not checked, so it spends nothing, and it frees a slot on your plan for another
            one.
          </p>
          <Callout>{PAUSE_HELP_LINE}</Callout>

          <p>
            A lorry parked in a yard answers every check with yesterday&apos;s crossing. Pause it.
            Take it live again when it is back on the road — nothing is re-added and nothing is
            lost.
          </p>

          <h3 className="mt-6 text-sm font-semibold text-strong">
            What stops a lorry being checked
          </h3>
          <ul className="ml-4 list-disc space-y-2 marker:text-faint">
            {AUTO_PAUSE_RULES.map((rule) => (
              <li key={rule.label} className="pl-1">
                <span className="font-medium text-ink">{rule.label}.</span> {rule.body}
              </li>
            ))}
            <li className="pl-1">
              <span className="font-medium text-ink">The plan ended.</span> When a plan lapses and
              the days to renew in have passed, automatic checking is switched off on every lorry at
              once. Your credits are untouched and still search by hand.
            </li>
          </ul>

          <p>
            The &ldquo;no movement&rdquo; window on this deployment is{" "}
            <strong className="text-ink">
              {intervalLabel(settings.inactivePauseHours * 60)}
            </strong>
            , and it is counted from the later of the last crossing and{" "}
            <strong className="text-ink">the moment you took the lorry live</strong> — not from a
            crossing that was already old when you added it. So a lorry that has been standing still
            for a week still gets a full window of being watched from the moment you switch it on.
          </p>

          <p>
            Repeated failures pause a lorry too. You are messaged after five unanswered checks in a
            row, and it pauses at about{" "}
            {settings.trackingFailureCutoff.toLocaleString("en-IN")}. That is nearly always a typo
            in the registration number — and a failed check costs a credit like any other, which is
            why retrying a number the portal will not answer only buys errors.
          </p>

          <Callout>
            Every paused lorry says why it stopped, and{" "}
            <strong className="text-ink">keeps every crossing it ever recorded</strong>. A lorry that
            reaches a stop is not even charged for a farewell check — the stop is worked out before
            any credit is spent.
          </Callout>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="groups" title="11. Groups">
          <p>
            A group is a folder of lorries you want to read together — a consignment, a transporter,
            a case you are working. Put several lorries in one and their crossings appear on a single
            combined timeline, so you can see which of them was where and when.
          </p>
          <p>
            Grouping costs nothing on its own. A group does not check anything; the lorries inside
            it do, on their own alerts, exactly as they would alone.
          </p>
        </Section>

        {/* ------------------------------------------------------------------ */}
        {settings.referralEnabled ? (
          <Section id="referrals" title="12. Invite and earn">
            <ReferralBlock terms={referralTerms} />
          </Section>
        ) : null}

        {/* ------------------------------------------------------------------ */}
        <Section id="records" title="13. What the records can and cannot show you">
          <Callout tone="warn" title="Not evidence on its own">
            Records can be delayed, incomplete or absent entirely, and a gap has innocent
            explanations. Use what you find as a lead to corroborate by other means, never as proof
            on its own.
          </Callout>
          <Bullets
            items={[
              "A crossing means the lorry was recorded at that plaza at that time. It says nothing about where it is now.",
              "No records does not mean no journey — untolled roads produce nothing.",
              "The same plaza can be reported several times for one physical crossing. Repeats inside a short window are folded into one; past that window it is treated as a genuine return.",
              "How long crossings are kept is set by the administrator on this deployment.",
            ]}
          />
          <p>
            The full declaration — where the data comes from, who operates the underlying
            infrastructure, and what {brandName} does and does not do to it — is on{" "}
            <Link href="/data-sources" className="font-medium text-brand-500 hover:underline">
              the data sources page
            </Link>
            .
          </p>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="fixes" title="14. If something looks wrong">
          <div className="space-y-2">
            <HelpNote title="I searched a lorry and nothing came back.">
              Almost always a lorry that has not passed a tolled plaza recently — see section 1.
              Check the number for a typo, then try a lorry you know runs on highways to satisfy
              yourself the search itself is working.
            </HelpNote>

            <HelpNote title="My phone is silent but the balance is going down.">
              This is the Telegram problem in section 9, and it is the first thing to check. Open
              Settings, confirm a chat id is saved <em>and</em> the switch is on, and press{" "}
              <strong className="text-ink">Send test</strong>. If the test does not arrive, our
              alerts bot has not been started — send it a{" "}
              <Mono className="text-[12px]">/start</Mono>.
            </HelpNote>

            <HelpNote title="My lorry paused itself.">
              It will say which of the reasons in section 10 applied. A lorry paused because it
              stopped moving, or because an end time you set arrived, is working as intended and
              costs you nothing while it sits there. One paused for repeated failures usually has a
              wrong registration number. One paused for an empty balance or a lapsed plan needs the
              account fixed first — switching it back on before that will not hold.
            </HelpNote>

            <HelpNote title="A top-up is being refused.">
              A top-up needs a plan that is active right now — see section 6. On an expired plan, on
              the trial, or with no plan ever bought, buy or renew a plan instead. It brings credits
              with it.
            </HelpNote>

            <HelpNote title="My checks stopped and nothing told me.">
              Check the balance first: with nothing in it, nothing is checked, and every live lorry
              is paused and marked <em>No credits left</em> so it stops costing you anything. Then
              check whether the plan is still running. Then check Telegram.
            </HelpNote>

            <HelpNote title="I cannot sign in and the reset email never arrives.">
              Check the spam folder, then write to us from the address you registered with.
            </HelpNote>
          </div>
        </Section>

        {/* ------------------------------------------------------------------ */}
        <Section id="help" title="15. Getting help from a person">
          <p>
            <Link href="/support" className="font-medium text-brand-500 hover:underline">
              Help and support
            </Link>{" "}
            answers the questions that come up most. If yours is not there, write to us with your
            account email and roughly when the problem happened.
          </p>

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
              Contact details for this deployment have not been published yet — see{" "}
              <Link href="/contact" className="font-medium text-brand-500 hover:underline">
                the contact page
              </Link>
              .
            </p>
          )}

          <div className="mt-6 flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
            <LinkButton href="/pricing" variant="secondary">
              Plans and pricing
            </LinkButton>
            <LinkButton href="/support" variant="secondary">
              Help and support
            </LinkButton>
          </div>
        </Section>
      </ContentPage>
    </PublicShell>
  );
}

/* -------------------------------------------------------------------------- */
/* contents                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * The contents list, and the reason this page is usable on a phone at all.
 *
 * An officer arrives with ONE question - "why is my phone silent", "why did
 * this pause itself", "why won't it let me top up" - and fifteen sections of
 * prose between them and the answer is the same as no answer. So the list is
 * the first thing on the page, and it is short labels rather than the section
 * titles: "Telegram alerts" is scannable in a column of fifteen, "9. Getting
 * the alerts on your phone" is not.
 *
 * Two columns even at 390px. Fifteen rows in one column is 540px of thumb
 * travel before the guide starts; two columns halve that, and the labels are
 * written short enough that none of them wraps at that width.
 */
const CONTENTS: { href: string; label: string; icon: typeof Search }[] = [
  { href: "#what-it-does", label: "What it does", icon: Truck },
  { href: "#first-steps", label: "First ten minutes", icon: LifeBuoy },
  { href: "#plan-credits", label: "Plan vs credits", icon: Wallet },
  { href: "#credits", label: "What costs a credit", icon: Wallet },
  { href: "#plans", label: "The plans", icon: Wallet },
  { href: "#topups", label: "Topping up", icon: Wallet },
  { href: "#search", label: "Search by hand", icon: Search },
  { href: "#watching", label: "Watch a lorry", icon: Truck },
  { href: "#alerts", label: "Telegram alerts", icon: BellRing },
  { href: "#pausing", label: "Pausing to save", icon: PauseCircle },
  { href: "#groups", label: "Groups", icon: FolderOpen },
  { href: "#referrals", label: "Invite and earn", icon: Gift },
  { href: "#records", label: "What records show", icon: Search },
  // Short enough not to truncate in a two-column list at 390px, which is what
  // "If something looks wrong" did - and a clipped label in the contents is
  // the one place a reader cannot tell what they are about to open.
  { href: "#fixes", label: "If it looks wrong", icon: CircleSlash },
  { href: "#help", label: "Get help", icon: LifeBuoy },
];

function Contents() {
  return (
    <Panel title="What is in this guide" description="Jump straight to the part you need.">
      <nav>
        <ol className="grid grid-cols-2 gap-x-3 sm:grid-cols-3">
          {CONTENTS.map(({ href, label, icon: Icon }, index) => (
            <li key={href}>
              <a
                href={href}
                className="flex min-h-9 items-center gap-2 rounded-lg px-1 text-xs font-medium text-muted transition hover:bg-sunken hover:text-brand-500"
              >
                <Icon size={13} className="shrink-0 text-faint" />
                {/* The number, so the list and the headings below match up and
                    somebody can say "section 9" to support. */}
                <span className="tabular-nums text-faint">{index + 1}</span>
                <span className="min-w-0 truncate">{label}</span>
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </Panel>
  );
}

/* -------------------------------------------------------------------------- */
/* pieces                                                                      */
/* -------------------------------------------------------------------------- */

/** One numbered step of the getting-started list. */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full border border-brand-500/30 bg-brand-500/12 text-[11px] font-semibold text-brand-500">
        {n}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-strong">{title}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-muted">{children}</span>
      </span>
    </li>
  );
}

/**
 * A cell of the state matrix.
 *
 * The word as well as the tick, and not only for screen readers: a column of
 * bare ticks and crosses on a phone is four narrow columns of ambiguous
 * glyphs, and the note is where the useful half of the answer lives - "yes,
 * because credits are a lifetime wallet" is the sentence somebody came for.
 */
function Verdict({ ok, note }: { ok: boolean; note?: string }) {
  return (
    <td className="td align-top">
      <span
        className={cx(
          "text-sm font-semibold whitespace-nowrap",
          ok ? "text-good-500" : "text-bad-500",
        )}
      >
        {ok ? "Yes" : "No"}
      </span>
      {note ? <span className="mt-0.5 block text-xs leading-snug text-faint">{note}</span> : null}
    </td>
  );
}

function Yes({ note }: { note?: string }) {
  return <Verdict ok note={note} />;
}

function No({ note }: { note?: string }) {
  return <Verdict ok={false} note={note} />;
}

/**
 * The referral scheme, worked from the LIVE percentages.
 *
 * The example amounts are the owner's own - a 999 rupee plan and a 3,000 rupee
 * first top-up - and referralExample() applies whatever the four settings
 * currently say to them, so an admin editing the terms cannot leave a stale
 * promise on this page.
 */
function ReferralBlock({ terms }: { terms: Awaited<ReturnType<typeof loadReferralTerms>> }) {
  const example = referralExample(terms);
  const welcome = describeWelcomeBonus(terms);

  return (
    <>
      <p>
        Share your invite link. When somebody who joined on it{" "}
        <strong className="text-ink">pays for their first plan</strong>, and again when they{" "}
        <strong className="text-ink">first top up</strong>, you both get credits. Nothing arrives
        when they merely register — a sign-up on its own earns nobody anything.
      </p>

      <TableWrap>
        <Thead>
          <th className="th">Their first…</th>
          <th className="th">You get</th>
          <th className="th">They get</th>
        </Thead>
        <Tbody>
          <Tr>
            <td className="td whitespace-nowrap">Plan</td>
            <td className="td">{referralPercent(terms.planReferrerPercent)} of what they paid</td>
            <td className="td">{referralPercent(terms.planInviteePercent)} of what they paid</td>
          </Tr>
          <Tr>
            <td className="td whitespace-nowrap">Top-up</td>
            <td className="td">{referralPercent(terms.topupReferrerPercent)} of what they paid</td>
            <td className="td">{referralPercent(terms.topupInviteePercent)} of what they paid</td>
          </Tr>
        </Tbody>
      </TableWrap>

      <p>
        Once each, per person, paid as credits. Worked through: they buy a{" "}
        {fmtRupees(example.planInr)} plan and later top up {fmtRupees(example.topupInr)} — you
        receive {formatCredits(example.planReferrer)} then{" "}
        {formatCredits(example.topupReferrer)} credits, {formatCredits(example.referrerTotal)} in
        all, and they receive {formatCredits(example.inviteeTotal)}.
      </p>

      {welcome ? <p className="text-muted">{welcome}</p> : null}

      <HelpNote title="What if they buy a plan and top up in one payment?">
        It pays once, on the whole amount, and closes both events. At today&apos;s percentages that
        comes to {formatCredits(example.combinedReferrer)} credits to you and{" "}
        {formatCredits(example.combinedInvitee)} to them for a single{" "}
        {fmtRupees(example.combinedInr)} payment — the same as buying the two separately, which is
        the point of charging it once.
      </HelpNote>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* data                                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Everything the guide quotes a number from, in one round of queries.
 *
 * Empty lists on failure rather than an exception, exactly as the pricing page
 * does it. Every section below already has to say something sensible when the
 * admin has published nothing, and the same wording covers a database that is
 * not answering - so a guide is still readable, and still correct about the
 * RULES, when Tokyo is having a bad morning.
 */
async function loadCatalogue(admin: ReturnType<typeof getSupabaseAdmin>): Promise<{
  plans: Plan[];
  packs: CreditPack[];
  rates: CreditRate[];
  alertRules: AlertRuleTemplate[];
}> {
  try {
    const [planResult, packs, rates, alertResult] = await Promise.all([
      admin.from("plans").select("*").eq("is_active", true).order("sort_order").order("price_inr"),
      loadCreditPacks(admin),
      loadCreditRates(admin),
      admin
        .from("alert_rule_templates")
        .select("*")
        .eq("is_active", true)
        .order("sort_order"),
    ]);

    return {
      plans: (planResult.data ?? []) as Plan[],
      packs,
      rates,
      alertRules: (alertResult.data ?? []) as AlertRuleTemplate[],
    };
  } catch (error) {
    reportError("Guide page: catalogue", error);
    return { plans: [], packs: [], rates: [], alertRules: [] };
  }
}
