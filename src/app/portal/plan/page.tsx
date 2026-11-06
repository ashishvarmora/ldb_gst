import { Wallet as PageIcon } from "lucide-react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ChevronRight,
  Gift,
  History,
  Mail,
  Receipt,
  Truck,
  Wallet,
} from "lucide-react";

import { RedeemBonusCode } from "./RedeemBonusCode";
import { startFreeTrial } from "./trial-actions";
import { InviteCard } from "../referrals/InviteCard";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { BuyCredits, BuyPlans } from "@/components/BuyCredits";
import { Disclosure } from "@/components/Disclosure";
import { SupportPanel } from "@/components/SupportLine";
import { Badge, LinkCard, PageHeader, Panel, QuotaBar, buttonClass, cx } from "@/components/ui";
import {
  creditStanding,
  describeRate,
  formatCredits,
  loadCreditPacks,
  loadCreditRates,
  planTermLabel,
  searchesLeft,
  searchesLeftLabel,
} from "@/lib/credits";
import { fmtDate, fmtNumber, istToday } from "@/lib/format";
import {
  graceDaysLeft,
  loadSearchCost,
  requirePortalSession,
  topUpBlockedReason,
} from "@/lib/officer";
import { razorpayConfigured } from "@/lib/razorpay";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditRate, Plan } from "@/lib/types";

export async function generateMetadata() {
  const { brandName } = await loadSettings(getSupabaseAdmin());
  return { title: `Plan and credits — ${brandName}` };
}

/**
 * Where an account becomes able to use the product, and where it stays able to.
 *
 * Two readers, one page. Someone with no plan needs one decision made - try it,
 * or buy it - so that is all they get above the fold. Someone with a plan needs
 * their balance, then a top-up, and everything else folded away.
 *
 * The rule that shapes the copy: a plan sets how many trucks may be watched;
 * credits pay for the searching and checking. Running out of credits is a
 * top-up, never a second copy of the plan.
 *
 * WHAT A CUSTOMER MAY DO TO THEIR OWN PLAN, AND WHAT THEY MAY NOT
 *
 * Exactly two plan purchases are self-service: a first one, and moving off the
 * free trial onto a paid plan. Everything else - a different plan, a bigger
 * plan, a smaller one, a renewal - is a conversation with the owner, on the
 * owner's instruction. So the plan grid appears on this page in those two
 * states and in no others; an account on a paid plan gets a way to reach a
 * human instead of a grid of cards that would take their money for a change
 * nobody had agreed to.
 *
 * Topping up credits is untouched by all of that and stays fully self-service,
 * which is why the top-up panel is unconditional below.
 */
export default async function PlanPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [planResult, rates, packs, settings, searchCost] = await Promise.all([
    /*
     * Every plan, archived ones included, and then filtered below.
     *
     * This query used to carry .eq("is_active", true), which meant an account
     * on an archived plan could not find its own plan row - the page had a
     * comment apologising for it and three branches hedging around the null.
     * The row is needed to answer "what am I on and when does it end", so it is
     * read here and what is FOR SALE is a filter rather than a query.
     */
    admin.from("plans").select("*").order("sort_order").order("price_inr"),
    loadCreditRates(admin),
    loadCreditPacks(admin),
    loadSettings(admin),
    /* React-cached, so the layout's header pill and this page share one read
       of the search rate rather than asking twice per request. */
    loadSearchCost(),
  ]);

  const plans = (planResult.data ?? []) as Plan[];

  /** The paid plans, in order. The trial is claimed, never bought - see below. */
  const onSale = plans.filter((plan) => plan.is_active && !plan.is_trial);
  /** The trial, when there is one on offer. */
  const trialPlan = plans.find((plan) => plan.is_trial && plan.is_active) ?? null;

  /** The plan row they are on, archived or not. Null when there is no plan. */
  const currentPlan = plans.find((plan) => plan.id === overview.plan_id) ?? null;
  const onTrial = currentPlan?.is_trial === true;
  const support = { email: settings.supportEmail, phone: settings.supportPhone };

  const today = istToday();
  const expiresOn = overview.plan_expires_on;
  const expired = expiresOn !== null && expiresOn < today;
  /* Days left to renew and find everything as it was. Null when there is no
     lapsed plan to count from - including a plan with no expiry, which is what
     the founding customers hold and which must never show a countdown. */
  const graceLeft = graceDaysLeft(overview);
  const daysLeft = expiresOn
    ? Math.max(0, Math.ceil((new Date(`${expiresOn}T23:59:59+05:30`).getTime() - Date.now()) / 86_400_000))
    : null;

  /**
   * Why buying is off. razorpayConfigured() reads the environment, so this has
   * to be decided here rather than in the client component. Buying a plan is
   * never blocked by not having one - that is the whole point of the page.
   */
  const payBlocked = !settings.razorpayEnabled
    ? `Online payment is switched off at the moment. Email ${settings.supportEmail || "support"} and they will set your account up.`
    : !razorpayConfigured()
      ? "Online payment is not available yet. Please try again later, or contact support."
      : null;

  /*
   * A top-up needs a plan again - the owner's reversal - so the shop says what
   * is missing instead of taking a tap and then refusing it.
   *
   * The gateway comes first: "online payment is off" is true of the whole page
   * and there is nothing a customer can do about it, whereas "pick a plan" is
   * an instruction they can follow, and offering it while nothing can be paid
   * for at all would send them to a grid that is equally disabled.
   *
   * Same function startCheckout() refuses with, so the panel and the endpoint
   * cannot disagree - and the panel is drawn BELOW the plan grid on this
   * branch, which is what makes "pick a plan above" a true sentence.
   */
  const creditsBlocked = payBlocked ?? topUpBlockedReason(overview);

  /**
   * Whether the trial is worth offering. The database has the final say -
   * start_free_trial() refuses a second one for the same account, mailbox or
   * mobile - and this is only about whether to draw the card at all.
   *
   * plan_assigned_at is set once and never cleared, so an account that has ever
   * held a plan is not shown a button that would come back refused.
   */
  const trialOffered =
    trialPlan !== null && overview.plan_id === null && overview.plan_assigned_at === null;

  /**
   * Whether the trial button will actually work, asked before it is drawn.
   *
   * start_free_trial() refuses an unverified mailbox with 'email_unverified'
   * (see 0045), and startFreeTrial() turned that into "Verify your email
   * address first - open Verify your email from the link on this page." There
   * was no such link. Nothing on this page, or anywhere else under /portal,
   * pointed at /portal/verify-email, so the one refusal written to name its own
   * remedy named a route the reader had no way to reach.
   *
   * So the card asks first and offers the verify screen instead of a button
   * that would come back refused. The refusal stays as the backstop it should
   * always have been - this answer is a render-time read and the endpoint is
   * still the thing that decides - but nobody has to meet it to be told where
   * to go.
   *
   * Read only when the trial is on offer: an account with a plan is never
   * gated on this, and the round trip is not worth making to learn that.
   */
  const emailVerified = trialOffered
    ? (await admin.rpc("email_is_verified", { p_user: overview.id })).data === true
    : true;

  /*
   * The open pack's minimum and rate used to be computed here and appended to
   * both top-up panel descriptions as a sentence. It is gone: BuyCredits draws
   * that pack as a card carrying "Rs 10,000 or more", the minimum, "Rs 1 buys
   * N credits" and a live credit figure against whatever the buyer types - so
   * the sentence was quoting the smallest purchase available to somebody
   * looking straight at the whole ladder.
   */

  /* ---------------------------------------------------------------------- */
  /* nothing running: try it, buy it, or ask us                              */
  /* ---------------------------------------------------------------------- */
  if (!overview.plan_active) {
    /*
     * A lapsed PAID plan is the one state on this page with no button.
     *
     * Renewal is not self-service - that is the owner's instruction - so
     * offering the grid here would sell a renewal the owner wants to handle
     * themselves, and offering nothing at all would leave somebody staring at
     * an expired account with no route anywhere. So it routes to a human.
     *
     * A lapsed TRIAL is the opposite case: buying a first plan is exactly what
     * should happen next, so the grid stays.
     */
    /*
     * Renewal is self-service now, and this is where it happens.
     *
     * The grid used to be replaced with "Renewing is done by us" for a lapsed
     * paid plan. That was right when a renewal needed a term and a price
     * negotiating; a plan now carries its own term and its own price, so the
     * one thing a lapsed customer wants - the same plan again, today - is a
     * button. Renewal is only offered once the plan HAS ended, which is the
     * owner's rule and is why this lives in the !plan_active branch.
     */
    const lapsedPaidPlan = false;

    return (
      <>
        {/* The buying subtitle said "how many trucks you can watch, and the
            credits to spend" - which is the two figures printed on every card
            in the grid below it, and on the three steps under that. The lapsed
            branch keeps its line: it is the one thing that screen has to say
            and there is no grid to say it. */}
        <PageHeader
        icon={<PageIcon size={22} strokeWidth={2} />}
          title={lapsedPaidPlan ? "Your plan has ended" : trialOffered ? "Start with a free trial" : "Choose a plan"}
          subtitle={lapsedPaidPlan ? "Get in touch and we will put it back on." : undefined}
        />

        {expired ? (
          <Notice tone="bad">
            {onTrial ? "Your free trial ended" : "Your plan ended"} on {fmtDate(expiresOn)}, so
            automatic checking and alerts have paused.{" "}
            {graceLeft !== null && graceLeft > 0
              ? `Your trucks are still here - renew within ${graceLeft} ${graceLeft === 1 ? "day" : "days"} and everything carries on exactly where it stopped.`
              : "Your trucks have been switched off, but nothing has been deleted - renew and switch them back on from My trucks."}{" "}
            {/* One sentence for every lapse now. The trial used to be the
                exception - its ending took the credits with it - and 0057
                removed that, so there is no longer a reader for whom this
                sentence would be false. */}
            Manual search still works: your credits never expire.
          </Notice>
        ) : null}

        {/* Four sentences, cut to one. The last two explained what a plan adds
            - which is what the three Step cards below the grid are for, and
            what every card in the grid states in figures. What is left is the
            only thing this reader cannot see anywhere: their balance survived
            the plan. Shown on a finished trial too, since 0057: that balance
            is spendable like any other. */}
        {overview.credits > 0 ? (
          <Notice tone="warn">
            You still have {formatCredits(overview.credits)} credits — they never expire, and still
            buy a search today.
          </Notice>
        ) : null}

        {lapsedPaidPlan ? (
          <Panel
            title="Renewing is done by us"
            description="So that the term and the price are right for how you have actually been using it. Tell us you want it back and we will set it up the same day."
          >
            <SupportPanel support={support} />
          </Panel>
        ) : (
          <>
            {trialOffered && trialPlan ? (
              <TrialCard plan={trialPlan} emailVerified={emailVerified} className="mb-4" />
            ) : null}

            {trialOffered ? (
              <p className="mb-3 text-sm text-muted">Or start on a paid plan straight away.</p>
            ) : null}

            <BuyPlans
              plans={onSale}
              /* The ladder rides along for the optional "add credits to this
                 payment" step - one payment buys both, and a referred buyer's
                 first payment is then the whole figure. */
              packs={packs}
              creditsPerRupee={settings.creditsPerRupee}
              brandName={settings.brandName}
              currentPlan={currentPlan}
              disabledReason={payBlocked}
              standing="none"
            />

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Step n={1} title="Pick a plan">
                It decides how many trucks may be watched at once, and how long for.
              </Step>
              <Step n={2} title="Watching spends credits">
                One credit per check, so a faster alert costs more. Pause a truck to stop it.
              </Step>
              {/* "with a plan or without one" was the promise the old rule
                  made, and the top-up panel three inches below this one now
                  refuses exactly that. Step 1 is the plan; this step is what
                  the plan is spent on, and the one thing worth saying about
                  credits here is that they outlive it. */}
              <Step n={3} title="Credits pay for both">
                They never expire, so a top-up carries on past the term you bought it in.
              </Step>
            </div>
          </>
        )}

        {/*
          The same top-up panel the has-a-plan branch carries, and it has to be
          on this branch too - TOPUP_HREF is /portal/plan#topup, and until now
          that anchor only existed for an account that already had a plan. So
          every top-up link shown to a lapsed customer landed silently at the
          top of the page instead, which is the one reader who is most likely
          to be following one: their credits outlive the plan, so a low balance
          with no plan is a state 0038 deliberately created.

          BELOW the plan grid rather than above it, because a reader who
          arrives at the top of this page should meet the plans first - a plan
          comes with credits and is the better answer if they have not got one.
          Somebody who followed a #topup link is put straight onto this panel
          by the anchor and never sees the ordering. Step 3 immediately above
          promises exactly this, and until now the promise had nothing behind it.
        */}
        {/* No description, on either branch of this page - see the has-a-plan
            one below for what was in it and where each half of it went. */}
        <Panel id="topup" title="Top up credits" className="mt-3 scroll-mt-20">
          <BuyCredits
            packs={packs}
            brandName={settings.brandName}
            creditsPerRupee={settings.creditsPerRupee}
            disabledReason={creditsBlocked}
          />
        </Panel>

        {settings.referralEnabled ? <InviteCard className="mt-3" /> : null}

        {rates.length > 0 ? (
          <Disclosure title="What each action costs" className="mt-3">
            <Rates rates={rates} />
          </Disclosure>
        ) : null}

        <PaymentsLink className="mt-3" />
      </>
    );
  }

  /* ---------------------------------------------------------------------- */
  /* has a plan: balance, top-up, then everything else folded away           */
  /* ---------------------------------------------------------------------- */
  /*
   * The three-way standing, not a two-way one.
   *
   * This was `overview.credits <= 0` under the name lowCredits, so "low" only
   * ever meant "empty" - and it drove both the balance colour and the notice
   * below. A customer holding four credits read a healthy blue number ON THE
   * TOP-UP PAGE ITSELF, which is the one screen where being nearly out is the
   * whole reason they are looking. The floor comes from what a search actually
   * costs, so it follows the admin's rate instead of guessing.
   */
  const standing = creditStanding(overview.credits, searchCost);
  const outOfCredits = standing === "empty";

  /**
   * Out of truck slots. On a trial that is one truck and a paid plan is the
   * answer; on a paid plan credits cannot buy a slot either, but the fix is a
   * conversation rather than a purchase.
   */
  const outOfSlots = overview.truck_limit !== -1 && overview.active_trucks >= overview.truck_limit;
  const endingSoon = daysLeft !== null && daysLeft <= 14;

  return (
    <>
      {/* No subtitle. "What you have left, and how to add more" is the strip
          of three figures and the Top up credits panel, in that order,
          immediately below it. */}
      <PageHeader
        icon={<PageIcon size={22} strokeWidth={2} />}
        title="Plan and credits"
        subtitle="Your balance, your plan, and top-ups."
      />

      {/*
        The trial's own banner, and it says the two things a trial is short of:
        the day it stops, and that one truck is the limit. Deliberately louder
        than the paid-plan notice below - a trial has a deadline, and the whole
        reason it exists is to end in a decision.
      */}
      {onTrial ? (
        <p className="mb-3 flex items-start gap-2.5 rounded-xl border border-brand-500/40 bg-brand-500/8 px-4 py-2.5 text-sm leading-relaxed text-ink">
          <Gift size={16} className="mt-0.5 shrink-0 text-brand-500" />
          <span>
            <span className="font-medium">
              Free trial —{" "}
              {daysLeft === 0
                ? "last day"
                : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}
              .
            </span>{" "}
            {/* "Move to a paid plan below whenever you like" was a pointer to
                a panel headed exactly that, on the same screen. What is left
                is the deadline and the one thing a buyer cannot work out for
                themselves: the days they have left are not carried over. */}
            Ends {fmtDate(expiresOn)}, and stops by itself. A paid term starts the day you buy it —
            the trial&apos;s remaining days are not carried over.
          </span>
        </p>
      ) : daysLeft !== null && daysLeft <= 14 ? (
        <Notice tone="warn">
          Your plan ends in {daysLeft} day{daysLeft === 1 ? "" : "s"}, on {fmtDate(expiresOn)}. Get
          in touch before then and we will put the next term on.
        </Notice>
      ) : null}

      {/* One row for the three numbers that answer "where do I stand". */}
      <Panel className="mb-4" bodyClassName="p-0">
        <div className="grid grid-cols-1 divide-y divide-divider sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="px-4 py-3.5">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Wallet size={12} />
              Credits left
            </p>
            <p
              className={cx(
                "mt-1.5 text-3xl font-semibold tabular-nums",
                standing === "empty"
                  ? "text-bad-500"
                  : standing === "low"
                    ? "text-warn-500"
                    : "text-brand-500",
              )}
            >
              {formatCredits(overview.credits)}
            </p>
            <p className="mt-1 text-xs tabular-nums text-muted">
              {formatCredits(overview.credits_spent_today)} used today ·{" "}
              {formatCredits(overview.credits_spent_month)} this month
            </p>
          </div>

          <div className="px-4 py-3.5">
            <p className="text-xs font-semibold text-muted">
              Your plan
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold text-strong">{overview.plan_name}</span>
              {onTrial ? <Badge tone="brand">Trial</Badge> : <Badge tone="good">Active</Badge>}
              {overview.has_overrides ? <Badge tone="brand">customised</Badge> : null}
            </p>
            <p className="mt-1 text-xs text-muted">
              {/* The term, off duration_days - which is what the end date
                  below was computed from, so the two agree by construction. */}
              {!onTrial && currentPlan && currentPlan.price_inr > 0
                ? `${planTermLabel(currentPlan).toLowerCase()} · `
                : ""}
              {expiresOn ? (
                <>
                  ends {fmtDate(expiresOn)}
                  {daysLeft !== null ? ` (${daysLeft} day${daysLeft === 1 ? "" : "s"} left)` : ""}
                </>
              ) : (
                "no end date"
              )}
            </p>
          </div>

          <div className="px-4 py-3.5">
            <p className="text-xs font-semibold text-muted">
              Trucks watched
            </p>
            <div className="mt-2.5">
              <QuotaBar used={overview.active_trucks} limit={overview.truck_limit} />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              {overview.truck_limit === -1
                ? "No limit on this plan."
                : outOfSlots
                  ? "Every slot is in use."
                  : `${fmtNumber(overview.truck_limit - overview.active_trucks)} more can be added.`}
            </p>

            {/* On a trial there is somewhere to send them; on a paid plan the
                answer is the support panel further down, which the link would
                only duplicate. */}
            {outOfSlots && onTrial ? (
              <Link
                href="#plan"
                className="mt-0.5 inline-flex min-h-9 items-center gap-1 text-xs font-medium text-brand-500 transition hover:underline"
              >
                See plans with more trucks
                <ArrowRight size={13} />
              </Link>
            ) : null}
          </div>
        </div>
      </Panel>

      {/* "Run out" was untrue for a balance of 1 where a search costs 2 - the
          next search is refused either way, so the notice says too low rather
          than nought. Low gets its own, quieter line: nothing is broken yet. */}
      {outOfCredits ? (
        <Notice tone="bad">
          {/* Since 0041 an empty balance stops BOTH halves of the product, so
              this can no longer reassure anybody that the trucks are fine. Two
              branches because the trucks stop for two different reasons and the
              way back is different: top up, or renew. "Until you top up" was in
              the opening sentence and in both branches; it is in one now. */}
          {overview.plan_active
            ? "Your balance is too low: searching is refused, and your trucks have stopped being checked. Both start again the moment you top up."
            : "Your balance is too low to search, and your plan has ended, so nothing is being checked either. Top up to search, renew to start the checking."}
        </Notice>
      ) : standing === "low" ? (
        <Notice tone="warn">
          Running low - about {searchesLeftLabel(searchesLeft(overview.credits, searchCost))} left at
          today&apos;s rate, and the trucks you are watching are spending from the same balance.
        </Notice>
      ) : null}

      {/*
        NO DESCRIPTION. Its three claims are all on screen already.

        "Credits pay for every look at a lorry ... and they never expire" is
        behind the (i) on the balance on the dashboard and in the fold on the
        activity page, and this panel is the one place a reader has already
        decided to buy some. "This does not touch your plan" is the contrast
        card below on a trial, and the Changing your plan fold otherwise. And
        the open pack's minimum, which was appended here as a sentence, is on
        the open pack's own card two inches down - with the rate, the minimum
        and a live credit figure as the buyer types an amount.
      */}
      <Panel id="topup" title="Top up credits" className="mb-3 scroll-mt-20">
        <BuyCredits
          packs={packs}
          brandName={settings.brandName}
          creditsPerRupee={settings.creditsPerRupee}
          disabledReason={creditsBlocked}
        />
      </Panel>

      {/*
        The plan, immediately under the top-up and no further away - but what is
        on offer here depends entirely on which plan is running.

        ON A TRIAL this is the conversion, and it is the most important thing on
        the page after the balance: a grid of paid plans, open, not folded.

        ON A PAID PLAN there is nothing to sell. A customer cannot move plan,
        renew early or downgrade on their own, so this is a route to a human and
        a plain statement of what they are on. The alternative - leaving the grid
        up - is a page that takes money for a change the owner has said they want
        to handle themselves.
      */}
      <div id="plan" className="mb-3 scroll-mt-20">
        {onTrial ? (
          /* No description: the two contrast cards immediately inside this
             panel are the same two facts, side by side, which is the form the
             distinction is actually read in. */
          <Panel title="Move to a paid plan">
            <div className="mb-4 grid gap-2 sm:grid-cols-2">
              <Difference icon={<Wallet size={13} />} title="Topping up credits">
                Adds credits and does nothing else. Your trial still ends on{" "}
                {fmtDate(expiresOn)}.
              </Difference>
              <Difference icon={<Truck size={13} />} title="Buying a plan" highlight>
                Raises the truck limit straight away and starts a paid term from today. The
                plan&apos;s included credits are added on top of the balance you already have.
              </Difference>
            </div>

            <BuyPlans
              plans={onSale}
              /* Same optional top-up step as the first purchase: converting
                 from the trial is the other moment one payment buys both. */
              packs={packs}
              creditsPerRupee={settings.creditsPerRupee}
              brandName={settings.brandName}
              currentPlan={currentPlan}
              disabledReason={payBlocked}
              standing="trial"
            />
          </Panel>
        ) : (
          <Disclosure
            title="Changing your plan"
            hint="A different plan, more trucks, or the next term — all of it goes through us."
            badge={
              outOfSlots ? (
                <Badge tone="warn">Every slot in use</Badge>
              ) : endingSoon ? (
                <Badge tone="warn">Ends soon</Badge>
              ) : null
            }
            defaultOpen={outOfSlots || endingSoon}
          >
            {/* The sentence that used to open this fold - "You are on Base,
                watching up to 5 trucks at once, until 12 August" - was the
                three-figure strip at the top of this page written out as
                prose. It is deleted rather than moved: the strip is above the
                fold and this was below it.

                What is left is the answer to the question most people open
                this fold with, in one line rather than three. */}
            <p className="mb-3 text-xs leading-relaxed text-muted">
              Credits you can change yourself, above, without touching the plan. A different truck
              limit or another term is a conversation — tell us what you need.
            </p>

            {overview.has_overrides ? (
              <p className="mb-3 text-xs leading-relaxed text-warn-500">
                Your limits have been adjusted by hand for this account, so they may not match the
                plan as listed. Mention that when you get in touch.
              </p>
            ) : null}

            <SupportPanel support={support} />
          </Disclosure>
        )}
      </div>

      {/* The other way to get credits, right where someone is deciding how
          much to spend on them. */}
      <RedeemBonusCode className="mb-3" />

      {settings.referralEnabled ? <InviteCard className="mb-3" /> : null}

      <div className="space-y-3">
        {/*
          The credit history used to be rendered here as well, from a view that
          had rolled the truck away - two screens showing one account's spending
          and neither able to say which lorry caused it. It lives in one place
          now and this links to it. The anchor stays so older links still land.
        */}
        <div id="history" className="scroll-mt-20">
          <Link
            href="/portal/activity"
            className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3.5 transition hover:border-brand-500/50 hover:bg-sunken"
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-500">
              <History size={16} />
            </span>
            {/* The second line here listed the destination's own Group by
                toggles. A link says where it goes; it does not need to
                describe the controls waiting at the other end. */}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">Credits and activity</span>
            </span>
            <ChevronRight size={16} className="shrink-0 text-faint" />
          </Link>
        </div>

        <PaymentsLink />

        {/* The hint said "How far one credit goes", under a title that says
            what each action costs. Same sentence, one line apart. */}
        <Disclosure title="What each action costs">
          <Rates rates={rates} />
        </Disclosure>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* pieces                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The trial, offered once.
 *
 * Deliberately a panel of its own above the paid grid rather than a fourth card
 * in it. It is not a cheaper plan - it is free, it lasts days rather than
 * months, it watches one truck, and it can only ever be taken once - so putting
 * it in a row of price cards would invite a comparison on price, which is the
 * one axis it wins on and the one that tells a buyer nothing.
 *
 * Every number here is read off the plan row, so an admin changing the offer on
 * the Plans tab changes this card with it. Nothing about "7 days" or "15
 * credits" is written into this file.
 */
function TrialCard({
  plan,
  emailVerified,
  className,
}: {
  plan: Plan;
  emailVerified: boolean;
  className?: string;
}) {
  const days = plan.trial_days ?? 7;
  const trucks =
    plan.truck_limit === -1
      ? "as many trucks as you like"
      : `${plan.truck_limit} truck${plan.truck_limit === 1 ? "" : "s"}`;

  return (
    <div
      className={cx(
        "rounded-xl border border-brand-500/50 bg-brand-500/8 p-4 ring-1 ring-brand-500/15",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-semibold text-strong">
          <Gift size={15} className="shrink-0 text-brand-500" />
          {plan.name}
        </p>
        <Badge tone="good">No payment</Badge>
      </div>

      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-strong">Free</span>
        <span className="text-xs text-muted">
          for {days} day{days === 1 ? "" : "s"}
        </span>
      </p>

      {plan.description ? (
        <p className="mt-1.5 text-xs leading-relaxed text-muted">{plan.is_trial ? "A one-time trial for your account. No payment required." : plan.description}</p>
      ) : null}

      <ul className="mt-3 space-y-1.5 border-t border-brand-500/20 pt-3">
        {/* Not "enough for N searches" any more. Since 0041 the same balance
            pays for the automatic checks as well, and a watched truck spends
            far faster than anybody types - so quoting the credits as searches
            would set an expectation the trial cannot meet. The honest framing
            is that this is one small pot for both. */}
        <TrialPoint icon={<Wallet size={13} />}>
          {formatCredits(plan.included_credits)} credits — for searches you type or checks of the
          truck you watch
        </TrialPoint>
        <TrialPoint icon={<Truck size={13} />}>
          {trucks} watched automatically, at one credit a check
        </TrialPoint>
        <TrialPoint icon={<CalendarDays size={13} />}>
          Ends by itself after {days} day{days === 1 ? "" : "s"} — and the credits end with it
        </TrialPoint>
      </ul>

      {/* One trial per customer, said before the button rather than after it
          comes back refused. */}
      <p className="mt-3 text-[11px] leading-relaxed text-faint">
        One trial per customer. You can move to a paid plan at any time, during the trial or after
        it has ended.
      </p>

      {/*
        One step, or the button. Not both, and not the button alone.

        A trial that cannot be claimed until the mailbox is proved needs the
        proving to look like the next step rather than like an error - so the
        unverified card carries the same primary control in the same place,
        pointing one route further back. The reason is one line above it,
        because "Verify your email" where "Start the free trial" was expected
        is a substitution somebody has to be told about.
      */}
      {emailVerified ? (
        <ActionForm action={startFreeTrial} closeOnSuccess={false} className="mt-3">
          <SubmitButton pendingLabel="Starting...">Start the free trial</SubmitButton>
        </ActionForm>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-xs leading-relaxed text-muted">
            One step first: the trial needs a verified email address. We will send a six-digit code
            — it takes a minute.
          </p>
          <Link href="/portal/verify-email" className={buttonClass("primary", "md")}>
            <Mail size={14} />
            Verify your email
          </Link>
        </div>
      )}
    </div>
  );
}

function TrialPoint({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-xs leading-relaxed text-ink">
      <span className="mt-0.5 shrink-0 text-brand-500">{icon}</span>
      <span>{children}</span>
    </li>
  );
}

function Notice({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  const Icon = tone === "bad" ? AlertTriangle : CalendarDays;
  return (
    <p
      className={cx(
        "mb-3 flex items-start gap-2.5 rounded-xl border px-4 py-2.5 text-sm leading-relaxed",
        tone === "bad"
          ? "border-bad-500/40 bg-bad-500/10 text-bad-500"
          : "border-warn-500/40 bg-warn-500/10 text-warn-500",
      )}
    >
      <Icon size={16} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * One half of the top-up / buy-a-plan contrast, side by side so the distinction
 * is read rather than remembered.
 *
 * Both buttons on this page open the same payment window and take the same
 * money, and the only difference is what arrives afterwards - which is exactly
 * the sort of difference a sentence buried in a panel description does not
 * convey. The plan is the highlighted half because it is the one being offered
 * here; topping up is on screen for comparison.
 */
function Difference({
  icon,
  title,
  highlight = false,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cx(
        "rounded-lg border px-3 py-2.5",
        highlight ? "border-brand-500/40 bg-brand-500/8" : "border-line bg-raised/60",
      )}
    >
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
        <span className="shrink-0 text-brand-500">{icon}</span>
        {title}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{children}</p>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="panel flex items-start gap-3 px-4 py-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-xs font-semibold text-brand-500">
        {n}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{title}</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">{children}</span>
      </span>
    </div>
  );
}

function Rates({ rates }: { rates: CreditRate[] }) {
  if (rates.length === 0) {
    return <p className="text-sm text-muted">No rates are set yet. Contact support to find out what an action costs.</p>;
  }
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {rates.map((rate) => (
        <li key={rate.action}>
          <p className="text-sm font-medium text-ink">{rate.label}</p>
          <p className="mt-0.5 text-sm text-brand-500">{describeRate(rate)}</p>
          {rate.description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{rate.description}</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}


/**
 * Where the payments went.
 *
 * This page used to render the payment history itself, folded away six rows at
 * a time: an amount, a date and a badge, with no reference, no method and no
 * way to filter by date. It has its own page now, built for the conversation it
 * actually gets used in - see /portal/payments - and this names it rather than
 * keeping a shorter second copy beside it.
 */
function PaymentsLink({ className }: { className?: string }) {
  return (
    /* The anchor stays. /portal/plan#payments and ?show=payments are in older
       menus and in messages already sent, and landing on the link to the new
       page is a better answer to those than landing on nothing at all. */
    <div id="payments" className={cx("scroll-mt-20", className)}>
      {/* The description listed the columns of the table this leads to. */}
      <LinkCard href="/portal/payments" icon={<Receipt size={16} />} title="Payment history" />
    </div>
  );
}
