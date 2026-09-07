import Link from "next/link";
import { Clock, Download, Gift, UserCheck } from "lucide-react";

import { REWARDS_PATH, rewardCarry, type RewardParams } from "./params";
import { DataTable, MetricCard, sortRows, type Column } from "@/components/charts";
import { Select } from "@/components/form";
import { FilterSubmitButton } from "@/components/NavPending";
import { parseSort, queryString, sortHrefFor, sortParams } from "@/components/report";
import { Badge, EmptyState, Panel, buttonClass } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtNumber, fmtRelative, fmtRupees } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Every invite, both sides named, and whether it ever turned into money.
 *
 * The referral terms screen could say how many invites were waiting and how
 * many had paid out, as four totals. It could not say WHO - which is the only
 * form in which the numbers are actionable, because a referrer with six
 * pending invites and no rewards is either doing very well at signing people
 * up or gaming the invite link, and the totals cannot tell those apart.
 *
 * Grouped by referrer is the view to open on: one row per person who has
 * invited anybody, with how many of their invites actually paid. A conversion
 * rate per referrer is the number that answers both questions above.
 */

const GROUPINGS = [
  { key: "referrer", label: "By referrer" },
  { key: "none", label: "Every invite" },
] as const;

type Grouping = (typeof GROUPINGS)[number]["key"];

const STATUS_LABEL: Record<string, string> = {
  pending: "Waiting on a payment",
  rewarded: "Paid out",
  disqualified: "Did not qualify",
};

const STATUS_TONE = { pending: "warn", rewarded: "good", disqualified: "neutral" } as const;

/*
 * Which of the two events a referral has been paid for. Its own column rather
 * than folded into the status badge: status answers "has this earned anything
 * at all", and after the scheme became two events that is no longer the same
 * question as "is this referral finished". A referrer looking at a wall of
 * "Paid out" needs to see which of them still owe a top-up reward.
 */
const EVENT_LABEL = {
  none: "—",
  plan: "Plan",
  topup: "Top-up",
  both: "Both",
} as const;

const EVENT_TONE = { none: "neutral", plan: "brand", topup: "brand", both: "good" } as const;

const CAP = 5000;

type ReferralRow = {
  id: string;
  referrer_id: string;
  referrer: string | null;
  referrer_email: string | null;
  referred_id: string;
  invitee: string | null;
  invitee_email: string | null;
  status: string;
  reward_credits: number;
  welcome_credits: number | null;
  /* The two-event columns. The timestamps are the authority on whether an
     event has paid; a null amount beside a set timestamp means the referral
     settled before 0040, where the split between the two events is not
     knowable, and a ZERO beside one means a combined payment closed both
     events at once and was charged once - the whole payout sits on the plan
     event. Three states, three meanings, none of them interchangeable. */
  plan_rewarded_at: string | null;
  topup_rewarded_at: string | null;
  plan_referrer_credits: number | null;
  plan_invitee_credits: number | null;
  topup_referrer_credits: number | null;
  topup_invitee_credits: number | null;
  events_paid: "none" | "plan" | "topup" | "both";
  first_amount: number;
  days_to_reward: number | null;
  created_at: string;
  rewarded_at: string | null;
};

type FoldRow = {
  key: string;
  label: string;
  referrerId: string;
  invites: number;
  rewarded: number;
  pending: number;
  credits: number;
  revenue: number;
  lastAt: string;
};

export async function ReferralClaimsSection({ params }: { params: RewardParams }) {
  const admin = getSupabaseAdmin();

  const grouping: Grouping =
    GROUPINGS.find((option) => option.key === params.group)?.key ?? "referrer";
  const status = ["pending", "rewarded", "disqualified"].includes(params.status ?? "")
    ? params.status
    : undefined;

  let query = admin
    .from("referral_claim_detail")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(CAP);

  if (status) query = query.eq("status", status);
  if (params.account) query = query.eq("referrer_id", params.account);

  const { data, error } = await query;

  /* Kept, not swallowed: an empty report and a failing view read identically
     on screen and mean opposite things. */
  if (error) {
    return (
      <Panel title="Referral claims">
        <EmptyState
          title="Could not read the referrals"
          description={`That is referral_claim_detail failing to answer, not an empty list: ${error.message}`}
        />
      </Panel>
    );
  }

  const rows = (data ?? []) as ReferralRow[];

  const rewarded = rows.filter((row) => row.status === "rewarded");
  const totals = {
    invites: rows.length,
    rewarded: rewarded.length,
    pending: rows.filter((row) => row.status === "pending").length,
    credits: rows.reduce((sum, row) => sum + (Number(row.reward_credits) || 0), 0),
    /* The other half of what the scheme pays out. Null on referrals rewarded
       before the welcome bonus existed, which Number() must not read as NaN. */
    welcome: rows.reduce((sum, row) => sum + (Number(row.welcome_credits ?? 0) || 0), 0),
    revenue: rows.reduce((sum, row) => sum + (Number(row.first_amount) || 0), 0),
    referrers: new Set(rows.map((row) => row.referrer_id)).size,
    /* How many invites have run all the way through the scheme. The gap
       between this and "paid out" is the money still on the table. */
    both: rows.filter((row) => row.events_paid === "both").length,
  };

  /* Averaged over the invites that actually paid out - including the pending
     ones would drag it toward zero and read as "invites take no time". */
  const avgDays =
    rewarded.length > 0
      ? rewarded.reduce((sum, row) => sum + (Number(row.days_to_reward) || 0), 0) / rewarded.length
      : null;

  const carried = rewardCarry(params, "referral-claims", ["page"]);
  const href = (extra: Record<string, string | undefined>) =>
    `${REWARDS_PATH}?${queryString({ ...carried, ...extra })}`;

  const sort = parseSort(params, {
    key: grouping === "none" ? "when" : "invites",
    desc: true,
  });

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Invites"
          value={fmtNumber(totals.invites)}
          hint={`from ${fmtNumber(totals.referrers)} referrer${totals.referrers === 1 ? "" : "s"}`}
          icon={<Gift size={15} />}
        />
        <MetricCard
          label="Paid out"
          value={fmtNumber(totals.rewarded)}
          hint={
            totals.rewarded > 0
              ? `${fmtNumber(totals.both)} of them on both events`
              : "nothing yet"
          }
          icon={<UserCheck size={15} />}
        />
        <MetricCard
          label="Rewards given"
          value={formatCredits(totals.credits + totals.welcome)}
          hint={
            totals.welcome > 0
              ? `${formatCredits(totals.credits)} to inviters, ${formatCredits(totals.welcome)} in welcomes`
              : `${fmtNumber(totals.pending)} still waiting`
          }
          icon={<Gift size={15} />}
        />
        <MetricCard
          /* The number that says whether referrals bring buyers or browsers. */
          label="Days to pay"
          value={avgDays === null ? "—" : avgDays.toFixed(1)}
          hint={
            avgDays === null
              ? "no invite has paid out yet"
              : `average, over ${fmtNumber(rewarded.length)} paid out`
          }
          icon={<Clock size={15} />}
        />
      </div>

      <Panel
        title="Referral claims"
        description={
          grouping === "referrer"
            ? "One row per referrer. Tap a name for the invites behind it."
            : "Every invite, newest first."
        }
        bodyClassName="p-0"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            <form
              method="get"
              action={REWARDS_PATH}
              className="flex flex-wrap items-center gap-1.5"
            >
              {Object.entries({ ...carried, group: undefined, status: undefined }).map(
                ([key, value]) =>
                  value === undefined ? null : (
                    <input key={key} type="hidden" name={key} value={value} />
                  ),
              )}
              <Select name="group" defaultValue={grouping} className="h-9 py-0 text-xs">
                {GROUPINGS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </Select>
              <Select name="status" defaultValue={status ?? ""} className="h-9 py-0 text-xs">
                <option value="">Any status</option>
                <option value="pending">Waiting</option>
                <option value="rewarded">Paid out</option>
                <option value="disqualified">Did not qualify</option>
              </Select>
              <FilterSubmitButton>Apply</FilterSubmitButton>
            </form>
            <a
              href={`/admin/rewards/export?${queryString({ ...carried, ...sortParams(sort) })}`}
              className={buttonClass("secondary", "sm", "shrink-0")}
              download
            >
              <Download size={13} />
              CSV
            </a>
          </div>
        }
      >
        {rows.length === 0 ? (
          <EmptyState
            title={status || params.account ? "No invites match" : "Nobody has been invited yet"}
            description={
              status || params.account
                ? "Clear a filter, or widen the status."
                : "A row appears here when somebody signs up through a referral link, and turns into a reward once they pay."
            }
            action={
              status || params.account ? (
                <Link href={href({ status: undefined, account: undefined })}>Clear filters</Link>
              ) : undefined
            }
          />
        ) : grouping === "none" ? (
          <InviteTable rows={rows} sort={sort} carried={carried} />
        ) : (
          <FoldedTable rows={fold(rows)} sort={sort} carried={carried} href={href} />
        )}
      </Panel>

      {rows.length >= CAP ? (
        <p className="mt-3 text-xs text-faint">
          Showing the {fmtNumber(CAP)} most recent invites; the totals above are of those, not of
          every invite ever sent.
        </p>
      ) : null}
    </>
  );
}

function fold(rows: ReferralRow[]): FoldRow[] {
  const acc = new Map<string, FoldRow>();

  for (const row of rows) {
    const bucket =
      acc.get(row.referrer_id) ??
      {
        key: row.referrer_id,
        label: row.referrer ?? row.referrer_email ?? "Account since removed",
        referrerId: row.referrer_id,
        invites: 0,
        rewarded: 0,
        pending: 0,
        credits: 0,
        revenue: 0,
        lastAt: row.created_at,
      };

    bucket.invites += 1;
    if (row.status === "rewarded") bucket.rewarded += 1;
    if (row.status === "pending") bucket.pending += 1;
    bucket.credits += Number(row.reward_credits) || 0;
    bucket.revenue += Number(row.first_amount) || 0;
    if (row.created_at > bucket.lastAt) bucket.lastAt = row.created_at;

    acc.set(row.referrer_id, bucket);
  }

  return [...acc.values()];
}

function FoldedTable({
  rows,
  sort,
  carried,
  href,
}: {
  rows: FoldRow[];
  sort: { key: string; desc: boolean };
  carried: Record<string, string | undefined>;
  href: (extra: Record<string, string | undefined>) => string;
}) {
  const columns: Column<FoldRow>[] = [
    {
      key: "label",
      label: "Referrer",
      cell: (row) => row.label,
      sortBy: (row) => row.label.toLowerCase(),
      href: (row) => href({ account: row.referrerId, group: "none" }),
      total: (all) => `${fmtNumber(all.length)} referrers`,
    },
    {
      key: "invites",
      label: "Invites",
      align: "right",
      cell: (row) => fmtNumber(row.invites),
      sortBy: (row) => row.invites,
      total: (all) => fmtNumber(all.reduce((sum, row) => sum + row.invites, 0)),
    },
    {
      key: "rewarded",
      label: "Paid out",
      align: "right",
      cell: (row) => fmtNumber(row.rewarded),
      sortBy: (row) => row.rewarded,
      total: (all) => fmtNumber(all.reduce((sum, row) => sum + row.rewarded, 0)),
    },
    {
      key: "pending",
      label: "Waiting",
      align: "right",
      cell: (row) => (row.pending > 0 ? fmtNumber(row.pending) : "—"),
      sortBy: (row) => row.pending,
      total: (all) => fmtNumber(all.reduce((sum, row) => sum + row.pending, 0)),
    },
    {
      /*
       * Sorted on the ratio, not the string, and a referrer with no invites
       * sorts below one with a genuine zero rather than above everybody.
       */
      key: "rate",
      label: "Converted",
      align: "right",
      cell: (row) =>
        row.invites > 0 ? `${Math.round((row.rewarded / row.invites) * 100)}%` : "—",
      sortBy: (row) => (row.invites > 0 ? row.rewarded / row.invites : -1),
      total: (all) => {
        const invites = all.reduce((sum, row) => sum + row.invites, 0);
        return invites > 0
          ? `${Math.round((all.reduce((sum, row) => sum + row.rewarded, 0) / invites) * 100)}%`
          : "—";
      },
    },
    {
      key: "credits",
      label: "Rewards",
      align: "right",
      cell: (row) => (row.credits > 0 ? formatCredits(row.credits) : "—"),
      sortBy: (row) => row.credits,
      total: (all) => formatCredits(all.reduce((sum, row) => sum + row.credits, 0)),
    },
    {
      /* First payments only - see the invite table's note on the same figure.
         Not the whole of what these accounts have spent, and not the base the
         rewards beside it were a percentage of. */
      key: "revenue",
      label: "First payments",
      align: "right",
      cell: (row) => (row.revenue > 0 ? fmtRupees(Math.round(row.revenue)) : "—"),
      sortBy: (row) => row.revenue,
      total: (all) => fmtRupees(Math.round(all.reduce((sum, row) => sum + row.revenue, 0))),
    },
    {
      key: "last",
      label: "Last invite",
      cell: (row) => fmtRelative(row.lastAt),
      sortBy: (row) => row.lastAt,
      className: "whitespace-nowrap",
    },
  ];

  return (
    <DataTable
      rows={sortRows(rows, columns, sort)}
      columns={columns}
      sort={sort}
      sortHref={sortHrefFor(REWARDS_PATH, carried, sort)}
      rowKey={(row) => row.key}
      totalsOver={rows}
      totalsLabel="All"
    />
  );
}

function InviteTable({
  rows,
  sort,
  carried,
}: {
  rows: ReferralRow[];
  sort: { key: string; desc: boolean };
  carried: Record<string, string | undefined>;
}) {
  const columns: Column<ReferralRow>[] = [
    {
      key: "when",
      label: "Invited",
      cell: (row) => (
        <>
          <span className="block text-sm text-ink">{fmtRelative(row.created_at)}</span>
          <span className="block text-xs text-faint">{fmtDateTime(row.created_at)}</span>
        </>
      ),
      sortBy: (row) => row.created_at,
      className: "whitespace-nowrap",
      total: (all) => `${fmtNumber(all.length)} invites`,
    },
    {
      key: "referrer",
      label: "Referrer",
      cell: (row) => row.referrer ?? row.referrer_email ?? <span className="text-faint">removed</span>,
      sortBy: (row) => (row.referrer ?? "").toLowerCase(),
      href: (row) => `/admin/officers/${row.referrer_id}`,
    },
    {
      key: "invitee",
      label: "They invited",
      cell: (row) => row.invitee ?? row.invitee_email ?? <span className="text-faint">removed</span>,
      sortBy: (row) => (row.invitee ?? "").toLowerCase(),
      href: (row) => `/admin/officers/${row.referred_id}`,
    },
    {
      /*
       * The FIRST payment, and named so since 0043. It was "They paid", which
       * under fixed rewards was a harmless shorthand and under percentages is
       * a trap: the reward beside it is a share of up to two payments, and
       * only the first of them is on the row, so "They paid 999, reward 800"
       * would read as an 80% giveaway rather than 20% of two purchases.
       */
      key: "first_amount",
      label: "First payment",
      align: "right",
      cell: (row) => (Number(row.first_amount) > 0 ? fmtRupees(Number(row.first_amount)) : "—"),
      sortBy: (row) => Number(row.first_amount) || 0,
      total: (all) => fmtRupees(Math.round(all.reduce((s, r) => s + (Number(r.first_amount) || 0), 0))),
    },
    {
      key: "reward_credits",
      label: "Reward",
      align: "right",
      cell: (row) =>
        Number(row.reward_credits) > 0 ? (
          <span className="text-brand-500">+{formatCredits(Number(row.reward_credits))}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
      sortBy: (row) => Number(row.reward_credits) || 0,
      total: (all) => formatCredits(all.reduce((s, r) => s + (Number(r.reward_credits) || 0), 0)),
    },
    {
      /*
       * Which of the inviter's two events paid what. On screen since 0043 -
       * it was CSV-only, and a percentage scheme is the one where it earns its
       * column: 200 on the plan against 600 on the top-up is the whole answer
       * to "do invited accounts actually spend", and that shape is invisible
       * in the single total beside it.
       *
       * A dash for a null, which is a referral settled before the events
       * existed; a 0 is shown as 0, because a combined payment really did add
       * nothing on its top-up event.
       */
      key: "event_split",
      label: "Plan / top-up",
      align: "right",
      cell: (row) => {
        const each = (value: number | null) =>
          value === null ? "—" : formatCredits(Number(value) || 0);
        if (row.plan_referrer_credits === null && row.topup_referrer_credits === null) {
          return <span className="text-faint">—</span>;
        }
        return (
          <span className="tabular-nums text-muted">
            {each(row.plan_referrer_credits)} / {each(row.topup_referrer_credits)}
          </span>
        );
      },
      sortBy: (row) => Number(row.plan_referrer_credits ?? 0) || 0,
      className: "whitespace-nowrap",
    },
    {
      /*
       * What the INVITED person got off the same payment - the half the owner
       * asked for and the half that was invisible. Shown as its own column
       * rather than folded into one figure, because the two payouts answer
       * different questions: the referrer column prices the sharing, this one
       * prices the joining.
       */
      key: "welcome_credits",
      label: "They got",
      align: "right",
      cell: (row) =>
        row.welcome_credits === null ? (
          <span className="text-faint" title="Rewarded before the welcome bonus existed.">
            —
          </span>
        ) : Number(row.welcome_credits) > 0 ? (
          <span className="text-brand-500">+{formatCredits(Number(row.welcome_credits))}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
      sortBy: (row) => Number(row.welcome_credits ?? 0) || 0,
      total: (all) => formatCredits(all.reduce((s, r) => s + (Number(r.welcome_credits ?? 0) || 0), 0)),
    },
    {
      key: "events_paid",
      label: "Rewarded for",
      cell: (row) =>
        row.events_paid === "none" ? (
          <span className="text-faint">—</span>
        ) : (
          <Badge tone={EVENT_TONE[row.events_paid]}>{EVENT_LABEL[row.events_paid]}</Badge>
        ),
      sortBy: (row) => row.events_paid,
      total: (all) => `${fmtNumber(all.filter((r) => r.events_paid === "both").length)} both`,
    },
    {
      key: "days_to_reward",
      label: "Took",
      align: "right",
      cell: (row) =>
        row.days_to_reward === null ? (
          <span className="text-faint">—</span>
        ) : (
          `${Number(row.days_to_reward).toFixed(1)} d`
        ),
      /* Never-paid sorts last in both directions rather than counting as nought
         days, which would put every pending invite at the top of "fastest". */
      sortBy: (row) => (row.days_to_reward === null ? Number.MAX_SAFE_INTEGER : Number(row.days_to_reward)),
    },
    {
      key: "status",
      label: "Status",
      cell: (row) => (
        <Badge tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? "neutral"}>
          {STATUS_LABEL[row.status] ?? row.status}
        </Badge>
      ),
      sortBy: (row) => row.status,
    },
  ];

  return (
    <DataTable
      rows={sortRows(rows, columns, sort)}
      columns={columns}
      sort={sort}
      sortHref={sortHrefFor(REWARDS_PATH, carried, sort)}
      rowKey={(row) => row.id}
      totalsOver={rows}
      totalsLabel="All"
    />
  );
}
