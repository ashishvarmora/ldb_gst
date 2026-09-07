import type { Metadata } from "next";
import { ArrowRight, CalendarClock, Gift, Info, Truck, Wallet } from "lucide-react";

import { HelpNote } from "@/components/Disclosure";
import { PublicShell, publicSettings } from "@/components/SiteFooter";
import { Badge, LinkButton, Panel, cx } from "@/components/ui";
import {
  CREDIT_ACTIONS,
  costOf,
  describeOpenTier,
  describeRate,
  formatCredits,
  loadCreditPacks,
  loadCreditRates,
  planChargeInr,
  planExpiryNote,
  planTermSuffix,
  rupeesPerCredit,
} from "@/lib/credits";
import { reportError } from "@/lib/errors";
import { fmtRupees } from "@/lib/format";
import {
  describeReferralReward,
  describeWelcomeBonus,
  loadReferralTerms,
} from "@/lib/referrals";
import { getSessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertRuleTemplate, CreditPack, CreditRate, Plan } from "@/lib/types";

export async function generateMetadata(): Promise<Metadata> {
  const { brandName } = await publicSettings();
  return {
    title: `Plans and pricing — ${brandName}`,
    description: "What a plan costs, what credits buy, and what each action spends.",
  };
}

/** Credits to work the example in, when the database offers nothing to anchor on. */
const FALLBACK_EXAMPLE_CREDITS = 100;

/**
 * The price list, readable by anyone.
 *
 * Deliberately public and deliberately complete: someone deciding whether to
 * register should not have to register to find out what it costs. Every figure
 * here is read from the tables the admin edits, so the page cannot drift out of
 * step with what is actually charged.
 *
 * The two halves of the price are kept apart all the way down the page, because
 * conflating them is the one thing that makes this product confusing: a plan is
 * how many trucks may be watched, credits are what the watching spends.
 */
export default async function PricingPage() {
  const [session, settings, referralTerms, { plans, packs, rates, alertRule }] =
    await Promise.all([
      getSessionUser(),
      publicSettings(),
      // Read straight from app_settings rather than through publicSettings, so
      // the referral scheme's own four amounts stay with the referral code.
      loadReferralTerms(getSupabaseAdmin()),
      loadCatalogue(),
    ]);

  // Where a signed-in reader goes from here, and where a signed-out one does.
  // The page itself is the same for both - only the way out of it differs.
  const signedIn = session !== null && session.profile.status === "active";
  /* Null when both welcome amounts are 0, and the line simply disappears. */
  const welcomeLine = describeWelcomeBonus(referralTerms);
  const home = signedIn && session.profile.role === "super_admin" ? "/admin" : "/portal";
  const headerAction = signedIn
    ? { href: home, label: "Your account" }
    : { href: "/login", label: "Sign in" };

  /* The buy button lives in the portal, so this page's job when payment is off
     is only to say how to buy instead of pretending it is a click away. */
  const payNote = settings.razorpayEnabled
    ? null
    : settings.supportEmail
      ? `Online payment is switched off at the moment. Write to ${settings.supportEmail} and your account will be set up by hand.`
      : "Online payment is switched off at the moment. Contact us and your account will be set up by hand.";

  return (
    <PublicShell action={headerAction} mainClassName="flex-1 px-4 py-7 sm:py-10">
      <div className="mx-auto max-w-5xl">
        {/*
          This used to open with five lines of centred prose, which on a phone
          is most of a screen standing between a visitor and the first price.
          The model is one sentence now; the reason it works that way is a tap
          away for whoever wants it, and the two section headings below answer
          it anyway.
        */}
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-strong sm:text-4xl">
            Plans and pricing
          </h1>
          <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-muted">
            A plan sets how many trucks you can watch. Credits pay for each search and check.
          </p>

          <div className="mt-2 flex justify-center">
            <HelpNote title="Why two things and not one price?">
              A plan is a standing allowance - it decides how many trucks may be under watch at
              once, and nothing more. Credits are the running cost of actually looking: every search
              and every automatic check draws on one balance you top up whenever it runs low. Kept
              apart, a quiet month costs you almost nothing and a busy one does not need a bigger
              plan.
            </HelpNote>
          </div>
        </header>

        {payNote ? (
          <p className="mx-auto mt-6 flex max-w-2xl items-start gap-2.5 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3 text-sm leading-relaxed text-warn-500">
            <Info size={16} className="mt-0.5 shrink-0" />
            <span>{payNote}</span>
          </p>
        ) : null}

        {/* ------------------------------ plans ---------------------------- */}
        <section className="mt-8 sm:mt-10">
          <SectionHeading
            title="Plans"
            body="Every plan comes with credits and can be topped up. Only the truck limit changes."
          />

          {plans.length === 0 ? (
            <Panel className="mt-5">
              <p className="text-sm text-muted">
                No plans are on sale at the moment. Please check back shortly, or get in touch and we
                will tell you when there are.
              </p>
            </Panel>
          ) : (
            <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((plan) => (
                <li key={plan.id} className="panel flex flex-col p-5">
                  <p className="text-sm font-semibold text-strong">{plan.name}</p>
                  {plan.description ? (
                    <p className="mt-1 text-xs leading-relaxed text-muted">{plan.description}</p>
                  ) : null}

                  {/* The whole price and the term it buys. "a month" used to
                      sit under this figure on every row, which was false for
                      the three plans that run ninety days - and false in the
                      customer's favour nowhere. planTermSuffix() reads
                      duration_days, the term the plan actually gets. */}
                  <p className="mt-4 text-3xl font-semibold tabular-nums text-strong">
                    {fmtRupees(planChargeInr(plan))}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">{planTermSuffix(plan)}</p>

                  <ul className="mt-4 space-y-2 border-t border-divider pt-4 text-sm">
                    <Feature icon={<Truck size={13} />}>
                      {plan.truck_limit === -1
                        ? "Unlimited trucks watched at once"
                        : `${plan.truck_limit} truck${plan.truck_limit === 1 ? "" : "s"} watched at once`}
                    </Feature>
                    <Feature icon={<Wallet size={13} />}>
                      {formatCredits(plan.included_credits)} credits included
                    </Feature>
                    {/* Said outright rather than left to the price suffix: the
                        owner's ask is that a plan reads as expiring a stated
                        number of months from the day it starts, and this is the
                        page a stranger decides on. */}
                    <Feature icon={<CalendarClock size={13} />}>
                      {planExpiryNote(plan)}
                    </Feature>
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------------ credits --------------------------- */}
        <section className="mt-9 sm:mt-12">
          <SectionHeading
            title="Buying credits"
            body="Credits never expire, and buying more does not touch your plan. Bigger packs cost less per credit."
          />

          {packs.length === 0 ? (
            <Panel className="mt-5">
              <p className="text-sm text-muted">
                No credit packs are on sale at the moment. Get in touch if you need more credits.
              </p>
            </Panel>
          ) : (
            <ul className="mt-5 space-y-2.5">
              {packs.map((pack) => (
                <PackRow key={pack.id} pack={pack} creditsPerRupee={settings.creditsPerRupee} />
              ))}
            </ul>
          )}
        </section>

        {/* ------------------------- what credits buy ----------------------- */}
        <section className="mt-9 sm:mt-12">
          <SectionHeading
            title="What credits are spent on"
            body="Both kinds of look cost the same: a search you type, and each automatic check of a truck you are watching. So how closely you watch a lorry is what it costs — a faster alert is more checks a day — and pausing a truck stops the meter. Your plan caps how many trucks you may watch at once and for how long; the balance is what the looking is paid from."
          />

          {rates.length === 0 ? (
            <Panel className="mt-5">
              <p className="text-sm text-muted">
                Rates have not been published yet. Get in touch and we will tell you what an action
                costs.
              </p>
            </Panel>
          ) : (
            <>
              <ul className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {rates.map((rate) => (
                  <li key={rate.action} className="panel p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-strong">{rate.label}</p>
                      <Badge tone="brand">{describeRate(rate)}</Badge>
                    </div>
                    {rate.description ? (
                      <p className="mt-2 text-sm leading-relaxed text-muted">{rate.description}</p>
                    ) : null}
                  </li>
                ))}
              </ul>

              <WorkedExample
                rates={rates}
                plans={plans}
                packs={packs}
                intervalMinutes={alertRule ? alertRule.default_interval_minutes : null}
              />
            </>
          )}
        </section>

        {/* ------------------------------ referrals ------------------------- */}
        {settings.referralEnabled ? (
          <section className="mt-9 sm:mt-12">
            <Panel className="border-brand-500/40">
              <div className="flex gap-3.5">
                <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
                  <Gift size={17} />
                </span>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-strong">Invite someone, earn credits</h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink">
                    {describeReferralReward(
                      referralTerms,
                      settings.referralMilestoneCount,
                      settings.referralMilestoneBonus,
                    )}
                  </p>
                  {/* Said plainly because it is the condition, not the small
                      print: a sign-up on its own earns nothing at all. */}
                  <p className="mt-2 text-sm leading-relaxed text-muted">
                    Fixed credits, twice over: once when they buy their first plan, and again when
                    they first top up. Nothing arrives when they merely register.
                  </p>
                  {/* The invitee's half. This is the public page a person
                      holding an invite link reads before deciding, so the half
                      of the offer addressed to THEM belongs here - it was
                      previously said to nobody. Rendered only while the share
                      is switched on. */}
                  {welcomeLine ? (
                    <p className="mt-2 text-sm leading-relaxed text-muted">
                      And it pays both ways. {welcomeLine}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs leading-relaxed text-faint">
                    {signedIn
                      ? "Your invite link is on your account page, ready to share."
                      : "You get your own invite link as soon as you have an account."}
                  </p>
                </div>
              </div>
            </Panel>
          </section>
        ) : null}

        {/* -------------------------------- close --------------------------- */}
        <section className="mt-12 mb-4">
          <div className="panel flex flex-col items-center gap-4 p-6 text-center sm:p-8">
            <h2 className="text-lg font-semibold tracking-tight text-strong">
              {signedIn ? "Ready when you are" : "Start watching your first truck"}
            </h2>
            <p className="max-w-md text-sm leading-relaxed text-muted">
              {signedIn
                ? "Plans and top-ups are both bought from your account page."
                : settings.signupEnabled
                  ? "Registering takes a minute, and nothing is charged until you choose a plan."
                  : "New accounts are not being opened at the moment. Existing accounts work as usual."}
            </p>

            <div className="flex flex-col items-stretch gap-2.5 sm:flex-row sm:items-center">
              {signedIn ? (
                <LinkButton href="/portal/plan" variant="primary">
                  Go to plan and credits
                  <ArrowRight size={14} />
                </LinkButton>
              ) : (
                <>
                  {settings.signupEnabled ? (
                    <LinkButton href="/signup" variant="primary">
                      Create an account
                    </LinkButton>
                  ) : null}
                  <LinkButton
                    href="/login"
                    variant={settings.signupEnabled ? "secondary" : "primary"}
                  >
                    Sign in
                  </LinkButton>
                </>
              )}
            </div>
          </div>
        </section>
      </div>
    </PublicShell>
  );
}

/* -------------------------------------------------------------------------- */
/* pieces                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything the price list is made of, in one round of queries.
 *
 * Empty lists on failure rather than an exception. Each section below already
 * has to say something sensible when the admin has published nothing, so the
 * same wording covers a database that is not answering - and the explanation of
 * how plans and credits fit together survives either way.
 */
async function loadCatalogue(): Promise<{
  plans: Plan[];
  packs: CreditPack[];
  rates: CreditRate[];
  /** The first rule the admin offers, for the worked example's beat. */
  alertRule: AlertRuleTemplate | null;
}> {
  try {
    const admin = getSupabaseAdmin();
    const [planResult, packs, rates, alertResult] = await Promise.all([
      admin
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .order("price_inr"),
      loadCreditPacks(admin),
      loadCreditRates(admin),
      admin
        .from("alert_rule_templates")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .limit(1),
    ]);

    return {
      plans: (planResult.data ?? []) as Plan[],
      packs,
      rates,
      alertRule: ((alertResult.data ?? []) as AlertRuleTemplate[])[0] ?? null,
    };
  } catch (error) {
    reportError("Pricing page: catalogue", error);
    return { plans: [], packs: [], rates: [], alertRule: null };
  }
}

function SectionHeading({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight text-strong sm:text-xl">{title}</h2>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

function Feature({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-sm leading-relaxed text-ink">
      <span className="mt-0.5 shrink-0 text-brand-500">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

/**
 * One rung of the ladder.
 *
 * An open tier is never given a price, only a minimum and a rate: its price_inr
 * is the least it will accept, and printing that as "Rs 3,000 buys 7,500
 * credits" would advertise one purchase out of a range where the buyer picks
 * the amount.
 */
function PackRow({ pack, creditsPerRupee }: { pack: CreditPack; creditsPerRupee: number }) {
  const open = pack.is_open_ended;

  return (
    <li
      className={cx(
        "panel flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 px-5 py-4",
        open && "border-brand-500/40",
      )}
    >
      <div className="min-w-0">
        {open ? (
          <p className="text-base text-strong">
            <span className="font-semibold tabular-nums">{fmtRupees(pack.price_inr)}</span>{" "}
            <span className="text-muted">or more</span>
          </p>
        ) : (
          <p className="text-base text-strong">
            <span className="font-semibold tabular-nums">{fmtRupees(pack.price_inr)}</span>{" "}
            <span className="text-muted">buys</span>{" "}
            <span className="font-semibold tabular-nums">{formatCredits(pack.credits)}</span>{" "}
            <span className="text-muted">credits</span>
          </p>
        )}
        <p className="mt-0.5 text-xs text-faint">{pack.name}</p>
      </div>

      {open ? (
        <p className="text-sm text-brand-500">{describeOpenTier(pack, creditsPerRupee)}</p>
      ) : (
        <p className="text-sm tabular-nums text-muted">
          Rs {rupeesPerCredit(pack).toFixed(2)} a credit
        </p>
      )}
    </li>
  );
}

/**
 * "1 credit = 1 search" is a rate, not an amount, and a rate tells nobody
 * whether their money will last the month. This turns it into a quantity: how
 * far a real number of credits - the ones a plan actually hands over - goes at
 * the rates printed above it.
 *
 * Everything here is arithmetic on figures already on the page. Nothing is
 * estimated, and if the database has no plan and no pack to anchor on, a round
 * number is used and said to be an example.
 */
function WorkedExample({
  rates,
  plans,
  packs,
  intervalMinutes,
}: {
  rates: CreditRate[];
  plans: Plan[];
  packs: CreditPack[];
  /** The default beat of an alert, for the "one truck for how long" sentence. */
  intervalMinutes: number | null;
}) {
  // Anchored on what a plan gives, because that is the first batch of credits
  // anyone here will own. A fixed pack is the next best thing, and a round
  // number the last resort.
  const fromPlan = plans.find((plan) => plan.included_credits > 0)?.included_credits;
  const fromPack = packs.find((pack) => !pack.is_open_ended && pack.credits > 0)?.credits;
  const anchor = fromPlan ?? fromPack ?? FALLBACK_EXAMPLE_CREDITS;
  const anchorIsReal = fromPlan !== undefined || fromPack !== undefined;

  const searchRate = rates.find((rate) => rate.action === CREDIT_ACTIONS.manualSearch);
  const checkRate = rates.find((rate) => rate.action === CREDIT_ACTIONS.autoCheck);

  // One check per truck per due window, whatever else that truck has running:
  // the worker charges the call once and shares it between every alert due.
  const checksPerDay = intervalMinutes && intervalMinutes > 0
    ? Math.floor((24 * 60) / intervalMinutes)
    : null;
  const creditsPerDay =
    checkRate && checksPerDay ? costOf(checkRate.units_per_credit, checksPerDay) : null;
  const daysWatched = creditsPerDay && creditsPerDay > 0 ? Math.floor(anchor / creditsPerDay) : null;

  return (
    <div className="panel mt-3 p-5">
      <p className="text-sm font-semibold text-strong">
        What {formatCredits(anchor)} credits comes to
      </p>
      {anchorIsReal ? null : (
        <p className="mt-1 text-xs text-muted">
          A round number, as an example — the credits your plan gives are listed above.
        </p>
      )}

      <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink">
        {searchRate ? (
          <li>
            <span className="font-semibold tabular-nums text-brand-500">
              {formatCredits(anchor * searchRate.units_per_credit)}
            </span>{" "}
            searches you type in yourself, if you spent every credit that way.
          </li>
        ) : null}

        {checkRate ? (
          <li>
            Or{" "}
            <span className="font-semibold tabular-nums text-brand-500">
              {formatCredits(anchor * checkRate.units_per_credit)}
            </span>{" "}
            background checks of the trucks you are watching.
          </li>
        ) : null}

        {checkRate && checksPerDay && creditsPerDay && daysWatched ? (
          <li className="border-t border-divider pt-2 text-muted">
            Put concretely: one truck with an alert running every {intervalMinutes} minutes is
            checked {checksPerDay} times a day, which is{" "}
            <span className="tabular-nums">{formatCredits(creditsPerDay)}</span> credits a day — so{" "}
            {formatCredits(anchor)} credits keeps that truck watched for about {daysWatched} day
            {daysWatched === 1 ? "" : "s"}. Watch two trucks and it lasts half as long.
          </li>
        ) : null}
      </ul>
    </div>
  );
}
