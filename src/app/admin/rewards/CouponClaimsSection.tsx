import Link from "next/link";
import { Download, Ticket, Users as UsersIcon, Wallet } from "lucide-react";

import { REWARDS_PATH, rewardCarry, type RewardParams } from "./params";
import { DataTable, MetricCard, sortRows, type Column } from "@/components/charts";
import { Select } from "@/components/form";
import { FilterSubmitButton } from "@/components/NavPending";
import { parseSort, queryString, sortHrefFor, sortParams } from "@/components/report";
import {
  Badge,
  EmptyState,
  Mono,
  Panel,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  buttonClass,
} from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtNumber, fmtRelative, fmtRupees } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Which code was used, by whom, how many times, and what it cost.
 *
 * The question the console could not answer. The coupons screen listed the
 * codes and counted the claims, and a panel underneath it listed one code's
 * claims in rupees - so a bonus-credit code, whose whole payout is credits,
 * showed a row of zeroes. TOPUP500 had granted 500 credits and read as if it
 * had done nothing.
 *
 * Two ways of looking at the same rows, because "how many times" and "who"
 * are different questions and a single table answers one of them badly:
 *
 *   By code     one row per code: claims, distinct accounts, rupees off,
 *               credits granted. This is the "which code is doing the work"
 *               view, and the one to open first.
 *   By account  one row per account: how many codes that person has claimed.
 *               This is the abuse view - the same account on four codes is
 *               worth a look.
 *   Every claim  the raw rows, newest first, for reading one story end to end.
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

const STATUS_LABEL: Record<string, string> = {
  applied: "Used",
  reserved: "Held",
  released: "Handed back",
};

const STATUS_TONE = { applied: "good", reserved: "warn", released: "neutral" } as const;

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
  amount_inr: number;
  discount_inr: number;
  bonus_credits: number;
  pays_in_credits: boolean;
  created_at: string;
  settled_at: string | null;
};

/** One folded row, whichever dimension it was folded on. */
type FoldRow = {
  key: string;
  label: string;
  /** Set when the fold key is a code or an account, for the drill-through. */
  code?: string;
  userId?: string;
  claims: number;
  used: number;
  held: number;
  released: number;
  accounts: number;
  codes: number;
  discount: number;
  credits: number;
  lastAt: string;
};

export async function CouponClaimsSection({ params }: { params: RewardParams }) {
  const admin = getSupabaseAdmin();

  const grouping: Grouping =
    GROUPINGS.find((option) => option.key === params.group)?.key ?? "code";
  const status = ["applied", "reserved", "released"].includes(params.status ?? "")
    ? params.status
    : undefined;

  let query = admin
    .from("coupon_claim_detail")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(CAP);

  if (status) query = query.eq("status", status);
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

  const totals = {
    claims: rows.length,
    used: rows.filter((row) => row.status === "applied").length,
    held: rows.filter((row) => row.status === "reserved").length,
    discount: rows.reduce((sum, row) => sum + (Number(row.discount_inr) || 0), 0),
    credits: rows.reduce((sum, row) => sum + (Number(row.bonus_credits) || 0), 0),
    accounts: new Set(rows.map((row) => row.user_id)).size,
    codes: new Set(rows.map((row) => row.code)).size,
  };

  const carried = rewardCarry(params, "coupon-claims", ["page"]);
  const href = (extra: Record<string, string | undefined>) =>
    `${REWARDS_PATH}?${queryString({ ...carried, ...extra })}`;

  const sort = parseSort(params, {
    key: grouping === "none" ? "when" : "claims",
    desc: true,
  });

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          label="Claims"
          value={fmtNumber(totals.claims)}
          hint={`${fmtNumber(totals.used)} settled, ${fmtNumber(totals.held)} still held`}
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
          hint="discount codes only"
          icon={<Wallet size={15} />}
        />
        <MetricCard
          /* The measure the old screen could not show at all. */
          label="Credits granted"
          value={formatCredits(totals.credits)}
          hint="bonus codes only"
          icon={<Ticket size={15} />}
        />
      </div>

      <Panel
        title="Coupon claims"
        description={
          grouping === "code"
            ? "One row per code. Tap a code to see the claims behind it."
            : grouping === "account"
              ? "One row per account. The same account on several codes is worth a look."
              : "Every claim, newest first."
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
                <option value="applied">Used</option>
                <option value="reserved">Held</option>
                <option value="released">Handed back</option>
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
            title={
              params.code || params.account || status
                ? "No claims match"
                : "No code has been claimed yet"
            }
            description={
              params.code || params.account || status
                ? "Clear a filter, or widen the status."
                : "A row appears here the moment a checkout opens with a code in it, before any money arrives."
            }
            action={
              params.code || params.account || status ? (
                <Link href={href({ code: undefined, account: undefined, status: undefined })}>
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
          not of every claim ever made — narrow the status or pick one code to be certain.
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
 */
function fold(rows: ClaimRow[], grouping: Exclude<Grouping, "none">): FoldRow[] {
  const acc = new Map<
    string,
    Omit<FoldRow, "accounts" | "codes"> & { accountSet: Set<string>; codeSet: Set<string> }
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
        used: 0,
        held: 0,
        released: 0,
        discount: 0,
        credits: 0,
        lastAt: row.created_at,
        accountSet: new Set<string>(),
        codeSet: new Set<string>(),
      };

    bucket.claims += 1;
    if (row.status === "applied") bucket.used += 1;
    if (row.status === "reserved") bucket.held += 1;
    if (row.status === "released") bucket.released += 1;
    bucket.discount += Number(row.discount_inr) || 0;
    bucket.credits += Number(row.bonus_credits) || 0;
    bucket.accountSet.add(row.user_id);
    bucket.codeSet.add(row.code);
    if (row.created_at > bucket.lastAt) bucket.lastAt = row.created_at;

    acc.set(key, bucket);
  }

  return [...acc.values()].map(({ accountSet, codeSet, ...rest }) => ({
    ...rest,
    accounts: accountSet.size,
    codes: codeSet.size,
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
        byCode ? <Mono className="font-semibold text-ink">{row.label}</Mono> : row.label,
      sortBy: (row) => row.label.toLowerCase(),
      /* Narrows this same report to the one code or account, which is how
         "how many times" becomes "which times". */
      href: (row) =>
        byCode ? href({ code: row.code, group: "none" }) : href({ account: row.userId, group: "none" }),
      total: (all) => `${fmtNumber(all.length)} ${byCode ? "codes" : "accounts"}`,
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
      key: "used",
      label: "Settled",
      align: "right",
      cell: (row) => fmtNumber(row.used),
      sortBy: (row) => row.used,
      total: (all) => fmtNumber(all.reduce((sum, row) => sum + row.used, 0)),
    },
    {
      key: "held",
      label: "Held",
      align: "right",
      cell: (row) => (row.held > 0 ? fmtNumber(row.held) : "—"),
      sortBy: (row) => row.held,
      total: (all) => fmtNumber(all.reduce((sum, row) => sum + row.held, 0)),
    },
    {
      /*
       * On the by-code view this is "how many different people", which is the
       * measure that separates a popular code from one account farming it. On
       * the by-account view the same slot answers the mirror question.
       */
      key: "reach",
      label: byCode ? "Accounts" : "Codes",
      align: "right",
      cell: (row) => fmtNumber(byCode ? row.accounts : row.codes),
      sortBy: (row) => (byCode ? row.accounts : row.codes),
      total: () => undefined,
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
      label: "Credits granted",
      align: "right",
      cell: (row) => (row.credits > 0 ? formatCredits(row.credits) : "—"),
      sortBy: (row) => row.credits,
      total: (all) => formatCredits(all.reduce((sum, row) => sum + row.credits, 0)),
    },
    {
      key: "last",
      label: "Last claim",
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
      cell: (row) => <Mono className="text-ink">{row.code}</Mono>,
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
      total: (all) => fmtRupees(Math.round(all.reduce((s, r) => s + (Number(r.amount_inr) || 0), 0))),
    },
    {
      /*
       * The reward, in whichever unit this code actually pays in. A single
       * column rather than two mostly-empty ones: every code pays one way or
       * the other, and two columns of dashes is how the old screen managed to
       * show a 500-credit grant as nothing at all.
       */
      key: "reward",
      label: "Reward",
      align: "right",
      cell: (row) =>
        row.pays_in_credits ? (
          Number(row.bonus_credits) > 0 ? (
            <span className="text-brand-500">
              +{formatCredits(Number(row.bonus_credits))} credits
            </span>
          ) : (
            <span className="text-faint">nothing yet</span>
          )
        ) : Number(row.discount_inr) > 0 ? (
          <span className="text-brand-500">−{fmtRupees(Number(row.discount_inr))}</span>
        ) : (
          <span className="text-faint">—</span>
        ),
      sortBy: (row) => Number(row.bonus_credits) || Number(row.discount_inr) || 0,
    },
    {
      key: "status",
      label: "Status",
      cell: (row) => (
        <>
          <Badge tone={STATUS_TONE[row.status as keyof typeof STATUS_TONE] ?? "neutral"}>
            {STATUS_LABEL[row.status] ?? row.status}
          </Badge>
          <span className="mt-0.5 block text-xs text-faint">
            {row.status === "reserved"
              ? "waiting on payment"
              : row.settled_at
                ? fmtRelative(row.settled_at)
                : ""}
          </span>
        </>
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
