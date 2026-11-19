import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircle2, Clock, Coins, Gift, Share2, UserPlus, Users, Wallet } from "lucide-react";

import { ShareLink } from "./ShareLink";
import { Pager, pageFromParam, pageSlice, pagerHref } from "@/components/Pager";
import {
  Badge,
  EmptyState,
  LinkButton,
  PageHeader,
  Panel,
  StatCard,
  cx,
} from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { env } from "@/lib/env";
import { HelpNote } from "@/components/Disclosure";
import { InfoTip } from "@/components/InfoTip";
import { fmtDate, fmtNumber, fmtRupees } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import {
  loadReferrals,
  loadReferralSummary,
  loadReferralTerms,
  referralExample,
  referralLink,
  referralOfferHeadline,
  referralPercent as pct,
  referralStage,
  type ReferralRow,
  type ReferralTerms,
} from "@/lib/referrals";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Referral, ReferralSummary } from "@/lib/types";

/** Short enough that the first page fits on a phone without a long scroll. */
const PAGE_SIZE = 10;

export async function generateMetadata() {
  const { brandName } = await loadSettings(getSupabaseAdmin());
  return { title: `Invite & earn — ${brandName}` };
}

/**
 * Refer & earn.
 *
 * Phone-first order: the offer, the link with Copy and WhatsApp, the three
 * steps, the reader's own numbers, the bonus, then the people. Every figure is
 * read from the live settings (percentages via loadReferralTerms, minimum
 * payment and milestone via loadSettings) - nothing about the reward is typed
 * into this file. The rules live behind the (i) on "How it works".
 *
 * Nothing here grants anything. reward_referral() does that inside
 * settle_payment; this page only reports what it has already decided. One rule
 * drives every line: an invite earns nothing until the person pays.
 */
export default async function ReferralsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { overview, profile } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [settings, terms, summary, referrals, milestoneRows, params] = await Promise.all([
    loadSettings(admin),
    loadReferralTerms(admin),
    loadReferralSummary(admin, overview.id),
    loadReferrals(admin, overview.id),
    // The milestone bonus is granted straight to the balance and is not part of
    // any referral row, so referral_summary cannot see it.
    admin
      .from("credit_transactions")
      .select("delta")
      .eq("user_id", overview.id)
      .eq("reason", "referral_milestone"),
    searchParams,
  ]);

  if (!settings.referralEnabled) return <SwitchedOff />;

  const code = summary?.referral_code ?? profile.referral_code;
  const counts = tally(summary, referrals);

  const milestoneCredits = (milestoneRows.data ?? []).reduce(
    (sum, row) => sum + Number((row as { delta: number }).delta ?? 0),
    0,
  );
  const totalEarned = counts.credits_earned + milestoneCredits;

  const hasMilestone = settings.referralMilestoneCount > 0 && settings.referralMilestoneBonus > 0;

  // Waiting first: those are the answer to "why have I not been paid yet".
  const ordered = [
    ...referrals.filter((row) => row.status !== "rewarded"),
    ...referrals.filter((row) => row.status === "rewarded"),
  ];

  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const page = pageFromParam(params.page, pages);
  const visible = pageSlice(ordered, page, PAGE_SIZE);

  const example = referralExample(terms);

  /*
   * Which events actually pay. An admin can set an event to 0%, and the page
   * must not then promise "both get credits" or show an example of nought.
   */
  const paysPlan = terms.planReferrerPercent > 0 || terms.planInviteePercent > 0;
  const paysTopup = terms.topupReferrerPercent > 0 || terms.topupInviteePercent > 0;
  const paysInvitee = terms.planInviteePercent > 0 || terms.topupInviteePercent > 0;
  const paysReferrer = terms.planReferrerPercent > 0 || terms.topupReferrerPercent > 0;

  return (
    <>
      {/* ------------------------------- hero ----------------------------- */}
      <Hero
        headline={referralOfferHeadline(terms)}
        sub={
          paysReferrer
            ? paysInvitee
              ? "You earn when they pay. They get credits too."
              : "You earn when they pay."
            : null
        }
      />

      {/* ------------------------------- share ---------------------------- */}
      <Panel id="share" title="Your invite link" className="mb-3 scroll-mt-20">
        {code ? (
          <ShareLink
            link={referralLink(env.siteUrl, code)}
            code={code}
            brandName={settings.brandName}
            inviteeEarns={paysInvitee}
          />
        ) : (
          /* The code comes from a trigger on the profile, so this is close to
             impossible - but a missing link is not something to render blank. */
          <p className="text-sm leading-relaxed text-muted">
            Your link is still being set up. Please refresh in a minute, or contact support if
            it does not appear.
          </p>
        )}
      </Panel>

      {/* ---------------------------- how it works ------------------------ */}
      <Panel className="mb-3">
        <InfoTip
          label="the rules"
          rowClassName="justify-between"
          info={
            <Rules
              terms={terms}
              paysPlan={paysPlan}
              paysTopup={paysTopup}
              minPayment={settings.referralMinPayment}
              milestoneCount={hasMilestone ? settings.referralMilestoneCount : 0}
              milestoneBonus={hasMilestone ? settings.referralMilestoneBonus : 0}
            />
          }
        >
          <h2 className="text-base font-bold text-strong">How it works</h2>
        </InfoTip>

        <ol className="mt-3 space-y-2.5">
          <Step n={1} icon={<Share2 size={15} />} title="Share your link">
            Send it on WhatsApp or copy it.
          </Step>
          <Step n={2} icon={<UserPlus size={15} />} title="They join and pay">
            Your friend signs up with your link and makes a payment.
          </Step>
          <Step n={3} icon={<Wallet size={15} />} title={paysInvitee ? "You both get credits" : "You get credits"}>
            Added to your balance automatically.
          </Step>
        </ol>

        {paysPlan || paysTopup ? (
          <div className="mt-4 rounded-xl border border-brand-500/20 bg-brand-500/6 px-3.5 py-3">
            <p className="mb-2 text-xs font-semibold text-muted">For example (in credits)</p>
            <div
              className={cx(
                "grid max-w-md items-baseline gap-x-3 gap-y-1.5 text-[13px] tabular-nums",
                paysInvitee ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]",
              )}
            >
              <span />
              <ColHead>You get</ColHead>
              {paysInvitee ? <ColHead>Friend gets</ColHead> : null}

              {paysPlan ? (
                <>
                  <span className="text-muted">Plan of {fmtRupees(example.planInr)}</span>
                  <Figure value={example.planReferrer} />
                  {paysInvitee ? <Figure value={example.planInvitee} muted /> : null}
                </>
              ) : null}

              {paysTopup ? (
                <>
                  <span className="text-muted">Top-up of {fmtRupees(example.topupInr)}</span>
                  <Figure value={example.topupReferrer} />
                  {paysInvitee ? <Figure value={example.topupInvitee} muted /> : null}
                </>
              ) : null}

              {paysPlan && paysTopup ? (
                <>
                  <span className="col-span-full border-t border-brand-500/20" />
                  <span className="font-semibold text-ink">Total</span>
                  <Figure value={example.referrerTotal} total />
                  {paysInvitee ? <Figure value={example.inviteeTotal} total muted /> : null}
                </>
              ) : null}
            </div>
          </div>
        ) : null}
      </Panel>

      {/* ------------------------------- stats ---------------------------- */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Joined"
          value={fmtNumber(counts.invited)}
          sub="used your link"
          icon={<Users size={14} />}
        />
        <StatCard
          label="Yet to pay"
          value={fmtNumber(counts.waiting)}
          sub="no credits yet"
          tone={counts.waiting > 0 ? "warn" : "neutral"}
          icon={<Clock size={14} />}
        />
        <StatCard
          label="Paid"
          value={fmtNumber(counts.paid)}
          sub="made a payment"
          tone={counts.paid > 0 ? "good" : "neutral"}
          icon={<CheckCircle2 size={14} />}
        />
        <StatCard
          label="Credits earned"
          value={formatCredits(totalEarned)}
          sub={
            milestoneCredits > 0
              ? `incl. ${formatCredits(milestoneCredits)} bonus`
              : "on your balance"
          }
          tone={totalEarned > 0 ? "brand" : "neutral"}
          icon={<Coins size={14} />}
        />
      </div>

      {/* Nothing to track when the admin has not set a milestone. */}
      {hasMilestone ? (
        <Milestone
          paid={counts.paid}
          need={settings.referralMilestoneCount}
          bonus={settings.referralMilestoneBonus}
          alreadyPaid={milestoneCredits > 0}
        />
      ) : null}

      {/* ------------------------------- people --------------------------- */}
      {/* Turning a page lands back on the list rather than at the top. */}
      <div id="people" className="scroll-mt-20">
        <Panel title="People you invited" bodyClassName="p-0">
          {ordered.length === 0 ? (
            <EmptyState
              icon={<Gift size={24} strokeWidth={1.9} />}
              title="No one has joined yet"
              description="Send your link to a transporter you know. When they join, you will see them here."
              action={
                <LinkButton href="#share" variant="primary">
                  <Share2 size={15} />
                  Share your link
                </LinkButton>
              }
            />
          ) : (
            <>
              <Legend paysPlan={paysPlan} paysTopup={paysTopup} />
              <ul className="divide-y divide-divider">
                {visible.map((referral) => (
                  <InviteRow
                    key={referral.id}
                    referral={referral}
                    planPaysYou={terms.planReferrerPercent > 0}
                    topupPaysYou={terms.topupReferrerPercent > 0}
                  />
                ))}
              </ul>
              <Pager
                page={page}
                total={ordered.length}
                pageSize={PAGE_SIZE}
                href={(n) => `${pagerHref({ path: "/portal/referrals" }, n)}#people`}
                noun="people"
                className="px-4 pt-1 pb-3"
              />
            </>
          )}
        </Panel>
      </div>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* pieces                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The view is the authority, but it is a left join over every profile and a
 * missing row would render four dashes. Counting the rows we already hold costs
 * nothing and means the page is never blank.
 */
function tally(
  summary: ReferralSummary | null,
  referrals: Referral[],
): Pick<ReferralSummary, "invited" | "paid" | "waiting" | "credits_earned"> {
  if (summary) {
    return {
      invited: Number(summary.invited ?? 0),
      paid: Number(summary.paid ?? 0),
      waiting: Number(summary.waiting ?? 0),
      credits_earned: Number(summary.credits_earned ?? 0),
    };
  }

  const paid = referrals.filter((row) => row.status === "rewarded");
  return {
    invited: referrals.length,
    paid: paid.length,
    waiting: referrals.length - paid.length,
    credits_earned: paid.reduce((sum, row) => sum + Number(row.reward_credits ?? 0), 0),
  };
}

/**
 * The top card: the page's h1 and the live offer. Same blue card and gold gift
 * as the InviteCard that links here from Home and the plan page, so the reader
 * lands on the thing they tapped.
 */
function Hero({ headline, sub }: { headline: string; sub: string | null }) {
  return (
    <section className="invite-card relative isolate mb-3 overflow-hidden rounded-[20px] bg-navy px-5 py-5 text-white">
      <span
        aria-hidden
        className="absolute -right-8 -bottom-16 -z-10 size-40 rounded-full bg-white/[0.07]"
      />
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[22px] leading-tight font-bold sm:text-[26px]">
            Invite a transporter, earn credits
          </h1>
          <p className="mt-2 text-[17px] leading-snug font-bold text-[#ffb134]">{headline}</p>
          {sub ? <p className="mt-1 text-sm leading-relaxed text-white/80">{sub}</p> : null}
        </div>
        <Gift
          size={44}
          strokeWidth={1.6}
          aria-hidden
          className="invite-gift mt-1 shrink-0 -rotate-6"
        />
      </div>
    </section>
  );
}

/** One of the three steps. Stacked on a phone, so each line has room. */
function Step({
  n,
  icon,
  title,
  children,
}: {
  n: number;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex items-start gap-3">
      <span
        aria-hidden
        className="relative inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-brand-500"
      >
        {icon}
        <span className="absolute -top-1 -right-1 inline-flex size-4 items-center justify-center rounded-full bg-brand-500 text-[10px] font-bold text-on-brand">
          {n}
        </span>
      </span>
      <span className="min-w-0 pt-0.5">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted">{children}</span>
      </span>
    </li>
  );
}

/** "20% of their first plan and 20% of their first top-up" - or one half. */
function shares(planPercent: number, topupPercent: number): string | null {
  const parts: string[] = [];
  if (planPercent > 0) parts.push(`${pct(planPercent)} of their first plan`);
  if (topupPercent > 0) parts.push(`${pct(topupPercent)} of their first top-up`);
  return parts.length ? parts.join(" and ") : null;
}

/**
 * Everything the page used to say in paragraphs, as short lines behind the (i).
 * Each line that depends on a setting is built from it, or left out when the
 * setting is off.
 */
function Rules({
  terms,
  paysPlan,
  paysTopup,
  minPayment,
  milestoneCount,
  milestoneBonus,
}: {
  terms: ReferralTerms;
  paysPlan: boolean;
  paysTopup: boolean;
  minPayment: number;
  milestoneCount: number;
  milestoneBonus: number;
}) {
  const you = shares(terms.planReferrerPercent, terms.topupReferrerPercent);
  const them = shares(terms.planInviteePercent, terms.topupInviteePercent);

  return (
    <ul className="list-disc space-y-1.5 pl-4">
      <li>You earn only when your friend makes a payment. Signing up alone does not count.</li>
      {you ? <li>You get {you}, as credits.</li> : <li>Referral rewards are not active right now.</li>}
      {them ? <li>Your friend gets {them}, as credits.</li> : null}
      {paysPlan && paysTopup ? (
        <li>
          You earn at most twice per friend: on their first plan and on their first top-up. If
          they buy both in one payment, both rewards are added together.
        </li>
      ) : paysPlan || paysTopup ? (
        <li>Each friend earns you a reward only once.</li>
      ) : null}
      <li>Rewards are based on the amount paid after any discount, rounded to whole credits.</li>
      {minPayment > 0 ? (
        <li>
          Payments under {fmtRupees(minPayment)} do not count. A bigger payment later still can.
        </li>
      ) : null}
      {milestoneCount > 0 && milestoneBonus > 0 ? (
        <li>
          Bonus: {formatCredits(milestoneBonus)} extra credits when {fmtNumber(milestoneCount)}{" "}
          friends have paid.
        </li>
      ) : null}
      <li>Your friend must sign up with your link or code. You cannot invite yourself.</li>
      <li>
        Credits are not cash. They cannot be withdrawn or sent to someone else. They never expire
        and work just like credits you buy.
      </li>
      <li>Rates may change, but credits you have earned stay yours.</li>
      <li>
        See your balance on{" "}
        <Link href="/portal/plan" className="link">
          Plan and credits
        </Link>
        .
      </li>
    </ul>
  );
}

/** A column head on the worked example. */
function ColHead({ children }: { children: ReactNode }) {
  return <span className="text-right text-xs font-semibold text-faint">{children}</span>;
}

/**
 * One credit figure in the worked example. A dash rather than "+0" when a
 * percentage is switched off; the total drops the plus sign.
 */
function Figure({ value, total, muted }: { value: number; total?: boolean; muted?: boolean }) {
  return (
    <span
      className={cx(
        "text-right font-semibold",
        total ? "text-lg" : "",
        value <= 0 ? "text-faint" : muted ? "text-ink" : "text-brand-500",
      )}
    >
      {value <= 0 ? "—" : total ? formatCredits(value) : `+${formatCredits(value)}`}
    </span>
  );
}

/** What the labels on each row mean - folded, one tap away. */
function Legend({ paysPlan, paysTopup }: { paysPlan: boolean; paysTopup: boolean }) {
  return (
    <div className="border-b border-divider bg-raised/50 px-4 py-1.5">
      <HelpNote title="What do the labels mean?">
        <span className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-baseline gap-1.5">
            <Badge tone="warn">Waiting</Badge>
            <span>Joined, not paid yet.</span>
          </span>
          {paysPlan && paysTopup ? (
            <>
              <span className="flex flex-wrap items-baseline gap-1.5">
                <Badge tone="brand">Part paid</Badge>
                <span>One reward done, one more to come.</span>
              </span>
              <span className="flex flex-wrap items-baseline gap-1.5">
                <Badge tone="good">Both paid</Badge>
                <span>Plan and top-up rewards both done.</span>
              </span>
            </>
          ) : (
            <span className="flex flex-wrap items-baseline gap-1.5">
              <Badge tone="good">Paid</Badge>
              <span>Reward done.</span>
            </span>
          )}
        </span>
      </HelpNote>
    </div>
  );
}

/**
 * The badge and the status line for one row.
 *
 * "Part paid" only when the other event can still pay this reader something.
 * With that event at 0% there is nothing more to come, and "more when they top
 * up" would be a promise the ledger never keeps.
 */
function rowStatus(
  stage: ReturnType<typeof referralStage>,
  planPaysYou: boolean,
  topupPaysYou: boolean,
): { tone: "warn" | "brand" | "good"; badge: string; line: string } {
  switch (stage) {
    case "waiting":
      return { tone: "warn", badge: "Waiting", line: "Not paid yet" };
    case "plan":
      return topupPaysYou
        ? { tone: "brand", badge: "Part paid", line: "Bought a plan · more when they top up" }
        : { tone: "good", badge: "Paid", line: "Bought a plan" };
    case "topup":
      return planPaysYou
        ? { tone: "brand", badge: "Part paid", line: "Topped up · more when they buy a plan" }
        : { tone: "good", badge: "Paid", line: "Topped up" };
    case "both":
      return {
        tone: "good",
        badge: planPaysYou && topupPaysYou ? "Both paid" : "Paid",
        line: "Plan and top-up done",
      };
  }
}

/** One person invited: name, status line, and what they have earned you. */
function InviteRow({
  referral,
  planPaysYou,
  topupPaysYou,
}: {
  referral: ReferralRow;
  planPaysYou: boolean;
  topupPaysYou: boolean;
}) {
  const stage = referralStage(referral);
  const { tone, badge, line } = rowStatus(stage, planPaysYou, topupPaysYou);
  const paid = stage !== "waiting";
  const name = referral.referred?.full_name?.trim();
  const email = referral.referred?.email;

  return (
    <li
      className={cx(
        "flex items-start justify-between gap-3 border-l-2 px-4 py-3",
        tone === "good" ? "border-l-good-500" : tone === "brand" ? "border-l-brand-500" : "border-l-warn-500",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-ink">
          {name || email || "Someone you invited"}
        </p>
        {name && email ? <p className="truncate text-xs text-faint">{email}</p> : null}
        <p className={cx("mt-1 text-[13px] leading-snug", paid ? "text-muted" : "text-warn-500")}>
          {line}
        </p>
        <p className="mt-0.5 text-xs text-faint">
          {paid
            ? `${referral.first_amount ? `Paid ${fmtRupees(referral.first_amount)} · ` : ""}${fmtDate(referral.rewarded_at)}`
            : `Joined ${fmtDate(referral.created_at)}`}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <Badge tone={tone}>{badge}</Badge>
        {paid ? (
          <p
            className={cx(
              "mt-1.5 text-sm font-semibold tabular-nums",
              tone === "good" ? "text-good-500" : "text-brand-500",
            )}
          >
            +{formatCredits(referral.reward_credits)}
            <span className="block text-[11px] font-normal text-faint">credits</span>
          </p>
        ) : (
          <p className="mt-1.5 text-[11px] leading-tight text-faint">No credits yet</p>
        )}
      </div>
    </li>
  );
}

/** How close the bonus is: one sentence, then the bar. */
function Milestone({
  paid,
  need,
  bonus,
  alreadyPaid,
}: {
  paid: number;
  need: number;
  bonus: number;
  alreadyPaid: boolean;
}) {
  const reached = paid >= need;
  const togo = Math.max(need - paid, 0);
  const ratio = Math.min(need > 0 ? paid / need : 0, 1);

  return (
    <Panel className="mb-3">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className={cx(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-full",
            reached ? "bg-good-500/12 text-good-500" : "bg-brand-500/12 text-brand-500",
          )}
        >
          {reached ? <CheckCircle2 size={20} /> : <Gift size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-strong">
            Bonus: {formatCredits(bonus)} credits
          </h2>
          <p className={cx("mt-0.5 text-sm leading-relaxed", reached ? "text-good-500" : "text-muted")}>
            {reached
              ? alreadyPaid
                ? "Bonus unlocked and added to your balance."
                : "Bonus unlocked."
              : `${fmtNumber(togo)} more ${togo === 1 ? "friend needs" : "friends need"} to pay to unlock it.`}
          </p>
        </div>
      </div>

      <div className="mt-3">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted">Friends who paid</span>
          <span className="font-medium tabular-nums text-ink">
            {fmtNumber(Math.min(paid, need))}
            <span className="text-faint"> / {fmtNumber(need)}</span>
          </span>
        </div>
        {/* Not QuotaBar: that turns red at the top of its range, which is right
            for a limit being used up and wrong for a target being reached. */}
        <div
          className="h-2.5 w-full overflow-hidden rounded-full bg-sunken"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={need}
          aria-valuenow={Math.min(paid, need)}
          aria-label="Friends who paid"
        >
          <div
            className={cx("h-full rounded-full transition-all", reached ? "bg-good-500" : "bg-brand-500")}
            style={{ width: `${Math.max(ratio * 100, paid > 0 ? 4 : 0)}%` }}
          />
        </div>
      </div>
    </Panel>
  );
}

/** Referrals switched off. Not an error, and not a page left half-rendered. */
function SwitchedOff() {
  return (
    <>
      <PageHeader icon={<Gift size={22} strokeWidth={2} />} title="Invite & earn" />
      <Panel>
        <p className="text-[15px] font-semibold text-strong">Invite &amp; earn is paused right now.</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Please check back later.
        </p>
        <div className="mt-4">
          <LinkButton href="/portal" variant="secondary">
            Back to home
          </LinkButton>
        </div>
      </Panel>
    </>
  );
}
