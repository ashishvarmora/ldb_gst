import Link from "next/link";
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
import { fmtDate, fmtNumber, fmtRupees } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import {
  describeReferralReward,
  describeWelcomeBonus,
  loadReferrals,
  loadReferralSummary,
  loadReferralTerms,
  referralLink,
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

  /* Null when both welcome amounts are 0, and the line simply disappears. */
  const welcomeLine = describeWelcomeBonus(terms);

  return (
    <>
      <PageHeader
        title="Invite and earn credits"
        /* The when-you-earn rule is not repeated here. It is the one thing on
           this page somebody must not miss, so it is said once, in the
           highlighted line under the link - saying it twice made the top of the
           page a paragraph and still left the callout to read. */
        subtitle="Share your link with someone who runs trucks."
      />

      {/* What the INVITED person gets, said beside the link the reader is
          about to send - it is the half of the offer that makes the link worth
          tapping, and it was previously said nowhere at all. */}
      {/* ------------------------------- the link ------------------------- */}
      <Panel
        title="Your invite link"
        description={describeReferralReward(
          terms,
          settings.referralMilestoneCount,
          settings.referralMilestoneBonus,
        )}
        className="mb-4"
      >
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
            Your invite link is still being set up. Refresh this page in a moment, and get in touch
            with us if it is still not here.
          </p>
        )}

        <p className="mt-3 flex items-start gap-2 rounded-lg border border-brand-500/25 bg-brand-500/8 px-3 py-2.5 text-xs leading-relaxed text-ink">
          <Gift size={14} className="mt-0.5 shrink-0 text-brand-500" />
          <span>
            A sign-up on its own earns nothing. You are paid twice for each person you invite —
            when they buy their first plan, and again when they first top up — and the credits land
            straight on your balance.
            {welcomeLine ? <span className="mt-1 block text-muted">{welcomeLine}</span> : null}
          </span>
        </p>

        {/* The fine print, folded. The owner asked for the terms to be said
            here without the page becoming a contract - so the rule that
            matters is in the callout above, and everything an accountant would
            ask is behind one small disclosure. */}
        <HelpNote title="How the reward is worked out">
          Two rewards per person invited, each paid once: {formatCredits(terms.planReferrer)}{" "}
          credits to you and {formatCredits(terms.planInvitee)} to them when they buy their first
          plan, then {formatCredits(terms.topupReferrer)} to you and{" "}
          {formatCredits(terms.topupInvitee)} to them when they first top up. Fixed amounts, not a
          share of what they spend. A payment that buys a plan and credits together settles both at
          once
          {settings.referralMinPayment > 0
            ? `, and a payment under ${fmtRupees(settings.referralMinPayment)} settles neither — a later, larger one still can`
            : ""}
          . Credits are added to balances and are not money; they cannot be withdrawn or
          transferred. The amounts can change, but a reward already earned is never taken back.
        </HelpNote>
      </Panel>

      {/* ------------------------------- the score ------------------------ */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
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
        <Panel
          title="Everyone you invited"
          description={
            counts.waiting > 0
              ? `${fmtNumber(counts.waiting)} of them have not paid yet, so those have earned you nothing so far.`
              : "What each person has earned you, and whether they have paid yet."
          }
          bodyClassName="p-0"
        >
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

      <p className="mt-4 text-xs leading-relaxed text-muted">
        Credits earned here spend exactly like bought ones — on searches and automatic checks. Your
        balance is on the{" "}
        <Link href="/portal/plan" className="link">
          plan and credits page
        </Link>
        .
      </p>
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

/** What the badges under it mean, said once above the list. */
function Legend() {
  return (
    <div className="flex flex-col gap-1.5 border-b border-divider bg-raised/50 px-4 py-3 text-xs leading-relaxed text-muted">
      <p className="flex flex-wrap items-baseline gap-1.5">
        <Badge tone="warn">Waiting</Badge>
        <span>signed up, has not paid — earns you nothing yet.</span>
      </p>
      <p className="flex flex-wrap items-baseline gap-1.5">
        <Badge tone="brand">Part paid</Badge>
        <span>one of the two rewards has landed; the other is still to come.</span>
      </p>
      <p className="flex flex-wrap items-baseline gap-1.5">
        <Badge tone="good">Both paid</Badge>
        <span>plan and top-up — everything this invite is worth is yours.</span>
      </p>
    </div>
  );
}

/**
 * The badge and the one line under the name, for each of the four states a
 * referral can be in.
 *
 * Kept as a table rather than nested ternaries because it is exactly what the
 * two-event scheme added: "paid" is no longer one thing, and a reader who has
 * had 50 credits needs to know the other 100 is still coming rather than that
 * they have been paid.
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
