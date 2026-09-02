import Link from "next/link";
import { Download, Filter, Ticket, Users as UsersIcon, Wallet } from "lucide-react";

import { REWARDS_PATH, rewardCarry, type RewardParams } from "./params";
import { DataTable, MetricCard, sortRows, type Column } from "@/components/charts";
import { DateRangeBar } from "@/components/DateRangeBar";
import { Select } from "@/components/form";
import { FilterSubmitButton } from "@/components/NavPending";
import { parseSort, queryString, sortHrefFor, sortParams } from "@/components/report";
import { Badge, EmptyState, Mono, Panel, buttonClass } from "@/components/ui";
import { rangeParams, resolveRange, shiftDate } from "@/lib/analytics";
import { COUPON_FAMILIES, couponFamilyLabel, parseCouponFamily } from "@/lib/coupons";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtNumber, fmtRelative, fmtRupees } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Which code was used, by whom, how many times, and what it actually cost.
 *
 * The question the console could not answer. The coupons screen listed the
 * codes and counted the claims, and a panel underneath it listed one code's
 * claims in rupees - so a bonus-credit code, whose whole payout is credits,
 * showed a row of zeroes. TOPUP500 had granted 500 credits and read as if it
 * had done nothing.
 *
 * THE FIGURE THAT WAS WRONG, and it was wrong in the expensive direction. This
 * report summed coupon_redemptions.discount_inr over every row it could see,
 * and a HELD row carries the discount the order was quoted at, not one that any
 * money has come off. Measured against the live database: one abandoned
 * checkout on a 50%-off code reported "Taken off prices: Rs 50" beside a
 * "Claims: 1" headline, while the codes list - which has always filtered that
 * sum to settled claims - said Rs 0 for the same code on the same day. Two
 * screens, two answers, and the one with the word "claims" on it was the wrong
 * one. That is what "the console still shows the code as used" means.
 *
 * 0033 now carries the reward twice: discount_given, which is only ever a
 * payment that settled, and discount_quoted, which is what a hold was opened
 * for. Totals may only be built from the first. A hold shows the second, in
 * the faint ink of a figure nobody has paid.
 *
 * THREE WAYS OF LOOKING AT THE SAME ROWS, because "how many times", "who" and
 * "what happened" are different questions and one table answers two of them
 * badly:
 *
 *   By code     one row per code: claims, distinct accounts, rupees off,
 *               credits granted. The "which code is doing the work" view, and
 *               the one to open first.
 *   By account  one row per account, ordered by how many DIFFERENT codes that
 *               person has claimed, with those codes named on the row. This is
 *               the abuse view: one account against four codes is the shape
 *               that is worth a look, and it is invisible in a claim count.
 *   Every claim the raw rows, newest first, for reading one story end to end.
 *
 * All three are the same query, folded differently in memory. Claims are the
 * rarest row in the schema - one per checkout that typed a code, ever - so
 * there is no case for three round trips or three database functions, and
 * folding here means "credits granted", which only the view knows how to
 * compute, is summable without a matching SQL aggregate.
 */

const GROUPINGS = [
  { key: "code", label: "By code" },
  { key: "account", label: "By account" },
  { key: "none", label: "Every claim" },
] as const;

type Grouping = (typeof GROUPINGS)[number]["key"];

/**
 * What happened to a claim, in four states rather than the table's three.
 *
 * 'reserved' covers two entirely different situations and telling them apart is
 * the point: a checkout that could still be paid is holding a claim, and a
 * checkout somebody walked away from is holding nothing - 0033 stops it
 * counting against the limit, and the next code anybody types hands it back.
 * Filtering on the view's hold_state rather than on status is what makes that
 * distinction reachable from the screen.
 */
const STATES = [
  { key: "settled", label: "Settled", tone: "good", note: "the reward was given" },
  { key: "holding", label: "At a checkout", tone: "warn", note: "waiting on payment" },
  { key: "abandoned", label: "Abandoned", tone: "neutral", note: "nobody came back to it" },
  { key: "released", label: "Handed back", tone: "neutral", note: "the claim was returned" },
] as const;

type State = (typeof STATES)[number]["key"];

/**
 * Links written before hold_state existed carry ?status=applied and friends.
 * Translated rather than ignored, because a stale link that silently matches
 * nothing looks like a code that was never claimed.
 */
const LEGACY_STATE: Record<string, State> = {
  applied: "settled",
  reserved: "holding",
  released: "released",
};

function parseState(raw: string | undefined): State | undefined {
  if (!raw) return undefined;
  if (STATES.some((state) => state.key === raw)) return raw as State;
  return LEGACY_STATE[raw];
}

/**
 * The width of a filter select, and the whole of the desktop fix.
 *
 * .field is w-full, so each select filled its own flex line and pushed the next
 * one underneath: at 1280 that was a 149px panel header carrying 111px of
 * stacked controls in a 290px gutter, beside a title block sitting on 544px it
 * was not using. w-auto from sm up lets each one be as wide as its own longest
 * option, and all three plus Apply share one 36px row.
 *
 * On a phone they fill their grid cell instead, two to a row - see the form's
 * own note. Content-width selects there would leave "Both sorts of code" alone
 * on a line and strand Apply on another.
 */
const FILTER_SELECT = "h-9 w-full min-w-0 py-0 text-xs sm:w-auto";

/**
 * A cap with a note attached, not a silent truncation.
 *
 * Generous on purpose: claims are rare, and a console that quietly stops
 * counting is the failure this whole section exists to undo.
 */
const CAP = 5000;

type ClaimRow = {
  id: string;
  coupon_id: string;
  code: string;
  kind: string;
  account: string | null;
  email: string | null;
  user_id: string;
  status: string;
  reward_kind: "discount" | "credit";
  hold_state: State;
  amount_inr: number;
  /** What came off a payment that settled. The only figure a total may use. */
  discount_given: number;
  /** What the order was opened for. Right to show on a hold, wrong to add up. */
  discount_quoted: number;
  bonus_credits: number;
  pays_in_credits: boolean;
  created_at: string;
  settled_at: string | null;
};

/** One folded row, whichever dimension it was folded on. */
type FoldRow = {
  key: string;
  label: string;
  /** The second line: an email on an account, the codes claimed on a code. */
  hint: string | null;
  /** Set when the fold key is a code or an account, for the drill-through. */
  code?: string;
  userId?: string;
  claims: number;
  settled: number;
  holding: number;
  abandoned: number;
  released: number;
  accounts: number;
  codes: number;
  discount: number;
  credits: number;
  firstAt: string;
  lastAt: string;
};

export async function CouponClaimsSection({ params }: { params: RewardParams }) {
  const admin = getSupabaseAdmin();

  const grouping: Grouping =
    GROUPINGS.find((option) => option.key === params.group)?.key ?? "code";
  const state = parseState(params.status);
  const family = parseCouponFamily(params.kind);

  /* The same range control every other report on this console uses, so a
     reader who has learned one has learned this. No bucket toggle: there is no
     series here, only claims. */
  const range = resolveRange(params);

  let query = admin
    .from("coupon_claim_detail")
    .select("*")
    /* IST day boundaries, half-open at the top, the same way the receipts
       report windows payments. A claim made at 11pm on the last day of the
       range belongs inside it. */
    .gte("created_at", `${range.from}T00:00:00+05:30`)
    .lt("created_at", `${shiftDate(range.to, 1)}T00:00:00+05:30`)
    .order("created_at", { ascending: false })
    .limit(CAP);

  if (state) query = query.eq("hold_state", state);
  if (family) query = query.eq("reward_kind", family);
  if (params.code) query = query.eq("code", params.code);
  if (params.account) query = query.eq("user_id", params.account);

  const { data, error } = await query;

  /*
   * The error kept rather than swallowed. A discarded error renders as an
   * empty report, and "no coupon has ever been claimed" is a very different
   * statement from "the claims view would not answer" - the first is a
   * business fact and the second is a broken console.
   */
  if (error) {
    return (
      <Panel title="Coupon claims">
        <EmptyState
          title="Could not read the claims"
          description={`That is coupon_claim_detail failing to answer, not an empty list: ${error.message}`}
        />
      </Panel>
    );
  }

  const rows = (data ?? []) as ClaimRow[];
  const settledRows = rows.filter((row) => row.hold_state === "settled");

  const totals = {
    claims: rows.length,
    settled: settledRows.length,
    holding: rows.filter((row) => row.hold_state === "holding").length,
    abandoned: rows.filter((row) => row.hold_state === "abandoned").length,
    released: rows.filter((row) => row.hold_state === "released").length,
    /* Settled only, and read from the column the database filters. This is the
       figure that used to include holds and overstate the giveaway. */
    discount: settledRows.reduce((sum, row) => sum + (Number(row.discount_given) || 0), 0),
    credits: settledRows.reduce((sum, row) => sum + (Number(row.bonus_credits) || 0), 0),
    accounts: new Set(rows.map((row) => row.user_id)).size,
    codes: new Set(rows.map((row) => row.code)).size,
  };

  const carried = rewardCarry(params, "coupon-claims", ["page"]);
  const href = (extra: Record<string, string | undefined>) =>
    `${REWARDS_PATH}?${queryString({ ...carried, ...extra })}`;

  const sort = parseSort(params, {
    /* The account view opens on how many DIFFERENT codes each person has
       claimed, because that is the only question it exists to answer. */
    key: grouping === "none" ? "when" : grouping === "account" ? "reach" : "claims",
    desc: true,
  });

  const filtered = Boolean(params.code || params.account || state || family);

  return (
    <>
      <DateRangeBar range={range} showBucket={false} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Claims"
          value={fmtNumber(totals.claims)}
          /* Every state named. "3 claims" used to be the whole story, so an
             abandoned checkout counted the same as a reward handed over. */
          hint={
            <>
              {fmtNumber(totals.settled)} settled
              {totals.holding > 0 ? ` · ${fmtNumber(totals.holding)} at a checkout` : ""}
              {totals.abandoned > 0 ? ` · ${fmtNumber(totals.abandoned)} abandoned` : ""}
              {totals.released > 0 ? ` · ${fmtNumber(totals.released)} handed back` : ""}
            </>
          }
          icon={<Ticket size={15} />}
        />
        <MetricCard
          label="Accounts"
          value={fmtNumber(totals.accounts)}
          hint={`across ${fmtNumber(totals.codes)} code${totals.codes === 1 ? "" : "s"}`}
          icon={<UsersIcon size={15} />}
        />
        <MetricCard
          label="Taken off prices"
          value={fmtRupees(Math.round(totals.discount))}
          hint="settled discount claims only"
          icon={<Wallet size={15} />}
        />
        <MetricCard
          /* The measure the old screen could not show at all. */
          label="Credits granted"
          value={formatCredits(totals.credits)}
          hint="settled credit claims only"
          icon={<Ticket size={15} />}
        />
      </div>

      <Panel
        title="Coupon claims"
        description={
          grouping === "code"
            ? "One row per code. Tap a code to see the claims behind it."
            : grouping === "account"
              ? "One row per account, most codes first. The same person against several codes is worth a look."
              : "Every claim, newest first."
        }
        bodyClassName="p-0"
        actions={
          /*
           * One row of controls at sm and up, and the reason it was three is
           * worth stating: .field is w-full, so each select filled the whole
           * flex line and pushed the next one under it. At 1280 that made a
           * 149px panel header with 111px of stacked controls in a 290px
           * gutter, beside a title block that had 544px it was not using -
           * which is the "unnecessary space" the owner photographed. w-auto
           * lets each select be as wide as its own longest option.
           */
          <div className="flex w-full flex-wrap items-center gap-1.5 sm:w-auto">
            <form
              method="get"
              action={REWARDS_PATH}
              /* Two tidy columns on a phone - each select paired with another
                 control rather than one per line - and one row from sm up.
                 Four controls in a 2-column grid is two rows either way; what
                 the grid buys is that Apply always sits beside a select instead
                 of being stranded on a line of its own. */
              className="grid w-full grid-cols-2 items-center gap-1.5 sm:flex sm:w-auto sm:flex-wrap"
            >
              {Object.entries({
                ...carried,
                group: undefined,
                status: undefined,
                kind: undefined,
              }).map(([key, value]) =>
                value === undefined ? null : (
                  <input key={key} type="hidden" name={key} value={value} />
                ),
              )}

              <Select
                name="kind"
                defaultValue={family ?? ""}
                aria-label="Which sort of code"
                className={FILTER_SELECT}
              >
                <option value="">Both sorts of code</option>
                {COUPON_FAMILIES.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </Select>

              <Select
                name="group"
                defaultValue={grouping}
                aria-label="Group by"
                className={FILTER_SELECT}
              >
                {GROUPINGS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </Select>

              <Select
                name="status"
                defaultValue={state ?? ""}
                aria-label="What happened to the claim"
                className={FILTER_SELECT}
              >
                <option value="">Any outcome</option>
                {STATES.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </Select>

              <FilterSubmitButton icon={<Filter size={13} />}>Apply</FilterSubmitButton>
            </form>

            <a
              href={`/admin/rewards/export?${queryString({ ...carried, ...rangeParams(range), ...sortParams(sort) })}`}
              className={buttonClass("secondary", "sm", "shrink-0")}
              download
            >
              <Download size={13} />
              CSV
            </a>
          </div>
        }
      >
        {/* What is narrowing the report, and one link out of all of it. A
            filter left on is how a report comes to look wrong when it is not,
            and three selects plus a code plus an account is more than anybody
            keeps in their head. */}
        {filtered ? (
          <div className="flex flex-wrap items-center gap-1.5 border-b border-divider px-4 py-2.5 sm:px-5">
            <span className="text-[11px] font-semibold tracking-wider text-faint uppercase">
              Showing
            </span>
            {family ? (
              <Badge tone="brand">
                {COUPON_FAMILIES.find((option) => option.key === family)?.label}
              </Badge>
            ) : null}
            {params.code ? <Badge tone="brand">{params.code}</Badge> : null}
            {params.account ? (
              <Badge tone="brand">
                {rows[0]?.account ?? rows[0]?.email ?? "one account"}
              </Badge>
            ) : null}
            {state ? (
              <Badge tone="brand">{STATES.find((option) => option.key === state)?.label}</Badge>
            ) : null}
            <Link
              href={href({
                code: undefined,
                account: undefined,
                status: undefined,
                kind: undefined,
              })}
              className="text-xs text-brand-500 hover:underline"
            >
              Clear
            </Link>
          </div>
        ) : null}

        {rows.length === 0 ? (
          <EmptyState
            title={filtered ? "No claims match" : "No code has been claimed in this range"}
            description={
              filtered
                ? "Clear a filter, widen the outcome, or stretch the date range."
                : "A row appears here the moment a checkout opens with a code in it, before any money arrives — and it says so, rather than counting as a claim."
            }
            action={
              filtered ? (
                <Link
                  href={href({
                    code: undefined,
                    account: undefined,
                    status: undefined,
                    kind: undefined,
                  })}
                >
                  Clear filters
                </Link>
              ) : undefined
            }
          />
        ) : grouping === "none" ? (
          <ClaimTable rows={rows} sort={sort} carried={carried} />
        ) : (
          <FoldedTable
            rows={fold(rows, grouping)}
            grouping={grouping}
            sort={sort}
            carried={carried}
            href={href}
          />
        )}
      </Panel>

      {rows.length >= CAP ? (
        <p className="mt-3 text-xs text-faint">
          Showing the {fmtNumber(CAP)} most recent claims. Everything above is a total of those,
          not of every claim in the range — narrow the outcome or pick one code to be certain.
        </p>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* folding                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The same claims, one row per code or per account.
 *
 * Distinct counts are kept as Sets while folding and collapsed to numbers at
 * the end: "3 claims from 1 account" and "3 claims from 3 accounts" are the
 * difference between a popular code and a code being farmed, and summing a
 * count would report both as 3.
 *
 * The account fold also keeps the code NAMES, not just how many. "4 codes" says
 * somebody is worth looking at; "ADD50, DIWALI, NEWYEAR, WELCOME" is the answer
 * to the question that follows, on the same row, without a drill-through.
 */
function fold(rows: ClaimRow[], grouping: Exclude<Grouping, "none">): FoldRow[] {
  const acc = new Map<
    string,
    Omit<FoldRow, "accounts" | "codes" | "hint"> & {
      accountSet: Set<string>;
      codeSet: Set<string>;
    }
  >();

  for (const row of rows) {
    const key = grouping === "code" ? row.code : row.user_id;
    const label =
      grouping === "code" ? row.code : (row.account ?? row.email ?? "Account since removed");

    const bucket =
      acc.get(key) ??
      {
        key,
        label,
        code: grouping === "code" ? row.code : undefined,
        userId: grouping === "account" ? row.user_id : undefined,
        claims: 0,
        settled: 0,
        holding: 0,
        abandoned: 0,
        released: 0,
        discount: 0,
        credits: 0,
        firstAt: row.created_at,
        lastAt: row.created_at,
        accountSet: new Set<string>(),
        codeSet: new Set<string>(),
      };

    bucket.claims += 1;
    if (row.hold_state === "settled") bucket.settled += 1;
    if (row.hold_state === "holding") bucket.holding += 1;
    if (row.hold_state === "abandoned") bucket.abandoned += 1;
    if (row.hold_state === "released") bucket.released += 1;
    /* Settled only. The whole bug this section had was adding up money that
       nobody had paid. */
    bucket.discount += Number(row.discount_given) || 0;
    bucket.credits += Number(row.bonus_credits) || 0;
    bucket.accountSet.add(row.user_id);
    bucket.codeSet.add(row.code);
    if (row.created_at > bucket.lastAt) bucket.lastAt = row.created_at;
    if (row.created_at < bucket.firstAt) bucket.firstAt = row.created_at;

    acc.set(key, bucket);
  }

  return [...acc.values()].map(({ accountSet, codeSet, ...rest }) => ({
    ...rest,
    accounts: accountSet.size,
    codes: codeSet.size,
    /*
     * The account row's second line: the codes that person claimed, named.
     * Four is enough to recognise a pattern and a fifth only wraps the row on a
     * phone. A code row needs no second line - it already is one.
     */
    hint:
      grouping === "account"
        ? [...codeSet].slice(0, 4).join(", ") + (codeSet.size > 4 ? `, +${codeSet.size - 4}` : "")
        : null,
  }));
}

function FoldedTable({
  rows,
  grouping,
  sort,
  carried,
  href,
}: {
  rows: FoldRow[];
  grouping: Exclude<Grouping, "none">;
  sort: { key: string; desc: boolean };
  carried: Record<string, string | undefined>;
  href: (extra: Record<string, string | undefined>) => string;
}) {
  const byCode = grouping === "code";

  const columns: Column<FoldRow>[] = [
    {
      key: "label",
      label: byCode ? "Code" : "Account",
      cell: (row) =>
        byCode ? (
          <Mono className="font-semibold text-ink">{row.label}</Mono>
        ) : (
          <>
            <span className="block text-sm text-ink">{row.label}</span>
            {/* The codes this person has claimed, named. This is the abuse
                view; "which ones" is the second half of every look at it. */}
            {/* Capped at 12rem, and the cap is load-bearing: this cell's width
                is whichever of the name and the code list is longer, and three
                codes uncapped took the nine-column account view to 1001px of a
                958px panel. The badge beside it carries the count, so a
                truncated fourth code loses nothing that is not still on the
                row. */}
            {row.hint ? (
              <span className="mt-0.5 block max-w-48 truncate font-mono text-xs text-faint">
                {row.hint}
              </span>
            ) : null}
          </>
        ),
      sortBy: (row) => row.label.toLowerCase(),
      /* Narrows this same report to the one code or account, which is how
         "how many times" becomes "which times". */
      href: (row) =>
        byCode ? href({ code: row.code, group: "none" }) : href({ account: row.userId, group: "none" }),
      total: (all) => `${fmtNumber(all.length)} ${byCode ? "codes" : "accounts"}`,
    },
    {
      /*
       * On the by-account view this is "how many different codes", and it is
       * the first measure rather than a trailing one because it is the reason
       * this grouping exists: one person on four codes is a pattern, and it is
       * invisible in a claim count.
       */
      key: "reach",
      label: byCode ? "Accounts" : "Codes",
      align: "right",
      cell: (row) =>
        byCode ? (
          fmtNumber(row.accounts)
        ) : row.codes > 1 ? (
          <Badge tone="warn">{fmtNumber(row.codes)}</Badge>
        ) : (
          fmtNumber(row.codes)
        ),
      sortBy: (row) => (byCode ? row.accounts : row.codes),
      total: () => undefined,
    },
    {
      key: "claims",
      label: "Claims",
      align: "right",
      cell: (row) => fmtNumber(row.claims),
      sortBy: (row) => row.claims,
      total: (all) => fmtNumber(all.reduce((sum, row) => sum + row.claims, 0)),
    },
    {
      key: "settled",
      label: "Settled",
      align: "right",
      cell: (row) => fmtNumber(row.settled),
      sortBy: (row) => row.settled,
      total: (all) => fmtNumber(all.reduce((sum, row) => sum + row.settled, 0)),
    },
    {
      key: "open",
      label: "Unpaid",
      align: "right",
      /* A live hold and an abandoned one, kept apart. The first is holding a
         claim; the second is holding nothing and is handed back on sight. */
      cell: (row) =>
        row.holding + row.abandoned === 0 ? (
          "—"
        ) : (
          <>
            {row.holding > 0 ? <span className="text-warn-500">{fmtNumber(row.holding)}</span> : null}
            {row.holding > 0 && row.abandoned > 0 ? <span className="text-faint"> / </span> : null}
            {row.abandoned > 0 ? <span className="text-faint">{fmtNumber(row.abandoned)}</span> : null}
          </>
        ),
      sortBy: (row) => row.holding * 1000 + row.abandoned,
      total: (all) => {
        const holding = all.reduce((sum, row) => sum + row.holding, 0);
        const abandoned = all.reduce((sum, row) => sum + row.abandoned, 0);
        return holding + abandoned === 0 ? "0" : `${fmtNumber(holding)} / ${fmtNumber(abandoned)}`;
      },
      className: "whitespace-nowrap",
    },
    {
      key: "discount",
      label: "Off prices",
      align: "right",
      cell: (row) => (row.discount > 0 ? fmtRupees(Math.round(row.discount)) : "—"),
      sortBy: (row) => row.discount,
      total: (all) => fmtRupees(Math.round(all.reduce((sum, row) => sum + row.discount, 0))),
    },
    {
      key: "credits",
      /* "Credits" rather than "Credits granted": paired with "Off prices" the
         short form is unambiguous, and the long one was the widest header in
         the table - 152px of a 958px panel, which is what pushed the
         nine-column account view into a horizontal scrollbar at 1280. */
      label: "Credits",
      align: "right",
      cell: (row) => (row.credits > 0 ? formatCredits(row.credits) : "—"),
      sortBy: (row) => row.credits,
      total: (all) => formatCredits(all.reduce((sum, row) => sum + row.credits, 0)),
    },
    /*
     * One date column, and which one depends on the grouping.
     *
     * A code wants its last claim - one date, and the question is whether the
     * code is still working. An account wants the SPAN: four codes inside an
     * hour is a different thing from four codes across four months, and that
     * is half of what makes a farming pattern legible.
     *
     * Two columns for the span would not fit. Nine columns needed 1001px of a
     * 958px panel at 1280, and the overflow was a horizontal scrollbar on the
     * one view whose whole job is to be scanned. Stacked in a single cell is
     * the pattern the claim table already uses for its own dates, and it costs
     * 130px instead of 233.
     */
    byCode
      ? {
          key: "last",
          label: "Last claim",
          cell: (row) => fmtRelative(row.lastAt),
          sortBy: (row) => row.lastAt,
          className: "whitespace-nowrap",
        }
      : {
          key: "last",
          label: "Claiming since",
          cell: (row) => (
            <>
              <span className="block text-sm text-ink">{fmtRelative(row.firstAt)}</span>
              <span className="block text-xs text-faint">
                {row.claims > 1 ? `last ${fmtRelative(row.lastAt)}` : "one claim"}
              </span>
            </>
          ),
          sortBy: (row) => row.firstAt,
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

/* -------------------------------------------------------------------------- */
/* the raw rows                                                               */
/* -------------------------------------------------------------------------- */

function ClaimTable({
  rows,
  sort,
  carried,
}: {
  rows: ClaimRow[];
  sort: { key: string; desc: boolean };
  carried: Record<string, string | undefined>;
}) {
  const columns: Column<ClaimRow>[] = [
    {
      key: "when",
      label: "When",
      cell: (row) => (
        <>
          <span className="block text-sm text-ink">{fmtRelative(row.created_at)}</span>
          <span className="block text-xs text-faint">{fmtDateTime(row.created_at)}</span>
        </>
      ),
      sortBy: (row) => row.created_at,
      className: "whitespace-nowrap",
      total: (all) => `${fmtNumber(all.length)} claims`,
    },
    {
      key: "code",
      label: "Code",
      /* The kind on the row, because the reward column below reads in a
         different unit depending on it and a reader should not have to
         remember which code was which. */
      cell: (row) => (
        <>
          <Mono className="text-ink">{row.code}</Mono>
          <span className="mt-0.5 block text-xs text-faint">{couponFamilyLabel(row.kind)}</span>
        </>
      ),
      sortBy: (row) => row.code,
    },
    {
      key: "account",
      label: "Account",
      /* The name is a link to the account, because "who used this" is nearly
         always followed by "and what else have they done". */
      cell: (row) => row.account ?? row.email ?? <span className="text-faint">removed</span>,
      sortBy: (row) => (row.account ?? row.email ?? "").toLowerCase(),
      href: (row) => `/admin/officers/${row.user_id}`,
    },
    {
      key: "amount",
      label: "Order value",
      align: "right",
      cell: (row) => (Number(row.amount_inr) > 0 ? fmtRupees(Number(row.amount_inr)) : "—"),
      sortBy: (row) => Number(row.amount_inr) || 0,
      /* Settled orders only. An abandoned checkout's "order value" is a price
         nobody paid, and totalling it would restate the same overstatement in
         a different column. */
      total: (all) =>
        fmtRupees(
          Math.round(
            all.reduce(
              (sum, row) => sum + (row.hold_state === "settled" ? Number(row.amount_inr) || 0 : 0),
              0,
            ),
          ),
        ),
    },
    {
      /*
       * The reward, in whichever unit this code actually pays in, and only
       * where it was actually paid. A single column rather than two
       * mostly-empty ones: every code pays one way or the other, and two
       * columns of dashes is how the old screen managed to show a 500-credit
       * grant as nothing at all.
       *
       * On an unsettled claim this prints what the order was QUOTED, in the
       * faint ink and with the word "quoted" on it. That figure used to be
       * printed in brand colour and added into the headline, which is how an
       * abandoned checkout came to report Rs 50 of discount given.
       */
      key: "reward",
      label: "Reward",
      align: "right",
      cell: (row) => {
        if (row.hold_state !== "settled") {
          return row.pays_in_credits ? (
            <span className="text-faint">nothing yet</span>
          ) : Number(row.discount_quoted) > 0 ? (
            <span className="text-faint">
              {fmtRupees(Number(row.discount_quoted))} quoted
            </span>
          ) : (
            <span className="text-faint">—</span>
          );
        }
        return row.pays_in_credits ? (
          <span className="text-brand-500">
            +{formatCredits(Number(row.bonus_credits))} credits
          </span>
        ) : (
          <span className="text-brand-500">−{fmtRupees(Number(row.discount_given))}</span>
        );
      },
      sortBy: (row) => Number(row.bonus_credits) || Number(row.discount_given) || 0,
      total: (all) => {
        const credits = all.reduce((sum, row) => sum + (Number(row.bonus_credits) || 0), 0);
        const off = all.reduce((sum, row) => sum + (Number(row.discount_given) || 0), 0);
        /* Both units, never added together. Whichever is nought is said to be
           nought rather than left out, so the footer never looks like only one
           sort of code exists. */
        return (
          <>
            <span className="block">{fmtRupees(Math.round(off))}</span>
            <span className="block text-xs font-normal text-muted">
              {formatCredits(credits)} credits
            </span>
          </>
        );
      },
    },
    {
      key: "status",
      label: "Outcome",
      cell: (row) => {
        const state = STATES.find((option) => option.key === row.hold_state);
        return (
          <>
            <Badge tone={state?.tone ?? "neutral"}>{state?.label ?? row.status}</Badge>
            <span className="mt-0.5 block text-xs text-faint">
              {row.hold_state === "settled" && row.settled_at
                ? fmtRelative(row.settled_at)
                : (state?.note ?? "")}
            </span>
          </>
        );
      },
      sortBy: (row) => row.hold_state,
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
