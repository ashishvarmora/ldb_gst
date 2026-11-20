import { ArrowDownUp, CreditCard as PageIcon, Download, Wallet } from "lucide-react";
import Link from "next/link";

import { PaymentList } from "./PaymentList";
import { Receipt } from "./Receipt";
import {
  countAllPayments,
  loadPaymentByOrder,
  loadPaymentSummary,
  loadPayments,
  parsePaymentSort,
  parseStatusFilter,
  type StatusFilter,
} from "./payments";
import { RangeControl, UrlSelect } from "@/components/HistoryControls";
import { Figure, Segmented, SummaryLine, plural } from "@/components/HistoryUi";
import { LedgerLinks } from "../credits/LedgerNav";
import { Pager, pageCount, pageFromParam } from "@/components/Pager";
import { publicSettings } from "@/components/SiteFooter";
import { EmptyState, LinkButton, PageHeader } from "@/components/ui";
import { fmtRupees } from "@/lib/format";
import { parseHistoryRange, rangeLabel, rangeQuery } from "@/lib/history-range";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Payments: only payments, every one of them - paid, failed and started but
 * never paid.
 *
 *   one summary line   Total paid · N payments · failed (only if any), (i)
 *   filters            status segmented, one date control, a sort select
 *   rows               PaymentList (tap a row for ids, times, credits)
 *   receipt            ?ref=<order id> renders the printable receipt on top
 *
 * Filters live in the URL and are applied in the database (payments.ts), so
 * status, date, sort and pager always describe one result set. Any filter
 * change drops the page number.
 *
 * Also where the checkout window lands: ?ref= is a Razorpay order id, and the
 * receipt panel says what became of that payment (Receipt.tsx).
 */

const PAGE_SIZE = 25;
const BASE = "/portal/payments";

type PaymentsQuery = {
  range?: string;
  from?: string;
  to?: string;
  status?: string;
  sort?: string;
  page?: string;
  /** A Razorpay order id, and the whole of the confirmation screen's state. */
  ref?: string;
};

const SORT_OPTIONS = [
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "amount_desc", label: "Amount: high to low" },
  { value: "amount_asc", label: "Amount: low to high" },
];

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Payments — ${brandName}` };
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<PaymentsQuery>;
}) {
  const [{ overview }, params] = await Promise.all([requirePortalSession(), searchParams]);
  const admin = getSupabaseAdmin();

  /* All time by default: a customer pays two or three times a year, and a
     30-day default shows an empty list to somebody who has definitely paid. */
  const range = parseHistoryRange(params, { fallback: "all", allowAll: true });
  const status = parseStatusFilter(params.status);
  const sort = parsePaymentSort(params.sort);

  /* The query every link on this page carries, minus the page number. */
  const filters: Record<string, string> = {
    ...rangeQuery(range, "all"),
    ...(status !== "all" ? { status } : {}),
    ...(sort !== "newest" ? { sort } : {}),
  };
  const withoutRange: Record<string, string> = {
    ...(status !== "all" ? { status } : {}),
    ...(sort !== "newest" ? { sort } : {}),
  };
  const qs = (extra: Record<string, string | undefined> = {}) => {
    const search = new URLSearchParams(filters);
    for (const [key, value] of Object.entries(extra)) {
      if (value) search.set(key, value);
      else search.delete(key);
    }
    const out = search.toString();
    return out ? `${BASE}?${out}` : BASE;
  };

  const [summary, everPaid, receipt, settings] = await Promise.all([
    loadPaymentSummary(admin, overview.id, range),
    countAllPayments(admin, overview.id),
    loadPaymentByOrder(admin, overview.id, params.ref),
    publicSettings(),
  ]);

  const matching =
    status === "all" ? summary.all : status === "paid" ? summary.paid : status === "failed" ? summary.failed : summary.pending;
  const pages = pageCount(matching, PAGE_SIZE);
  const page = pageFromParam(params.page, pages);
  const list = await loadPayments(
    admin,
    overview.id,
    { status, from: range.from, to: range.to, sort },
    { offset: (page - 1) * PAGE_SIZE, limit: PAGE_SIZE },
  );

  /* What the receipt's payment did to the balance, only when there is one. */
  const effect = receipt
    ? ((
        await admin
          .from("payment_credit_effect")
          .select("credits_added, balance_before, balance_after")
          .eq("payment_id", receipt.id)
          .eq("user_id", overview.id)
          .maybeSingle()
      ).data ?? null)
    : null;

  const header = (
    <PageHeader
      icon={<PageIcon size={20} strokeWidth={2} />}
      title="Payments"
      actions={
        list.total > 0 ? (
          <LinkButton href={`${BASE}/export?${new URLSearchParams(filters).toString()}`} variant="secondary" size="sm">
            <Download size={14} />
            CSV
          </LinkButton>
        ) : null
      }
    />
  );

  if (everPaid === 0 && !receipt) {
    return (
      <div className="ledger-page">
        {header}
        <div className="panel">
          <EmptyState
            title="No payments yet"
            action={
              <LinkButton href="/portal/plan" variant="primary">
                <Wallet size={15} />
                Plan and credits
              </LinkButton>
            }
          />
        </div>
        <LedgerLinks current="payments" />
      </div>
    );
  }

  const statusItems: { key: StatusFilter; label: string; count: number; tone?: "bad" | "warn" }[] = [
    { key: "all", label: "All", count: 0 },
    { key: "paid", label: "Paid", count: summary.paid },
    { key: "failed", label: "Failed", count: summary.failed, tone: "bad" },
    { key: "pending", label: "Pending", count: summary.pending, tone: "warn" },
  ];

  return (
    <div className="ledger-page">
      {header}

      {receipt ? (
        <Receipt row={receipt} overview={overview} supportEmail={settings.supportEmail} effect={effect} />
      ) : null}

      <SummaryLine
        parts={[
          <>
            Total paid <Figure value={fmtRupees(summary.paidInr)} />
          </>,
          plural(summary.paid, "payment"),
          summary.failed > 0 ? (
            <span className="is-bad">{plural(summary.failed, "failed", "failed")}</span>
          ) : null,
          <span className="hist-summary-range">{rangeLabel(range)}</span>,
        ]}
        infoLabel="payment totals"
        info={
          <>
            <p>Total paid counts completed payments only. Failed and pending payments charged nothing and added no credits.</p>
            <p>
              Pending means a checkout was started but not completed. If money left your account and a payment still
              shows pending after an hour, <Link href="/contact" className="link">contact us</Link>
              {settings.supportEmail ? ` (${settings.supportEmail})` : ""} with its payment ID.
            </p>
            <p>All times are IST.</p>
          </>
        }
      />

      <div className="hist-filters">
        <Segmented
          label="Payment status"
          current={status}
          items={statusItems.map((item) => ({
            key: item.key,
            label: item.label,
            count: item.count || null,
            tone: item.tone,
            href: (() => {
              const search = new URLSearchParams(filters);
              if (item.key === "all") search.delete("status");
              else search.set("status", item.key);
              const out = search.toString();
              return out ? `${BASE}?${out}` : BASE;
            })(),
          }))}
        />
        <div className="hist-toolbar">
          <RangeControl
            basePath={BASE}
            params={withoutRange}
            current={range.key}
            from={range.from}
            to={range.to}
            fallback="all"
            options={["all", "7d", "30d", "90d", "custom"]}
          />
          <UrlSelect
            basePath={BASE}
            params={filters}
            name="sort"
            value={sort}
            fallback="newest"
            label="Sort payments"
            icon={<ArrowDownUp size={14} aria-hidden />}
            options={SORT_OPTIONS}
            className="hist-sort"
          />
        </div>
      </div>

      {list.error ? (
        <div className="panel">
          <EmptyState title="Could not read your payments" description="Your purchases are not affected. Please try again in a moment." />
        </div>
      ) : list.rows.length === 0 ? (
        <div className="panel">
          <EmptyState
            title={status === "all" ? "No payments in this period" : `No ${status} payments in this period`}
            action={
              <LinkButton href={BASE} variant="secondary" size="sm">
                Show all payments
              </LinkButton>
            }
          />
        </div>
      ) : (
        <>
          <PaymentList rows={list.rows} receiptHref={(row) => `${qs({ ref: row.razorpay_order_id, page: page > 1 ? String(page) : undefined })}#receipt`} />
          <Pager
            page={page}
            total={list.total}
            pageSize={PAGE_SIZE}
            noun="payments"
            href={(next) => qs({ page: next > 1 ? String(next) : undefined })}
            className="hist-pager"
          />
        </>
      )}

      <LedgerLinks current="payments" />
    </div>
  );
}
