import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  Download,
  Filter,
  MoonStar,
  UserPlus,
  UserX,
  Users,
} from "lucide-react";

import { balanceTone } from "../tables";
import {
  SORT_PRESETS,
  filterAccounts,
  filtersSentence,
  parseAccountFilters,
  parseAccountSort,
  presetOf,
  sortAccounts,
  usedInRange,
} from "./accounts";
import {
  DataTable,
  MetricCard,
  ShareBreakdown,
  sortRows,
  type Column,
  type Slice,
} from "@/components/charts";
import { DateRangeBar } from "@/components/DateRangeBar";
import { FilterSubmitButton } from "@/components/NavPending";
import { bucketRange, parseSort, queryString, sortHrefFor } from "@/components/report";
import { Input, Select } from "@/components/form";
import { Pager, ShowMore, pageCount, pageFromParam, pageSlice } from "@/components/Pager";
import {
  Avatar,
  Badge,
  EmptyState,
  LinkCard,
  PageHeader,
  Panel,
  PanelAction,
  buttonClass,
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

/** Accounts per page, and the most a "Show more" can stretch one page to. */
const PER_PAGE = 25;
const PER_PAGE_MAX = 200;

/**
 * Sign-up periods shown before "Show more". A 90-day range by day is 90 rows,
 * and the question is nearly always about the latest few - the totals line
 * still covers the whole range.
 */
const PERIODS_SHOWN = 14;
const PERIODS_STEP = 30;

/** One period of the sign-up report. */
type SignupPeriod = {
  bucket: string;
  signups: number;
  referred: number;
  converted: number;
};

/** A ?per= value, as a multiple of 25 between 25 and the cap. */
function perPage(raw: string | undefined): number {
  const value = Math.round(Number(raw) / PER_PAGE) * PER_PAGE;
  return Number.isFinite(value) ? Math.min(Math.max(value, PER_PAGE), PER_PAGE_MAX) : PER_PAGE;
}

type UsersParams = {
  range?: string;
  from?: string;
  to?: string;
  bucket?: string;
  stage?: string;
  q?: string;
  joined?: string;
  paid?: string;
  activity?: string;
  minspent?: string;
  sort?: string;
  dir?: string;
  per?: string;
  /* The period table's own sort, kept apart from the accounts table's. */
  psort?: string;
  pdir?: string;
  /* "hide" drops sign-up periods where every figure is zero. */
  pempty?: string;
  /* How many sign-up periods to show; "Show more" raises it. */
  plimit?: string;
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

  const filters = parseAccountFilters(params);
  const sort = parseAccountSort(params);
  const per = perPage(params.per);

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

  /* Everyone who used the service in the window - the same test as the
     accounts table's "Used the service" filter, so the two agree. */
  const activeInRange = accounts.filter(usedInRange).length;

  /*
   * Sign-ups per period as ROWS, not as a picture.
   *
   * This was a stacked bar chart with the numbers folded away underneath it,
   * and at a one-day range it drew a single full-width bar that read as a flat
   * line - a chart that is at its least readable exactly when the range is at
   * its most specific. The questions actually being asked of this panel are
   * "which month did we grow", "how many of March's sign-ups ever paid" and
   * "who were they", and none of them is a question a bar answers: the first
   * needs an orderable column, the second needs a rate beside the count, the
   * third needs the row to be a link.
   *
   * fillBuckets rather than the raw rows, so a period with no sign-ups is a
   * zero row instead of a gap - a missing week reads as "we did not grow" only
   * if it is visibly there.
   */
  const signupPeriods: SignupPeriod[] = fillBuckets(signups, range, (row) => row.signups).map(
    (point) => {
      const row = signups.find((candidate) => candidate.bucket === point.bucket);
      return {
        bucket: point.bucket,
        signups: point.value,
        referred: Number(row?.referred ?? 0),
        converted: Number(row?.converted ?? 0),
      };
    },
  );

  /*
   * The period table's own sort, under psort/pdir.
   *
   * There are two sortable tables on this page and the accounts table below
   * already owns `sort` - with its own vocabulary of values ("value", "quiet")
   * that means nothing to a column called "Registered". Sharing one parameter
   * would make sorting either table scramble the other, so this one carries
   * its own pair and the shared helper is told to write them.
   */
  const periodSort = parseSort({ sort: params.psort, dir: params.pdir }, {
    key: "bucket",
    desc: true,
  });
  const PERIOD_SORT_KEYS = { sort: "psort", dir: "pdir" } as const;


  const signupColumns: Column<SignupPeriod>[] = [
    {
      key: "bucket",
      label: "Period",
      cell: (row) => bucketLabel(row.bucket, range.bucket),
      sortBy: (row) => row.bucket,
      className: "whitespace-nowrap",
      /*
       * The drill-through the chart could not have. A period cell narrows this
       * very page to the accounts that registered in it, which is the "who were
       * the eleven people who signed up in March" question.
       *
       * bucketRange is what makes a weekly or monthly row work: a bucket is
       * stored as the date it STARTS on, so passing it as both ends of a custom
       * range would answer for one day and look like the rest of the month had
       * vanished.
       */
      href: (row) => {
        const { from, to } = bucketRange(row.bucket, range.bucket);
        return `/admin/users?${queryString({ range: "custom", from, to, bucket: range.bucket, sort: "recent" })}`;
      },
      total: (rows) => `${fmtNumber(rows.length)} ${range.bucket}s`,
    },
    {
      key: "signups",
      label: "Registered",
      align: "right",
      cell: (row) => fmtNumber(row.signups),
      sortBy: (row) => row.signups,
      total: (rows) => fmtNumber(sumBy(rows, (row) => row.signups)),
    },
    {
      key: "referred",
      label: "Invited",
      align: "right",
      cell: (row) => (row.referred > 0 ? fmtNumber(row.referred) : "—"),
      sortBy: (row) => row.referred,
      total: (rows) => fmtNumber(sumBy(rows, (row) => row.referred)),
    },
    {
      key: "direct",
      label: "Found us",
      align: "right",
      cell: (row) => fmtNumber(row.signups - row.referred),
      sortBy: (row) => row.signups - row.referred,
      total: (rows) => fmtNumber(sumBy(rows, (row) => row.signups - row.referred)),
    },
    {
      key: "converted",
      label: "Have paid",
      align: "right",
      cell: (row) => (row.converted > 0 ? fmtNumber(row.converted) : "—"),
      sortBy: (row) => row.converted,
      total: (rows) => fmtNumber(sumBy(rows, (row) => row.converted)),
    },
    {
      /*
       * The measure worth sorting by, and the one a chart of counts hides
       * completely: a month with four sign-ups where three paid is a better
       * month than one with forty where two did. Sorted on the rate rather
       * than on the string, so "—" does not sort between 9% and 10%.
       */
      key: "rate",
      label: "Converted",
      align: "right",
      cell: (row) =>
        row.signups > 0 ? `${Math.round((row.converted / row.signups) * 100)}%` : "—",
      sortBy: (row) => (row.signups > 0 ? row.converted / row.signups : -1),
      total: (rows) => {
        const registered = sumBy(rows, (row) => row.signups);
        return registered > 0
          ? `${Math.round((sumBy(rows, (row) => row.converted) / registered) * 100)}%`
          : "—";
      },
    },
  ];

  /*
   * Hiding empty periods and capping how many show are view choices only: the
   * totals line still covers every period in the range, so "In range" never
   * changes because a row was folded away.
   */
  const hideEmpty = params.pempty === "hide";
  const periodRows = hideEmpty ? signupPeriods.filter((row) => row.signups > 0) : signupPeriods;
  const emptyPeriods = signupPeriods.filter((row) => row.signups === 0).length;
  const periodLimit = Math.max(PERIODS_SHOWN, Math.trunc(Number(params.plimit)) || 0);
  const periodsShown = sortRows(periodRows, signupColumns, periodSort).slice(0, periodLimit);
  const periodsHidden = periodRows.length - periodsShown.length;

  const stageSlices: Slice[] = LIFECYCLE_STAGES.map((item) => ({
    key: item.key,
    label: item.label,
    value: funnel[item.key as keyof typeof funnel] as number,
    hint: item.hint,
  }));

  /* ----------------------------------------------------------------------- */
  /* The accounts table                                                       */
  /* ----------------------------------------------------------------------- */

  /* The same filter and order the CSV route applies, from the same module, so
     the export is exactly the list on screen - every page of it. */
  const sorted = sortAccounts(filterAccounts(accounts, filters, range), sort);
  const page = pageFromParam(params.page, pageCount(sorted.length, per));
  const shown = pageSlice(sorted, page, per);
  const moreOnPhone = page === 1 && per < PER_PAGE_MAX ? sorted.length - shown.length : 0;

  /* What each table's links must keep: the range and the other table's state. */
  const accountState = {
    stage: filters.stage,
    q: filters.q,
    joined: filters.joined,
    paid: filters.paid,
    activity: filters.activity,
    minspent: filters.minspent ? String(filters.minspent) : undefined,
    per: per === PER_PAGE ? undefined : String(per),
  };
  const periodState = {
    psort: params.psort,
    pdir: params.pdir,
    pempty: hideEmpty ? "hide" : undefined,
    plimit: periodLimit > PERIODS_SHOWN ? String(periodLimit) : undefined,
  };
  const base = {
    ...rangeParams(range),
    ...accountState,
    sort: params.sort,
    dir: params.dir,
    ...periodState,
  };
  const usersHref = (changes: Record<string, string | undefined>, hash: string) =>
    `/admin/users?${queryString({ ...base, ...changes })}#${hash}`;

  const exportHref = `/admin/users/export?${queryString({
    ...rangeParams(range),
    ...accountState,
    per: undefined,
    sort: sort.key,
    dir: sort.desc ? "desc" : "asc",
  })}`;

  const accountColumnList = accountColumns();
  const preset = presetOf(sort);
  const sortLabel = accountColumnList.find((column) => column.key === sort.key)?.label ?? sort.key;
  const filterText = filtersSentence(filters);

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
        <div className="xl:col-span-2" id="signups">
          <Panel
            title={`Sign-ups, by ${range.bucket}`}
            description="Every column sorts. A period opens the accounts that registered in it."
            bodyClassName="p-0"
          >
            {emptyPeriods > 0 || periodsHidden > 0 ? (
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-divider px-4 py-2 text-xs text-muted sm:px-5">
                <span className="tabular-nums">
                  {fmtNumber(periodsShown.length)} of {fmtNumber(periodRows.length)} {range.bucket}s
                  {hideEmpty && emptyPeriods > 0
                    ? ` · ${fmtNumber(emptyPeriods)} with no sign-ups hidden`
                    : ""}
                </span>
                {emptyPeriods > 0 ? (
                  <Link
                    href={usersHref({ pempty: hideEmpty ? undefined : "hide" }, "signups")}
                    className="inline-flex min-h-8 items-center font-medium text-brand-500 hover:text-brand-600"
                  >
                    {hideEmpty
                      ? `Show empty ${range.bucket}s`
                      : `Hide ${fmtNumber(emptyPeriods)} with no sign-ups`}
                  </Link>
                ) : null}
              </div>
            ) : null}
            <DataTable
              rows={periodsShown}
              columns={signupColumns}
              sort={periodSort}
              /* Everything else on the page rides along, so sorting the periods
                 does not silently reset the accounts table under it. The anchor
                 brings the reader back to the table they clicked. */
              sortHref={sortHrefFor(
                "/admin/users",
                { ...base, page: params.page },
                periodSort,
                { keys: PERIOD_SORT_KEYS, hash: "signups" },
              )}
              rowKey={(row) => row.bucket}
              totalsOver={signupPeriods}
              totalsLabel="In range"
              emptyLabel="Nobody registered in this range"
            />
            {periodsHidden > 0 ? (
              <div className="border-t border-divider px-2 py-1.5">
                <ShowMore
                  href={usersHref({ plimit: String(periodLimit + PERIODS_STEP) }, "signups")}
                  remaining={Math.min(periodsHidden, PERIODS_STEP)}
                  noun={`more ${range.bucket}s`}
                />
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-3 border-t border-divider px-5 py-4 sm:grid-cols-4">
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
        id="accounts"
        title="Accounts"
        description={`${fmtNumber(sorted.length)} of ${fmtNumber(accounts.length)} accounts${filterText ? `: ${filterText}` : ""}. Money and credits are for the selected range; balance and stage are as of now.`}
        bodyClassName="p-0"
        actions={
          /* A plain anchor: it is a download, and a client-side navigation
             would try to render the CSV as a page. Every matching row, not
             only this page. */
          <a href={exportHref} className={buttonClass("secondary", "sm")}>
            <Download size={13} />
            CSV · {fmtNumber(sorted.length)}
          </a>
        }
      >
        <form
          method="get"
          action="/admin/users#accounts"
          className="grid grid-cols-2 gap-2 border-b border-divider px-4 py-3 sm:flex sm:flex-wrap sm:items-end sm:px-5"
        >
          {/* The range and the sign-up table's view ride along; the page number
              does not, since a new filter is a new list. A header-chosen
              direction rides along only while the sort is not a preset. */}
          {Object.entries({
            ...rangeParams(range),
            ...periodState,
            dir: preset ? undefined : params.dir,
          }).map(([key, value]) =>
            value ? <input key={key} type="hidden" name={key} value={value} /> : null,
          )}
          <FilterField label="Search" className="col-span-2 sm:w-52">
            <Input
              name="q"
              defaultValue={params.q ?? ""}
              placeholder="Name, email or district"
              className="h-9 w-full py-0 text-xs"
            />
          </FilterField>
          <FilterField label="Stage">
            <Select
              name="stage"
              defaultValue={filters.stage ?? ""}
              className="h-9 w-full py-0 text-xs"
            >
              <option value="">Any stage</option>
              {LIFECYCLE_STAGES.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Activity in range">
            <Select
              name="activity"
              defaultValue={filters.activity ?? ""}
              className="h-9 w-full py-0 text-xs"
            >
              <option value="">Everyone</option>
              <option value="any">Hide all-zero rows</option>
              <option value="used">Used the service</option>
              <option value="none">Only all-zero rows</option>
            </Select>
          </FilterField>
          <FilterField label="Payments in range">
            <Select name="paid" defaultValue={filters.paid ?? ""} className="h-9 w-full py-0 text-xs">
              <option value="">Paid or not</option>
              <option value="range">Paid something</option>
              <option value="none">Paid nothing</option>
            </Select>
          </FilterField>
          <FilterField label="Signed up">
            <Select
              name="joined"
              defaultValue={filters.joined ?? ""}
              className="h-9 w-full py-0 text-xs"
            >
              <option value="">Any time</option>
              <option value="range">In this range</option>
            </Select>
          </FilterField>
          <FilterField label="Min credits used">
            <Input
              name="minspent"
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              defaultValue={filters.minspent ?? ""}
              placeholder="0"
              className="h-9 w-full py-0 text-xs sm:w-28"
            />
          </FilterField>
          <FilterField label="Sort">
            <Select
              name="sort"
              defaultValue={preset ?? sort.key}
              className="h-9 w-full py-0 text-xs"
            >
              {preset ? null : <option value={sort.key}>{`${sortLabel} (column)`}</option>}
              {SORT_PRESETS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FilterField>
          <FilterField label="Per page">
            <Select name="per" defaultValue={String(per)} className="h-9 w-full py-0 text-xs">
              {[...new Set([25, 50, 100, per])]
                .sort((x, y) => x - y)
                .map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
            </Select>
          </FilterField>
          <div className="col-span-2 flex items-center gap-2">
            <FilterSubmitButton icon={<Filter size={13} />} className="flex-1 sm:flex-none">
              Apply
            </FilterSubmitButton>
            {filterText ? (
              <Link
                href={`/admin/users?${queryString({ ...rangeParams(range), ...periodState })}#accounts`}
                className={buttonClass("ghost", "sm")}
              >
                Clear
              </Link>
            ) : null}
          </div>
        </form>

        {shown.length === 0 ? (
          <EmptyState
            title="No accounts match"
            description={
              filterText ? "Clear the filters, or widen the date range." : "No accounts yet."
            }
          />
        ) : (
          <>
            <DataTable
              rows={shown}
              columns={accountColumnList}
              sort={sort}
              sortHref={sortHrefFor(
                "/admin/users",
                { ...rangeParams(range), ...accountState, ...periodState },
                sort,
                { hash: "accounts" },
              )}
              rowKey={(row) => row.id}
              totalsOver={sorted}
              totalsLabel="All matching"
            />

            {/* On a phone, lengthening the list reads better than paging it.
                Capped, so it never becomes "load everything". */}
            {moreOnPhone > 0 ? (
              <div className="border-t border-divider px-2 py-1.5 sm:hidden">
                <ShowMore
                  href={usersHref(
                    { per: String(Math.min(per + PER_PAGE, PER_PAGE_MAX)), page: undefined },
                    "accounts",
                  )}
                  remaining={Math.min(moreOnPhone, PER_PAGE)}
                  noun="more accounts"
                />
              </div>
            ) : null}

            <div className="border-t border-divider px-4 py-3 sm:px-5">
              <Pager
                page={page}
                total={sorted.length}
                pageSize={per}
                noun="accounts"
                href={{ path: "/admin/users", params: base }}
                className=""
              />
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

/** A labelled control in the accounts filter bar. */
function FilterField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span className="text-[11px] font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

/**
 * The accounts table's columns. Every key is an ACCOUNT_SORT key, so a header
 * click and the CSV route order by the same thing.
 *
 * There used to be a "Lifetime" column here, but admin_account_activity only
 * returns the window's payments and it printed paid_inr twice. Lifetime value
 * lives on the account itself and on Finance.
 */
function accountColumns(): Column<AccountActivity>[] {
  const num = (value: unknown) => Number(value) || 0;
  const free = (row: AccountActivity) => num(row.credits_free) + num(row.credits_admin);
  return [
    {
      key: "name",
      label: "Account",
      sortBy: (row) => (row.full_name ?? row.email).toLowerCase(),
      cell: (row) => (
        <Link href={`/admin/officers/${row.id}`} className="group flex items-center gap-2.5">
          <Avatar size="sm" text={initials(row.full_name, row.email)} />
          <span className="min-w-0">
            <span className="block max-w-56 truncate text-sm text-ink group-hover:text-brand-400">
              {row.full_name ?? row.email}
            </span>
            <span className="block max-w-56 truncate text-xs text-faint">
              joined {fmtDate(row.signed_up_on)}
              {row.district ? ` · ${row.district}` : ""}
            </span>
          </span>
        </Link>
      ),
    },
    {
      key: "stage",
      label: "Stage",
      sortBy: (row) => row.stage,
      cell: (row) => {
        const info = stageOf(row.stage);
        return (
          <Badge tone={(info?.tone ?? "neutral") as BadgeTone}>{info?.label ?? row.stage}</Badge>
        );
      },
    },
    {
      key: "plan",
      label: "Plan",
      sortBy: (row) => row.plan_name ?? "",
      className: "text-sm text-muted",
      cell: (row) => row.plan_name ?? "—",
    },
    {
      key: "paid_inr",
      label: "Paid in range",
      align: "right",
      sortBy: (row) => num(row.paid_inr),
      cell: (row) => (num(row.paid_inr) > 0 ? fmtRupees(num(row.paid_inr)) : "—"),
      total: (rows) => fmtRupees(sumBy(rows, (row) => num(row.paid_inr))),
    },
    {
      key: "payments",
      label: "Payments",
      align: "right",
      sortBy: (row) => num(row.payments),
      cell: (row) => (num(row.payments) > 0 ? fmtNumber(num(row.payments)) : "—"),
      total: (rows) => fmtNumber(sumBy(rows, (row) => num(row.payments))),
    },
    {
      key: "credits_spent",
      label: "Credits used",
      align: "right",
      sortBy: (row) => num(row.credits_spent),
      cell: (row) => (num(row.credits_spent) > 0 ? formatCredits(num(row.credits_spent)) : "—"),
      total: (rows) => formatCredits(sumBy(rows, (row) => num(row.credits_spent))),
    },
    {
      key: "free",
      label: "Free given",
      align: "right",
      sortBy: free,
      cell: (row) => (free(row) > 0 ? formatCredits(free(row)) : "—"),
      total: (rows) => formatCredits(sumBy(rows, free)),
    },
    {
      key: "credits",
      label: "Balance",
      align: "right",
      sortBy: (row) => num(row.credits),
      cell: (row) => <Badge tone={balanceTone(row.credits)}>{formatCredits(row.credits)}</Badge>,
    },
    {
      key: "last_active_at",
      label: "Last seen",
      sortBy: (row) => row.last_active_at ?? "",
      className: "whitespace-nowrap text-xs text-muted",
      cell: (row) => fmtRelative(row.last_active_at),
    },
  ];
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
