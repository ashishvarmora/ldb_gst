import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Filter,
  MoonStar,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";

import { balanceTone } from "../tables";
import {
  ChartTable,
  MetricCard,
  ShareBreakdown,
  StackedBars,
  type Series,
  type Slice,
} from "@/components/charts";
import { DateRangeBar } from "@/components/DateRangeBar";
import { FilterSubmitButton } from "@/components/NavPending";
import { Input, Select } from "@/components/form";
import { Pager, pageFromParam, pageSlice } from "@/components/Pager";
import {
  Avatar,
  Badge,
  EmptyState,
  LinkCard,
  PageHeader,
  Panel,
  PanelAction,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  type BadgeTone,
} from "@/components/ui";
import {
  LIFECYCLE_STAGES,
  bucketLabel,
  fillBuckets,
  loadAccountActivity,
  loadFunnel,
  loadSignupSeries,
  percentChange,
  previousRange,
  rangeParams,
  resolveRange,
  stageOf,
  sumBy,
  type AccountActivity,
} from "@/lib/analytics";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtDate, fmtNumber, fmtRelative, fmtRupees, initials } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const metadata = { title: "Users — Admin" };

/**
 * Who the customers are, as a population rather than as a list.
 *
 * This is deliberately not the Customers page. That one is for doing something
 * to one account - create it, suspend it, change its plan, ring the person up -
 * and it is organised around finding a name. This one answers the questions
 * that have a number for an answer: how many signed up and never bought, whose
 * plan ran out last month, who has gone quiet, how much a cohort has ever paid.
 *
 * Every row still links straight through to the account, so noticing something
 * here and acting on it is one click, and nothing about editing an account is
 * duplicated on this side.
 */

const PER_PAGE = 25;

/**
 * How the table can be ordered, and the question each order really asks.
 * Nulls sink in every one of them: an account that has never been seen is not
 * the answer to "who was here most recently".
 */
const SORTS = {
  value: { label: "Highest lifetime value" },
  spent: { label: "Most credits used" },
  recent: { label: "Newest sign-up" },
  active: { label: "Last seen" },
  quiet: { label: "Quietest first" },
  balance: { label: "Lowest balance" },
  name: { label: "Name" },
} as const;

type SortKey = keyof typeof SORTS;

function isSort(value: string | undefined): value is SortKey {
  return value !== undefined && value in SORTS;
}

type UsersParams = {
  range?: string;
  from?: string;
  to?: string;
  bucket?: string;
  stage?: string;
  q?: string;
  sort?: string;
  page?: string;
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<UsersParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const range = resolveRange(params);
  const admin = getSupabaseAdmin();

  const sort: SortKey = isSort(params.sort) ? params.sort : "value";
  const page = pageFromParam(params.page);
  const stage = LIFECYCLE_STAGES.some((s) => s.key === params.stage) ? params.stage : undefined;
  const search = (params.q ?? "").trim().toLowerCase();

  const previous = previousRange(range);

  const [funnel, signups, signupsPrev, accounts] = await Promise.all([
    loadFunnel(admin),
    loadSignupSeries(admin, range),
    loadSignupSeries(admin, { ...previous, bucket: "month" }),
    loadAccountActivity(admin, range),
  ]);

  const newAccounts = sumBy(signups, (row) => row.signups);
  const newAccountsPrev = sumBy(signupsPrev, (row) => row.signups);
  const referred = sumBy(signups, (row) => row.referred);
  const converted = sumBy(signups, (row) => row.converted);

  /* Everyone active in the window, whichever way they were active: a search
     costs a credit, so a spender is by definition somebody who turned up. */
  const activeInRange = accounts.filter(
    (account) => account.credits_spent > 0 || account.payments > 0,
  ).length;

  const signupSeries: Series[] = [
    {
      key: "direct",
      label: "Found us directly",
      values: fillBuckets(signups, range, (row) => row.signups - row.referred).map((p) => p.value),
    },
    {
      key: "referred",
      label: "Invited by someone",
      values: fillBuckets(signups, range, (row) => row.referred).map((p) => p.value),
    },
  ];
  const signupBuckets = fillBuckets(signups, range, (row) => row.signups).map((p) =>
    bucketLabel(p.bucket, range.bucket),
  );

  const stageSlices: Slice[] = LIFECYCLE_STAGES.map((item) => ({
    key: item.key,
    label: item.label,
    value: funnel[item.key as keyof typeof funnel] as number,
    hint: item.hint,
  }));

  /* ----------------------------------------------------------------------- */
  /* The table                                                                */
  /* ----------------------------------------------------------------------- */

  const filtered = accounts.filter((account) => {
    if (stage && account.stage !== stage) return false;
    if (!search) return true;
    return (
      account.email.toLowerCase().includes(search) ||
      (account.full_name ?? "").toLowerCase().includes(search) ||
      (account.district ?? "").toLowerCase().includes(search)
    );
  });

  const sorted = [...filtered].sort((a, b) => compare(a, b, sort));
  const shown = pageSlice(sorted, page, PER_PAGE);

  const carried = { ...rangeParams(range), stage, q: params.q, sort };

  return (
    <>
      <PageHeader
        title="Users"
        subtitle="Who signed up, who paid, who is still here. Every row opens the account itself."
        actions={<PanelAction href="/admin/officers">Manage accounts</PanelAction>}
      />

      <DateRangeBar range={range} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <MetricCard
          label="All accounts"
          value={fmtNumber(funnel.total)}
          hint={`${fmtNumber(funnel.on_plan)} on a plan`}
          icon={<Users size={15} />}
        />
        <MetricCard
          label="New in range"
          value={fmtNumber(newAccounts)}
          change={percentChange(newAccounts, newAccountsPrev)}
          hint={`${fmtNumber(referred)} invited`}
          icon={<UserPlus size={15} />}
        />
        <MetricCard
          label="Ever paid"
          value={fmtNumber(funnel.paying)}
          hint={
            funnel.total > 0
              ? `${Math.round((funnel.paying / funnel.total) * 100)}% of all accounts`
              : "no accounts yet"
          }
          icon={<BadgeCheck size={15} />}
        />
        <MetricCard
          label="Never bought"
          value={fmtNumber(funnel.never_bought)}
          hint="signed up, nothing bought"
          goodWhen="down"
          icon={<UserX size={15} />}
          href={`/admin/users?stage=never_bought&${new URLSearchParams(rangeParams(range))}`}
        />
        <MetricCard
          label="Plan expired"
          value={fmtNumber(funnel.expired)}
          hint="the renewal list"
          goodWhen="down"
          icon={<CalendarClock size={15} />}
          href={`/admin/users?stage=expired&${new URLSearchParams(rangeParams(range))}`}
        />
        <MetricCard
          label="Dormant"
          value={fmtNumber(funnel.dormant)}
          hint="on a plan, unseen 30 days"
          goodWhen="down"
          icon={<MoonStar size={15} />}
          href={`/admin/users?stage=dormant&${new URLSearchParams(rangeParams(range))}`}
        />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <Panel
            title={`Sign-ups, by ${range.bucket}`}
            description="Split by whether somebody invited them. Hover a bar for the split."
          >
            <StackedBars
              buckets={signupBuckets}
              series={signupSeries}
              emptyLabel="Nobody registered in this range"
            />
            <ChartTable buckets={signupBuckets} series={signupSeries} />
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-divider pt-4 sm:grid-cols-4">
              <Figure label="Registered" value={fmtNumber(newAccounts)} />
              <Figure
                label="Have since paid"
                value={fmtNumber(converted)}
                sub={
                  newAccounts > 0
                    ? `${Math.round((converted / newAccounts) * 100)}% of this cohort`
                    : undefined
                }
              />
              <Figure
                label="Invited by someone"
                value={fmtNumber(referred)}
                sub={
                  newAccounts > 0
                    ? `${Math.round((referred / newAccounts) * 100)}% of sign-ups`
                    : undefined
                }
              />
              <Figure
                label="Active in range"
                value={fmtNumber(activeInRange)}
                sub="spent or paid something"
              />
            </div>
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel
            title="Where every account stands"
            description="One stage each, so the parts add up to the whole."
          >
            <ShareBreakdown slices={stageSlices} emptyLabel="No accounts yet" />
          </Panel>

          <LinkCard
            href="/admin/finance"
            icon={<ArrowRight size={16} />}
            title="Lifetime value, all accounts"
            description="What every customer has ever paid, and what the credits cost to give away."
            value={fmtRupees(funnel.lifetime_inr)}
          />
        </div>
      </div>

      <Panel
        title="Accounts"
        description={`${fmtNumber(sorted.length)} of ${fmtNumber(accounts.length)} accounts. Money and credits are for the selected range; the balance and stage are as of now.`}
        bodyClassName="p-0"
        actions={
          <form method="get" action="/admin/users" className="flex flex-wrap items-center gap-1.5">
            {Object.entries(rangeParams(range)).map(([key, value]) => (
              <input key={key} type="hidden" name={key} value={value} />
            ))}
            <Input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Name, email or district"
              className="h-9 w-44 py-0 text-xs"
            />
            <Select name="stage" defaultValue={stage ?? ""} className="h-9 py-0 text-xs">
              <option value="">Any stage</option>
              {LIFECYCLE_STAGES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </Select>
            <Select name="sort" defaultValue={sort} className="h-9 py-0 text-xs">
              {Object.entries(SORTS).map(([key, option]) => (
                <option key={key} value={key}>
                  {option.label}
                </option>
              ))}
            </Select>
            <FilterSubmitButton icon={<Filter size={13} />}>Apply</FilterSubmitButton>
          </form>
        }
      >
        {shown.length === 0 ? (
          <EmptyState
            title="No accounts match"
            description="Clear the search, or choose a different stage."
          />
        ) : (
          <>
            <TableWrap>
              <Thead>
                <th className="th">Account</th>
                <th className="th">Stage</th>
                <th className="th">Plan</th>
                <th className="th text-right">Paid in range</th>
                <th className="th text-right">Lifetime</th>
                <th className="th text-right">Credits used</th>
                <th className="th text-right">Free given</th>
                <th className="th text-right">Balance</th>
                <th className="th">Last seen</th>
              </Thead>
              <Tbody>
                {shown.map((account) => {
                  const stageInfo = stageOf(account.stage);
                  return (
                    <Tr key={account.id}>
                      <td className="td">
                        <Link
                          href={`/admin/officers/${account.id}`}
                          className="group flex items-center gap-2.5"
                        >
                          <Avatar size="sm" text={initials(account.full_name, account.email)} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm text-ink group-hover:text-brand-400">
                              {account.full_name ?? account.email}
                            </span>
                            <span className="block truncate text-xs text-faint">
                              joined {fmtDate(account.signed_up_on)}
                              {account.district ? ` · ${account.district}` : ""}
                            </span>
                          </span>
                        </Link>
                      </td>
                      <td className="td">
                        <Badge tone={(stageInfo?.tone ?? "neutral") as BadgeTone}>
                          {stageInfo?.label ?? account.stage}
                        </Badge>
                      </td>
                      <td className="td text-sm text-muted">{account.plan_name ?? "—"}</td>
                      <td className="td text-right text-sm tabular-nums text-ink">
                        {account.paid_inr > 0 ? fmtRupees(account.paid_inr) : "—"}
                      </td>
                      <td className="td text-right text-sm tabular-nums text-muted">
                        {fmtRupees(account.paid_inr)}
                      </td>
                      <td className="td text-right text-sm tabular-nums text-muted">
                        {formatCredits(account.credits_spent)}
                      </td>
                      <td className="td text-right text-sm tabular-nums text-muted">
                        {formatCredits(account.credits_free + account.credits_admin)}
                      </td>
                      <td className="td text-right">
                        <Badge tone={balanceTone(account.credits)}>
                          {formatCredits(account.credits)}
                        </Badge>
                      </td>
                      <td className="td text-xs whitespace-nowrap text-muted">
                        {fmtRelative(account.last_active_at)}
                      </td>
                    </Tr>
                  );
                })}
              </Tbody>
            </TableWrap>

            <div className="border-t border-divider px-4 py-3 sm:px-5">
              <Pager
                page={page}
                total={sorted.length}
                pageSize={PER_PAGE}
                noun="accounts"
                href={{ path: "/admin/users", params: carried }}
                className=""
              />
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

/** One number under the sign-up chart. */
function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <p className="text-[11px] tracking-wide text-muted uppercase">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-strong">{value}</p>
      {sub ? <p className="text-xs text-faint">{sub}</p> : null}
    </div>
  );
}

/**
 * The orders, in one place.
 *
 * "Lifetime" appears twice on the table on purpose: the range column answers
 * "did they pay me this month", the lifetime column answers "are they worth
 * chasing at all", and reading either one as the other is the mistake this
 * layout is trying to prevent.
 */
function compare(a: AccountActivity, b: AccountActivity, sort: SortKey): number {
  switch (sort) {
    case "spent":
      return b.credits_spent - a.credits_spent;
    case "recent":
      return b.signed_up_on.localeCompare(a.signed_up_on);
    case "active":
      return (b.last_active_at ?? "").localeCompare(a.last_active_at ?? "");
    case "quiet":
      // Never seen is the quietest of all, so an empty string sorts first here.
      return (a.last_active_at ?? "").localeCompare(b.last_active_at ?? "");
    case "balance":
      return Number(a.credits) - Number(b.credits);
    case "name":
      return (a.full_name ?? a.email).localeCompare(b.full_name ?? b.email);
    default:
      return b.paid_inr - a.paid_inr;
  }
}
