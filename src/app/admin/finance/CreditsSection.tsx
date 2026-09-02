import Link from "next/link";
import {
  Banknote,
  ClipboardList,
  CreditCard,
  Download,
  Gauge,
  Gift,
  Plus,
  Wallet,
} from "lucide-react";

import { creditMeasures } from "./ledger";
import type { FinanceParams } from "./page";
import { MetricCard, ShareBreakdown, type Slice } from "@/components/charts";
import { Pager, pageFromParam, pageSlice } from "@/components/Pager";
import { FacetFilters, GroupByBar } from "@/components/PivotControls";
import { PivotTable, type DrillLinks } from "@/components/PivotTable";
import {
  bucketRange,
  joinList,
  parseDims,
  parseKind,
  parseList,
  parseSort,
  queryString,
  sortHrefFor,
  sortParams,
  sortPivotRows,
} from "@/components/report";
import { LinkCard, Panel, buttonClass } from "@/components/ui";
import {
  loadFacets,
  loadPivot,
  loadPivotTotals,
  loadRevenueSeries,
  rangeParams,
  sumBy,
  type DateRange,
  type PivotDimension,
} from "@/lib/analytics";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { fmtNumber, fmtRupees } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The credit ledger, sliced however the reader asks.
 *
 * This section is the direct answer to the owner's complaint. It used to be a
 * row of five stat cards over two stacked bar charts, and the card reading
 * "given free 500" had nothing behind it at all - no per-account breakdown, no
 * link, nothing. The number was true and useless: it could not tell anybody
 * whether five accounts had claimed a hundred each or one account had taken the
 * lot, which is the difference between a sign-up bonus that works and a coupon
 * that is being farmed.
 *
 * So every card here opens the ledger pre-sliced to the rows it is a total of,
 * and the ledger itself is a table that groups by any combination of period,
 * customer, truck, action and source, filters to any set of them, sorts by any
 * column and exports. The totals line is read from admin_credit_pivot with no
 * dimensions - the same function the rows came from - so the figure at the
 * bottom cannot drift from the figure at the top, which is what happens when a
 * screen sums the page it is showing and calls that a total.
 */

/** Rows per page of the grouped ledger. */
const PER_PAGE = 50;

/**
 * Past this the grouping is finer than anybody can read, and - more to the
 * point - fine enough to be at risk of PostgREST's own row ceiling, which
 * truncates silently. A capped list that looks complete is the one failure mode
 * this console has been bitten by before, so it says so instead.
 */
const TOO_MANY_ROWS = 1000;

/** What the reader lands on before touching anything: who got what, and from where. */
const DEFAULT_DIMS: PivotDimension[] = ["account", "source"];

export async function CreditsSection({
  params,
  range,
}: {
  params: FinanceParams;
  range: DateRange;
}) {
  const admin = getSupabaseAdmin();

  const dims = parseDims(params.dims, DEFAULT_DIMS);
  const kind = parseKind(params.kind);
  const accounts = parseList(params.account);
  const trucks = parseList(params.truck);
  const reasons = parseList(params.reason);
  const sources = parseList(params.source);

  const filters = {
    from: range.from,
    to: range.to,
    bucket: range.bucket,
    kind,
    users: accounts,
    trucks,
    reasons,
    sources,
  };

  /*
   * Seven reads, all in parallel, and each one is a single aggregate.
   *
   * The three totals calls look like waste next to summing the rows already on
   * screen, and they are the point: a headline figure has to be read from the
   * same function as the table beneath it or the two will eventually disagree,
   * and when they do nobody can tell which is wrong. The split by source and
   * reason is one call rather than four filtered ones because a grouped result
   * from this function is exact, so folding it here cannot introduce an error
   * that a second query would have avoided.
   */
  const [rows, totals, grantSplit, grantTotals, spendTotals, facets, revenue] = await Promise.all([
    loadPivot(admin, { ...filters, dims }),
    loadPivotTotals(admin, filters),
    loadPivot(admin, {
      from: range.from,
      to: range.to,
      dims: ["source", "reason"],
      kind: "grant",
    }),
    loadPivotTotals(admin, { from: range.from, to: range.to, kind: "grant" }),
    loadPivotTotals(admin, { from: range.from, to: range.to, kind: "spend" }),
    loadFacets(admin, range, kind),
    loadRevenueSeries(admin, range),
  ]);

  const issued = Number(grantTotals?.credits) || 0;
  const spent = Math.abs(Number(spendTotals?.credits) || 0);

  const creditsFrom = (source: string) =>
    sumBy(
      grantSplit.filter((row) => row.source === source),
      (row) => row.credits,
    );
  const givenFree = creditsFrom("free");
  const givenByAdmin = creditsFrom("admin");

  /*
   * What a free credit is worth, in rupees.
   *
   * Priced at what customers actually paid in this window - money received
   * divided by credits sold - not at any pack's list price. A giveaway valued
   * at list price overstates its cost by however much discount was running.
   */
  const received = sumBy(revenue, (row) => row.gross_inr);
  const creditsSold = sumBy(revenue, (row) => row.credits_sold);
  const rupeesPerCredit = creditsSold > 0 ? received / creditsSold : 0;
  const giveawayCost = (givenFree + givenByAdmin) * rupeesPerCredit;

  /* ----------------------------------------------------------------------- */
  /* Links                                                                    */
  /* ----------------------------------------------------------------------- */

  /**
   * A link to this report, carrying the window and nothing else unless it is
   * named.
   *
   * Starting from the window rather than from the current query string is the
   * decision that makes the headline cards behave: "Given free" has to land on
   * the free grants for EVERY account, so a card that inherited whichever
   * customer filter happened to be set would answer a narrower question than
   * the figure printed on it. Anything that should survive a click - the
   * grouping, the filters - is spread in explicitly by the caller.
   */
  const href = (extra: Record<string, string | undefined> = {}) =>
    `/admin/finance?${queryString({ ...rangeParams(range), section: "credits", ...extra })}`;

  /** The current slice, for the links that must preserve rather than reset it. */
  const slice = {
    kind,
    account: joinList(accounts),
    truck: joinList(trucks),
    reason: joinList(reasons),
    source: joinList(sources),
  };

  const sort = parseSort(params, { key: "credits", desc: true });
  const carried = { ...rangeParams(range), section: "credits", dims: dims.join(","), ...slice };

  /* ----------------------------------------------------------------------- */
  /* The columns                                                              */
  /* ----------------------------------------------------------------------- */

  /* Built in ledger.ts, because the CSV route builds the same set from the same
     function - an export offering a column the table does not have, or pricing
     one differently, is a spreadsheet that disagrees with the page it came
     from. */
  const measures = creditMeasures({ kind, dims, rupeesPerCredit });

  const links: DrillLinks = {
    /* The period narrows this same report to that period. bucketRange is what
       makes a weekly or monthly row work: a bucket is stored as the date it
       starts on, so passing it as both ends of a custom range would answer for
       one day and look like the rest of the month had gone missing. */
    bucket: (row) => {
      if (!row.bucket) return null;
      const { from, to } = bucketRange(row.bucket, range.bucket);
      return href({ ...slice, dims: dims.join(","), range: "custom", from, to });
    },
    account: (row) => (row.user_id ? `/admin/officers/${row.user_id}?tab=credits` : null),
    truck: (row) =>
      row.truck_number ? `/admin/trucks?q=${encodeURIComponent(row.truck_number)}` : null,
    /* An action or a source drills the other way: instead of leaving the
       report, it narrows to that value and regroups by customer - which is
       "who did this", the question a total of an action always raises. */
    reason: (row) =>
      row.reason ? href({ ...slice, reason: row.reason, dims: "account" }) : null,
    source: (row) =>
      row.source ? href({ ...slice, source: row.source, dims: "account,reason" }) : null,
  };

  const sorted = sortPivotRows(rows, sort, measures);
  const page = pageFromParam(params.page);
  const shown = pageSlice(sorted, page, PER_PAGE);

  /* ----------------------------------------------------------------------- */
  /* The breakdowns beside it                                                 */
  /* ----------------------------------------------------------------------- */

  const sourceSlices: Slice[] = ["paid", "admin", "free", "other"].map((source) => ({
    key: source,
    label:
      source === "paid"
        ? "Bought"
        : source === "admin"
          ? "Given by an admin"
          : source === "free"
            ? "Free"
            : "Unclassified",
    value: creditsFrom(source),
    hint:
      source === "other"
        ? "A reason no bucket recognises — worth investigating"
        : `${fmtNumber(sumBy(grantSplit.filter((row) => row.source === source), (row) => row.entries))} entries`,
    href: href({ kind: "grant", source, dims: "account,reason" }),
  }));

  /* The giveaway itemised by why it was given - the difference between a
     sign-up tier that is working and a bonus code that is being farmed. */
  const giveawayReasons = new Map<string, number>();
  for (const row of grantSplit) {
    if (row.source !== "free" && row.source !== "admin") continue;
    const reason = row.reason ?? "unknown";
    giveawayReasons.set(reason, (giveawayReasons.get(reason) ?? 0) + (Number(row.credits) || 0));
  }
  const giveawaySlices: Slice[] = [...giveawayReasons.entries()]
    .map(([reason, value]) => ({
      key: reason,
      label: CREDIT_REASON_LABEL[reason] ?? reason,
      value,
      href: href({ kind: "grant", reason, dims: "account" }),
    }))
    .sort((a, b) => b.value - a.value);

  return (
    <>
      {/*
       * Five figures, five ways in. Each href lands on the ledger already
       * grouped and filtered to the rows that figure is the total of, which is
       * the whole of "who claimed it": tap "Given free" and the next screen is
       * one row per account per reason, with the same total at the foot of it.
       */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-5">
        <MetricCard
          label="Credits issued"
          value={formatCredits(issued)}
          hint={`${fmtNumber(Number(grantTotals?.entries) || 0)} grants · see who`}
          icon={<Wallet size={15} />}
          href={href({ kind: "grant", dims: "source,account" })}
        />
        <MetricCard
          label="Credits spent"
          value={formatCredits(spent)}
          hint={
            issued > 0 ? `${Math.round((spent / issued) * 100)}% of what was issued` : "nothing issued in range"
          }
          icon={<CreditCard size={15} />}
          href={href({ kind: "spend", dims: "account,truck" })}
        />
        <MetricCard
          label="Given free"
          value={formatCredits(givenFree)}
          hint="sign-up, referrals, bonus codes — see who claimed it"
          goodWhen="neither"
          icon={<Gift size={15} />}
          href={href({ kind: "grant", source: "free", dims: "account,reason" })}
        />
        <MetricCard
          label="Added by an admin"
          value={formatCredits(givenByAdmin)}
          hint="top-ups and adjustments — see who got them"
          goodWhen="neither"
          icon={<Plus size={15} />}
          href={href({ kind: "grant", source: "admin", dims: "account,reason" })}
        />
        <MetricCard
          label="What the giveaway cost"
          value={fmtRupees(Math.round(giveawayCost))}
          hint={
            rupeesPerCredit > 0
              ? `at ${fmtRupees(Math.round(rupeesPerCredit * 100) / 100)} per credit actually paid`
              : "no sales in range to price against"
          }
          goodWhen="down"
          icon={<Banknote size={15} />}
          href={href({ kind: "grant", source: "free,admin", dims: "account,reason" })}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            id="ledger"
            title="The credit ledger, grouped"
            description={
              kind === "grant" && rupeesPerCredit > 0
                ? "Worth prices each credit at what customers actually paid per credit in this window, not at any pack's list price."
                : "Group, filter and sort it. The totals line comes from the same database function as the rows, so it agrees with them however this is sliced."
            }
            bodyClassName="p-0"
            actions={
              <a
                href={`/admin/finance/export?${queryString({ ...carried, ...sortParams(sort) })}`}
                className={buttonClass("secondary", "sm")}
              >
                <Download size={13} />
                Export CSV
              </a>
            }
          >
            <div className="space-y-3 border-b border-divider px-4 py-3.5 sm:px-5">
              <GroupByBar
                dims={dims}
                hrefFor={(next) =>
                  href({ ...slice, ...sortParams(sort), dims: next.join(",") })
                }
              />
              <FacetFilters
                action="/admin/finance"
                carried={{
                  ...rangeParams(range),
                  section: "credits",
                  dims: dims.join(","),
                  ...sortParams(sort),
                }}
                facets={facets}
                kind={kind}
                accounts={accounts}
                trucks={trucks}
                reasons={reasons}
                sources={sources}
                /* Clearing keeps the grouping and the window and drops every
                   filter, because "show me all of it, arranged the way I have
                   it" is what somebody means by clearing a filter - not "put
                   the report back the way you found it". */
                clearHref={href({ dims: dims.join(","), ...sortParams(sort) })}
              />
            </div>

            <PivotTable
              rows={shown}
              dims={dims}
              grain={range.bucket}
              measures={measures}
              sort={sort}
              sortHref={sortHrefFor("/admin/finance", carried, sort, { hash: "ledger" })}
              links={links}
              totals={totals}
              totalsLabel={
                dims.length === 0 ? "Everything in this range" : `All ${fmtNumber(rows.length)} rows`
              }
              emptyTitle="Nothing in the ledger for this slice"
              emptyDescription="Widen the date range, clear a filter, or group by something else."
            />

            {rows.length > 0 ? (
              <div className="border-t border-divider px-4 py-3 sm:px-5">
                {/* A function href rather than the path-and-params form, so
                    the anchor comes along: turning a page of a table this far
                    down should not throw the reader back to the stat cards. */}
                <Pager
                  page={page}
                  total={rows.length}
                  pageSize={PER_PAGE}
                  noun="grouped rows"
                  href={(next) =>
                    `/admin/finance?${queryString({
                      ...carried,
                      ...sortParams(sort),
                      page: next > 1 ? String(next) : undefined,
                    })}#ledger`
                  }
                  className=""
                />
              </div>
            ) : null}

            {/* The one honest caveat. Every figure above is exact; a grouping
                this fine is where a row ceiling starts to bite, and a truncated
                table that looks complete is worse than a warning. */}
            {rows.length >= TOO_MANY_ROWS ? (
              <p className="border-t border-divider px-4 py-3 text-xs text-warn-500 sm:px-5">
                This grouping returned {fmtNumber(rows.length)} rows, which is at the limit of what
                one read can carry. The totals line is still exact — it is one query of its own —
                but drop a dimension or narrow the range before trusting the rows to be all of them.
              </p>
            ) : null}
          </Panel>
        </div>

        <div className="space-y-5">
          {/*
           * The two share bars stay, and they stay BESIDE the table rather than
           * instead of it. A horizontal share reads honestly - it answers "what
           * fraction of the whole", which a column of figures makes the reader
           * work out - and every row of both is a link into the same ledger
           * regrouped around that slice.
           */}
          <Panel
            title="Where credits came from"
            description="Every credit added in this range, by source. Tap one for the accounts behind it."
          >
            <ShareBreakdown
              slices={sourceSlices}
              format={formatCredits}
              emptyLabel="No credits issued in this range"
            />
          </Panel>

          <Panel
            title="What was given away"
            description="Free and admin-added credits, by the reason each was granted."
          >
            <ShareBreakdown
              slices={giveawaySlices}
              format={formatCredits}
              emptyLabel="Nothing was given away in this range"
            />
          </Panel>

          <LinkCard
            href="/admin/logs?type=admin"
            icon={<ClipboardList size={16} />}
            title="Who added those credits"
            description="Every top-up and adjustment made in this console, with the administrator who made it."
            value={formatCredits(givenByAdmin)}
          />

          <LinkCard
            href={`/admin/usage?${new URLSearchParams(rangeParams(range))}`}
            icon={<Gauge size={16} />}
            title="What the spending was for"
            description="Call volume, the manual against automatic split, and how the upstream API behaved."
            value={formatCredits(spent)}
          />

          <LinkCard
            href="/admin/plans?tab=rules"
            icon={<CreditCard size={16} />}
            title="Credit rules"
            description="What one credit buys, and what a rupee buys. Changing these changes every future figure above."
          />

          <p className="text-xs text-faint">
            Spending is stored as a negative delta and every figure here reads it as a quantity, so
            “credits spent” is a positive number in the same units as “credits issued”. The one
            exception is the ledger table with both halves showing, which is labelled{" "}
            <span className="text-muted">Net credits</span> and keeps its sign. Rates live on{" "}
            <Link href="/admin/plans?tab=rules" className="text-brand-500 hover:text-brand-600">
              Plans &amp; credits
            </Link>
            .
          </p>
        </div>
      </div>
    </>
  );
}
