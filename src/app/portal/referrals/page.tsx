import Link from "next/link";
import type { ReactNode } from "react";
import { CheckCircle2, Clock, Coins, Gift, Users } from "lucide-react";

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
} from "@/lib/referrals";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Referral, ReferralSummary } from "@/lib/types";

/** Short enough that the first page fits on a phone without a long scroll. */
const PAGE_SIZE = 10;

export async function generateMetadata() {
  const { brandName } = await loadSettings(getSupabaseAdmin());
  return { title: `Invite and earn — ${brandName}` };
}

/**
 * Invite someone, and earn when they pay.
 *
 * One rule decides everything on this page, so it is said in the header, said
 * again beside the link, and then shown on every row: a referral earns nothing
 * until the person invited makes their FIRST PAYMENT. A page that counted
 * sign-ups would be promising money that is not coming.
 *
 * Nothing here grants anything. reward_referral() does that inside
 * settle_payment, on the one path from "money arrived" to "everyone owed was
 * paid". This only reports what that has already decided.
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
    // any referral row, so referral_summary cannot see it. Without this the
    // page would understate what the scheme has actually paid out.
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

  // Waiting first: those are the only ones the reader can do anything about,
  // and they are the answer to "why have I not been paid yet". Newest first
  // within each group, which is how the query already returns them.
  const ordered = [
    ...referrals.filter((row) => row.status !== "rewarded"),
    ...referrals.filter((row) => row.status === "rewarded"),
  ];

  const pages = Math.max(1, Math.ceil(ordered.length / PAGE_SIZE));
  const page = pageFromParam(params.page, pages);
  const visible = pageSlice(ordered, page, PAGE_SIZE);

  /* The arithmetic on the face of the page, off the live percentages. */
  const example = referralExample(terms);

  /*
   * Which of the two events actually pays somebody.
   *
   * Not decoration: an admin can set an event to 0 per cent, and this page must
   * not then promise a reader they are "paid twice" and show them a worked
   * example of nought credits. The database still closes a 0 event - that is
   * deliberate, so raising the percentage later cannot back-pay every old
   * referral at once - which means the only place the reader is protected from
   * the wrong promise is here.
   */
  const paysPlan = terms.planReferrerPercent > 0 || terms.planInviteePercent > 0;
  const paysTopup = terms.topupReferrerPercent > 0 || terms.topupInviteePercent > 0;
  /* The invitee's whole column disappears when neither welcome share is set,
     rather than standing there as a pair of dashes headed "they get". */
  const paysInvitee = terms.planInviteePercent > 0 || terms.topupInviteePercent > 0;

  return (
    <>
      {/* No subtitle. It said "share your link with someone who runs trucks",
          which is the page title as an instruction - and the offer card below
          makes the case for sharing far better than a line of encouragement. */}
      <PageHeader title="Invite and earn credits" />

      {/* --------------------------- the offer and the link ---------------- */}
      {/*
        ONE CARD, BECAUSE IT IS ONE THOUGHT: here is what an invite pays, here
        is the thing you send.

        This was four stacked blocks - a panel description, a tinted callout of
        two or three sentences, a bordered "for example" box and a folded note -
        and on a 390px phone the reader met roughly a hundred and thirty words
        before reaching a figure. The owner's verdict was that it read as messy
        text, and that the detail belongs behind an (i).

        So the offer is now figures: a headline carrying the live percentage,
        the worked example as a small three-column table, and a caption. Every
        number in it is computed from the live settings - see referralExample -
        so an admin editing a percentage cannot leave a stale promise here.
      */}
      <Panel className="mb-3" bodyClassName="p-0">
        <div className="border-b border-divider bg-brand-500/8 px-4 py-3.5 sm:px-5">
          {/*
            Everything the old callout, the example box and the folded note
            said, behind one (i) on the headline it is all about - the same
            treatment the credit history page had. Opens inline underneath, so
            it pushes the link down rather than covering it, and costs nothing
            above the fold while it is shut.
          */}
          <InfoTip
            label="how an invite is paid"
            info={
              <>
                <p>
                  A share of what they pay, never a fixed amount:{" "}
                  {pct(terms.planReferrerPercent)} of their first plan to you and{" "}
                  {pct(terms.planInviteePercent)} to them, then {pct(terms.topupReferrerPercent)} of
                  their first top-up to you and {pct(terms.topupInviteePercent)} to them.
                </p>
                <p>
                  A sign-up on its own earns nothing. Each of the two events pays once per person,
                  ever, on the rupees actually charged after any discount, rounded to the nearest
                  whole credit. A payment that buys a plan and credits together settles both at once
                  {settings.referralMinPayment > 0
                    ? `, and a payment under ${fmtRupees(settings.referralMinPayment)} settles neither — a later, larger one still can`
                    : ""}
                  .
                </p>
                <p>
                  {/* This used to claim the credits were good for "manual
                      searches" only. That stopped being true when a check went
                      back to costing a credit either way, so the cost model is
                      no longer restated here at all - it belongs on the credit
                      history page, which owns it and cannot drift from it. */}
                  Credits are added to balances and are not money: they cannot be withdrawn or
                  transferred. They spend exactly like bought ones and never expire. The
                  percentages can change, but a reward already earned is never taken back.
                </p>
                <p>
                  Your balance is on the{" "}
                  <Link href="/portal/plan" className="link">
                    plan and credits page
                  </Link>
                  .
                </p>
              </>
            }
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold text-brand-500">
              <Gift size={15} className="shrink-0" />
              {referralOfferHeadline(terms)}
            </span>
          </InfoTip>

          {/*
            The worked example, as a table rather than as two sentences.

            A percentage is a rule and nobody pictures a rule: "20% of their
            first plan" is a sum the reader has to do before they know whether
            the link is worth sending. The answer, in credits, is what goes on
            the marketing surface - and in three columns it is read at a glance
            instead of parsed, which two lines of prose never were.

            grid rather than <table>: it is four rows of figures inside a card,
            the column heads are a label each, and a real table would bring
            TableWrap's horizontal scroll to something that has to fit 326px.
          */}
          {paysPlan || paysTopup ? (
            <div
              className={cx(
                "mt-3 grid items-baseline gap-x-3 gap-y-1.5 text-xs tabular-nums",
                /* Capped, because the card is the full width of a desktop
                   column: without it "Their first plan" sits at one edge and
                   "+200" at the other, and a sum whose figures are a foot away
                   from what they are the sum of is not read as a sum. */
                "max-w-md",
                paysInvitee ? "grid-cols-[1fr_auto_auto]" : "grid-cols-[1fr_auto]",
              )}
            >
              <span />
              <ColHead>You get</ColHead>
              {paysInvitee ? <ColHead>They get</ColHead> : null}

              {paysPlan ? (
                <>
                  <span className="text-muted">Their first plan, {fmtRupees(example.planInr)}</span>
                  <Figure value={example.planReferrer} />
                  {paysInvitee ? <Figure value={example.planInvitee} muted /> : null}
                </>
              ) : null}

              {paysTopup ? (
                <>
                  <span className="text-muted">
                    Their first top-up, {fmtRupees(example.topupInr)}
                  </span>
                  <Figure value={example.topupReferrer} />
                  {paysInvitee ? <Figure value={example.topupInvitee} muted /> : null}
                </>
              ) : null}

              {/* The total only earns its rule when there are two rows to add
                  up. With one event switched off it would restate the row
                  directly above it. */}
              {paysPlan && paysTopup ? (
                <>
                  {/* The rule is its own full-width row rather than a border on
                      each of the three cells: a per-cell border breaks at every
                      column gap, which reads as three short underlines instead
                      of the line under a sum. */}
                  <span className="col-span-full border-t border-brand-500/20" />
                  <span className="font-medium text-ink">One invite is worth</span>
                  <Figure value={example.referrerTotal} total />
                  {paysInvitee ? <Figure value={example.inviteeTotal} total muted /> : null}
                </>
              ) : null}
            </div>
          ) : null}

          {/* The three things that must not be discovered later, at rest and in
              one line. Everything else about the terms is behind the (i). */}
          <p className="mt-2.5 text-[11px] leading-relaxed text-faint">
            Paid as credits, not cash, and once each per person
            {settings.referralMinPayment > 0
              ? ` — payments under ${fmtRupees(settings.referralMinPayment)} do not count`
              : ""}
            .
          </p>
        </div>

        {/* The thing the reader came to send, and the biggest control on the
            screen. Nothing is stacked above it but the offer it belongs to. */}
        <div className="p-4 sm:p-5">
          {code ? (
            <ShareLink
              link={referralLink(env.siteUrl, code)}
              code={code}
              brandName={settings.brandName}
            />
          ) : (
            /* The code comes from a trigger on the profile, so this is close to
               impossible - but a missing link is not something to render blank. */
            <p className="text-sm leading-relaxed text-muted">
              Your invite link is still being set up. Refresh this page in a moment, and get in
              touch with us if it is still not here.
            </p>
          )}
        </div>
      </Panel>

      {/* ------------------------------- the score ------------------------ */}
      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Invited"
          value={fmtNumber(counts.invited)}
          sub="signed up with your link"
          icon={<Users size={14} />}
        />
        <StatCard
          label="Waiting"
          value={fmtNumber(counts.waiting)}
          sub="not paid yet, so nothing earned"
          tone={counts.waiting > 0 ? "warn" : "neutral"}
          icon={<Clock size={14} />}
        />
        <StatCard
          label="Paid"
          value={fmtNumber(counts.paid)}
          sub="made their first payment"
          tone={counts.paid > 0 ? "good" : "neutral"}
          icon={<CheckCircle2 size={14} />}
        />
        <StatCard
          label="Credits earned"
          value={formatCredits(totalEarned)}
          sub={
            milestoneCredits > 0
              ? `includes a ${formatCredits(milestoneCredits)} credit bonus`
              : "already on your balance"
          }
          tone={totalEarned > 0 ? "brand" : "neutral"}
          icon={<Coins size={14} />}
        />
      </div>

      {/* Nothing to track when the admin has not set a milestone, and an empty
          tracker reads as a reward that was taken away. */}
      {hasMilestone ? (
        <Milestone
          paid={counts.paid}
          need={settings.referralMilestoneCount}
          bonus={settings.referralMilestoneBonus}
          alreadyPaid={milestoneCredits > 0}
        />
      ) : null}

      {/* ------------------------------- the people ----------------------- */}
      {/* The list is well down the page, so turning a page lands back on it
          rather than at the top of the screen. */}
      <div id="people">
        {/* No description. It either counted the people who have not paid -
            which is the Waiting tile two inches above, in a sentence - or said
            "what each person has earned you", which is the title in longer
            words. Every row states its own status three ways over. */}
        <Panel title="Everyone you invited" bodyClassName="p-0">
          {ordered.length === 0 ? (
            <EmptyState
              title="Nobody has used your link yet"
              description="Everyone who signs up through it shows up here."
            />
          ) : (
            <>
              <Legend />
              <ul className="divide-y divide-divider">
                {visible.map((referral) => (
                  <InviteRow key={referral.id} referral={referral} />
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

      {/* The closing paragraph is gone. It said credits earned here spend "on
          manual searches" - which stopped being true the day a check went back
          to costing a credit either way, so it was a stale promise sitting
          under a page whose whole point is not making stale promises. What it
          was for, that these credits are ordinary credits and where the balance
          lives, is in the (i) on the offer above. */}
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
 * What the badges mean - folded, because it is a key to a legend and not the
 * legend itself.
 *
 * Three badges and three explanations of them stood open above the list, which
 * put roughly sixty words between the reader and the first person they invited.
 * The badges are colour-coded and each row already says its own state in words
 * underneath the name, so somebody scrolling the list is not the person who
 * needs this - the person who does gets it one tap away, in the row it heads.
 */
function Legend() {
  return (
    <div className="border-b border-divider bg-raised/50 px-4 py-2">
      <HelpNote title="What the badges mean">
        <span className="flex flex-col gap-1.5">
          <span className="flex flex-wrap items-baseline gap-1.5">
            <Badge tone="warn">Waiting</Badge>
            <span>signed up, has not paid — earns you nothing yet.</span>
          </span>
          <span className="flex flex-wrap items-baseline gap-1.5">
            <Badge tone="brand">Part paid</Badge>
            <span>one of the two rewards has landed; the other is still to come.</span>
          </span>
          <span className="flex flex-wrap items-baseline gap-1.5">
            <Badge tone="good">Both paid</Badge>
            <span>plan and top-up — everything this invite is worth is yours.</span>
          </span>
        </span>
      </HelpNote>
    </div>
  );
}

/**
 * A column head on the worked example. Its own component only so the two or
 * three of them cannot drift apart, and so the grid reads as rows of content.
 */
function ColHead({ children }: { children: ReactNode }) {
  return (
    <span className="text-right text-[10px] font-semibold tracking-wider text-faint uppercase">
      {children}
    </span>
  );
}

/**
 * One credit figure in the worked example.
 *
 * A dash rather than "+0" when a percentage is switched off: a plus sign in
 * front of nothing reads as a sum that went wrong, and this is a page whose
 * only job is being believed about money.
 *
 * `muted` is the invitee's column - the reader's own figure is the one in brand
 * colour, because it is the one the decision to share turns on. `total` is the
 * bottom row, which is the biggest number on the page and drops the plus sign:
 * the rows above are amounts landing, the total is what the invite is worth,
 * and "worth +800" reads as an increase on something.
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

/**
 * The badge and the one line under the name, for each of the four states a
 * referral can be in.
 *
 * Kept as a table rather than nested ternaries because it is exactly what the
 * two-event scheme added: "paid" is no longer one thing, and a reader who has
 * been paid for the plan needs to know the top-up share is still coming rather
 * than that this invite is finished.
 */
const STAGE = {
  waiting: { tone: "warn", badge: "Waiting", next: "waiting for their first payment" },
  plan: { tone: "brand", badge: "Part paid", next: "bought a plan — more when they first top up" },
  topup: { tone: "brand", badge: "Part paid", next: "topped up — more when they buy a plan" },
  both: { tone: "good", badge: "Both paid", next: "plan and top-up, both rewarded" },
} as const;

/**
 * One person invited. The status has to survive being read at arm's length on
 * a phone, so it is said three ways at once: the colour of the edge, the badge,
 * and what the row is worth in credits.
 */
function InviteRow({ referral }: { referral: ReferralRow }) {
  const stage = referralStage(referral);
  const { tone, badge, next } = STAGE[stage];
  const paid = stage !== "waiting";
  const name = referral.referred?.full_name?.trim();
  const email = referral.referred?.email;

  return (
    <li
      className={cx(
        "flex items-start justify-between gap-3 border-l-2 px-4 py-3",
        stage === "both" ? "border-l-good-500" : paid ? "border-l-brand-500" : "border-l-warn-500",
      )}
    >
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">
          {name || email || "Someone you invited"}
        </p>
        {name && email ? <p className="truncate text-xs text-faint">{email}</p> : null}
        <p className={cx("mt-1 text-xs leading-relaxed", paid ? "text-muted" : "text-warn-500")}>
          {paid ? (
            <>
              {next}
              {referral.first_amount ? ` — first paid ${fmtRupees(referral.first_amount)}` : ""} on{" "}
              {fmtDate(referral.rewarded_at)}
            </>
          ) : (
            <>Signed up {fmtDate(referral.created_at)} — {next}</>
          )}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <Badge tone={tone}>{badge}</Badge>
        {paid ? (
          <>
            <p
              className={cx(
                "mt-1.5 text-sm font-semibold tabular-nums",
                stage === "both" ? "text-good-500" : "text-brand-500",
              )}
            >
              +{formatCredits(referral.reward_credits)}
            </p>
            <p className="text-[11px] text-faint">credits</p>
          </>
        ) : (
          <p className="mt-1.5 text-[11px] leading-tight text-faint">
            Nothing
            <br />
            earned yet
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * How close the bonus is. Stated as a sentence first and a bar second: the
 * sentence is the answer, the bar is only how far along it feels.
 */
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
    <Panel title="Bonus for bringing several people" className="mb-4">
      <p className={cx("text-sm leading-relaxed", reached ? "text-good-500" : "text-ink")}>
        {reached
          ? alreadyPaid
            ? `Done — ${fmtNumber(need)} of the people you invited have paid, and the ${formatCredits(bonus)} credit bonus is on your balance.`
            : `Done — ${fmtNumber(need)} of the people you invited have paid, so the ${formatCredits(bonus)} credit bonus is yours.`
          : `${fmtNumber(togo)} more ${togo === 1 ? "person has" : "people have"} to make a first payment, and ${formatCredits(bonus)} credits are added on top.`}
      </p>

      <div className="mt-3">
        <div className="mb-1.5 flex items-baseline justify-between gap-2 text-xs">
          <span className="text-muted">People who have paid</span>
          <span className="font-medium tabular-nums text-ink">
            {fmtNumber(Math.min(paid, need))}
            <span className="text-faint"> / {fmtNumber(need)}</span>
          </span>
        </div>
        {/* Not QuotaBar: that turns red at the top of its range, which is right
            for a limit being used up and wrong for a target being reached. */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-sunken">
          <div
            className={cx(
              "h-full rounded-full transition-all",
              reached ? "bg-good-500" : "bg-brand-500",
            )}
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
      <PageHeader title="Invite and earn credits" />
      <Panel>
        <p className="text-sm leading-relaxed text-muted">
          Inviting people is switched off at the moment, so there is nothing to show here yet. Your
          credits and everything else on your account are unaffected.
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
