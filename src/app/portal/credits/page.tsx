import Link from "next/link";
import { ChevronRight, Download, ReceiptText as PageIcon } from "lucide-react";

import { TopUpLink } from "@/components/CreditBalance";
import { DateRangeControl } from "@/components/HistoryControls";
import { Segmented, plural } from "@/components/HistoryUi";
import { InfoTip } from "@/components/InfoTip";
import { Pager, pageCount, pageFromParam } from "@/components/Pager";
import { publicSettings } from "@/components/SiteFooter";
import { EmptyState, LinkButton, PageHeader, cx } from "@/components/ui";
import { loadAdditions, loadCreditStatement } from "@/lib/credit-history";
import { creditStanding, formatCredits } from "@/lib/credits";
import { fmtDayTime } from "@/lib/format";
import { HISTORY_RANGE_KEYS, dayLabel, parseHistoryRange, rangeLabel, rangeQuery } from "@/lib/history-range";
import { loadSearchCost, requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { LedgerLinks, parseSide } from "./LedgerNav";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Credits — ${brandName}` };
}

/**
 * Credits: the statement of the balance.
 *
 *   top      Available | Added | Used, ALWAYS ALL TIME (captioned so), the
 *            explanation behind (i). All-time on purpose: Available is a
 *            balance, and Available = Added - Used only holds over all time.
 *   filter   Added | Used per day, and the date control (All by default /
 *            Last 7 days / Custom) that filters both lists; beside it, the
 *            chosen period's own figure (+N added / N used).
 *   Added    one entry per ledger addition, its source named (payment, coupon
 *            code, referral, admin, trial, sign-up...), credits, date-time and
 *            the reference to quote. Never rolled up into days.
 *   Used     one row per day: credits used, split auto checks / manual
 *            searches. Never per truck or per search - that is Activity.
 *
 * FAILED MANUAL SEARCHES DO NOT APPEAR. Each failed search's charge and its
 * 'search_refund' are netted out in src/lib/credit-history.ts (presentation
 * only - the ledger is not touched), so Used is successfully consumed credits,
 * refunds never show as additions, and Available = Added - Used.
 */

const ADDED_PAGE = 25;
const DAYS_PAGE = 31;
const BASE = "/portal/credits";

export default async function CreditsPage({
  searchParams,
}: {
  searchParams: Promise<{ side?: string; page?: string; range?: string; from?: string; to?: string }>;
}) {
  const [{ overview }, searchCost, params] = await Promise.all([
    requirePortalSession(),
    loadSearchCost(),
    searchParams,
  ]);
  const admin = getSupabaseAdmin();
  const side = parseSide(params.side);
  const balance = Number(overview.credits ?? 0);
  const standing = creditStanding(balance, searchCost);
  const requested = pageFromParam(params.page);
  const range = parseHistoryRange(params, { fallback: "all", allowAll: true, keys: HISTORY_RANGE_KEYS });
  const window = { from: range.from, to: range.to };

  const [statement, additions] = await Promise.all([
    loadCreditStatement(admin, overview.id, balance, side === "used" ? requested : 1, DAYS_PAGE, window),
    side === "added" ? loadAdditions(admin, overview.id, requested, ADDED_PAGE, window) : Promise.resolve(null),
  ]);

  /* Every link keeps the range; the side and the page are per link. */
  const sideHref = (next: "added" | "used", page = 1) => {
    const search = new URLSearchParams(rangeQuery(range, "all"));
    if (next === "used") search.set("side", "used");
    if (page > 1) search.set("page", String(page));
    const out = search.toString();
    return out ? `${BASE}?${out}` : BASE;
  };
  const pageHref = (page: number) => sideHref(side, page);
  const period = range.key === "all" ? "All time" : rangeLabel(range);

  return (
    <div className="ledger-page">
      <PageHeader
        icon={<PageIcon size={20} strokeWidth={2} />}
        title="Credits"
        actions={
          <LinkButton href={`/api/export/credits?user=${overview.id}`} variant="secondary" size="sm">
            <Download size={14} />
            CSV
          </LinkButton>
        }
      />

      <InfoTip
        label="credit totals"
        className="credit-totals-wrap"
        rowClassName="credit-totals-row"
        info={
          <>
            <p>Available = Added − Used. Credits never expire.</p>
            <p>
              Used counts completed checks and searches only. A search costs {formatCredits(searchCost)} credit
              {searchCost === 1 ? "" : "s"}; automatic checks use your plan&apos;s rate. A search that fails uses no
              credit and is not listed.
            </p>
            {statement.unexplained !== 0 ? (
              <p>
                {formatCredits(Math.abs(statement.unexplained))} credits of balance corrections are not itemised here.
              </p>
            ) : null}
            <p>All times are IST.</p>
          </>
        }
      >
        <div className="credit-totals-box">
          <p className="credit-totals-caption">All-time totals</p>
          <dl className="credit-totals">
          <div>
            <dt>Available</dt>
            <dd className={cx(standing === "empty" ? "is-bad" : standing === "low" ? "is-warn" : undefined)}>
              {formatCredits(balance)}
              <span className="credit-unit">credits</span>
            </dd>
            <TopUpLink standing={standing} className="credit-topup" />
          </div>
          <div>
            <dt>Added</dt>
            <dd className="is-brand">
              {formatCredits(statement.added)}
              <span className="credit-unit">credits</span>
            </dd>
          </div>
          <div>
            <dt>Used</dt>
            <dd>
              {formatCredits(statement.used)}
              <span className="credit-unit">credits</span>
            </dd>
          </div>
          </dl>
        </div>
      </InfoTip>

      <div className="hist-filters">
        <Segmented
          label="Credits added or used"
          current={side}
          items={[
            { key: "added", label: "Added", href: sideHref("added"), count: statement.period.additions || null },
            { key: "used", label: "Used per day", href: sideHref("used") },
          ]}
        />
        <div className="hist-toolbar">
          <DateRangeControl
            basePath={BASE}
            params={side === "used" ? { side: "used" } : {}}
            current={range.key}
            from={range.from}
            to={range.to}
            fallback="all"
          />
          <p className="hist-period">
            {side === "added" ? (
              <strong className="is-brand">+{formatCredits(statement.period.added)}</strong>
            ) : (
              <strong>{formatCredits(statement.period.used)}</strong>
            )}{" "}
            {side === "added" ? "added" : "used"}
            <span className="hist-period-when">{period}</span>
          </p>
        </div>
      </div>

      {statement.error || additions?.error ? (
        <p className="hist-warn">Some figures could not be read. Please refresh in a moment.</p>
      ) : null}

      {side === "added" && additions ? (
        additions.rows.length === 0 ? (
          <div className="panel">
            <EmptyState title={range.key === "all" ? "No credits added yet" : "No credits added in this period"} />
          </div>
        ) : (
          <>
            <ul className="hrow-list">
              {additions.rows.map((row) => {
                const negative = row.credits < 0;
                const body = (
                  <>
                    <span className="hrow-text">
                      <span className="hrow-title">
                        {row.source}
                        {row.detail ? <span className="hrow-title-note"> · {row.detail}</span> : null}
                      </span>
                      <span className="hrow-sub">
                        <span>{fmtDayTime(row.at)}</span>
                        {row.reference ? (
                          <span className="hrow-mono">
                            {row.referenceLabel === "Code" ? row.reference : `#${row.reference.slice(-6)}`}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="hrow-end">
                      <span className={cx("hrow-amount", negative ? "is-bad" : "is-brand")}>
                        {negative ? "−" : "+"}
                        {formatCredits(Math.abs(row.credits))}
                      </span>
                      <span className="hrow-unit">credits</span>
                    </span>
                  </>
                );
                return (
                  <li key={row.id} className={cx("hrow", negative ? "is-failed" : "is-added")}>
                    {row.orderId ? (
                      <Link
                        href={`/portal/payments?ref=${encodeURIComponent(row.orderId)}#receipt`}
                        className="hrow-head"
                        aria-label={`${row.source}: receipt`}
                      >
                        {body}
                        <ChevronRight size={16} aria-hidden className="hrow-chev" />
                      </Link>
                    ) : (
                      <div className="hrow-head">
                        {body}
                        <span aria-hidden className="hrow-chev-space" />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <Pager
              page={Math.min(requested, pageCount(additions.total, ADDED_PAGE))}
              total={additions.total}
              pageSize={ADDED_PAGE}
              noun="entries"
              href={pageHref}
              className="hist-pager"
            />
          </>
        )
      ) : null}

      {side === "used" ? (
        statement.days.length === 0 ? (
          <div className="panel">
            <EmptyState title={range.key === "all" ? "No credits used yet" : "No credits used in this period"} />
          </div>
        ) : (
          <>
            <ul className="hrow-list">
              {statement.days.map((day) => (
                <li key={day.day} className="hrow">
                  <Link
                    href={`/portal/activity?range=custom&from=${day.day}&to=${day.day}`}
                    className="hrow-head"
                    aria-label={`${dayLabel(day.day)}: open in Activity`}
                  >
                    <span className="hrow-text">
                      <span className="hrow-title">{dayLabel(day.day)}</span>
                      <span className="hrow-sub">
                        {day.autoChecks > 0 ? (
                          <span>{split(plural(day.autoChecks, "auto check"), day.autoChecks, day.autoCredits)}</span>
                        ) : null}
                        {day.manualSearches > 0 ? (
                          <span>
                            {split(plural(day.manualSearches, "manual search", "manual searches"), day.manualSearches, day.manualCredits)}
                          </span>
                        ) : null}
                      </span>
                    </span>
                    <span className="hrow-end">
                      <span className="hrow-amount">{formatCredits(day.credits)}</span>
                      <span className="hrow-unit">credits</span>
                    </span>
                    <ChevronRight size={16} aria-hidden className="hrow-chev" />
                  </Link>
                </li>
              ))}
            </ul>
            <Pager
              page={Math.min(requested, pageCount(statement.totalDays, DAYS_PAGE))}
              total={statement.totalDays}
              pageSize={DAYS_PAGE}
              noun="days"
              href={pageHref}
              className="hist-pager"
            />
          </>
        )
      ) : null}

      <LedgerLinks current="credits" />
    </div>
  );
}

/** "96 auto checks", plus the credits when the plan rate makes them differ. */
function split(label: string, count: number, credits: number): string {
  return credits === count ? label : `${label} (${formatCredits(credits)} cr)`;
}
