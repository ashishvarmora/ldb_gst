import Link from "next/link";
import { Download, Wallet } from "lucide-react";

import { PAYMENT_COLUMNS } from "./columns";
import { PaymentCards } from "./PaymentCards";
import { Receipt } from "./Receipt";
import {
  MAX_ROWS,
  countAllPayments,
  loadPaymentByOrder,
  loadPayments,
  totalPayments,
} from "./payments";
import { DataTable, sortRows } from "@/components/charts";
import { DateRangeBar } from "@/components/DateRangeBar";
import { LedgerLinks } from "../credits/LedgerNav";
import { HelpNote } from "@/components/Disclosure";
import { Pager, pageCount, pageFromParam, pageSlice } from "@/components/Pager";
import { parseSort, queryString, sortHrefFor } from "@/components/report";
import { publicSettings } from "@/components/SiteFooter";
import { EmptyState, LinkButton, PageHeader, Panel, StatCard } from "@/components/ui";
import { rangeParams, resolveRange } from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { fmtNumber, fmtRupees } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Payments, in the one place they live.
 *
 * This used to be a folded section at the bottom of /portal/plan, six rows at a
 * time, showing an amount, a date and a badge - and nothing else. Support was
 * being asked "you took my money and I got nothing", and the screen the
 * customer was looking at could not tell them the order reference, the payment
 * id, the method, what the list price had been before a code, or whether the
 * checkout they half-remembered had ever completed at all. Every one of those
 * is on this page.
 *
 * It is also where the checkout window lands. `?ref=` is a Razorpay order id,
 * and the panel at the top says what became of that payment - see Receipt.tsx,
 * which is careful never to congratulate anyone for money that has not settled.
 * The owner asked for a congratulations page "with history too", and this is
 * both, in that order, rather than two screens that each hold half of it.
 */

/** Long enough to scan on a phone without a pager on every visit. */
const PAGE_SIZE = 20;

type PaymentsQuery = {
  /** The shared date range: see resolveRange. */
  range?: string;
  from?: string;
  to?: string;
  bucket?: string;
  sort?: string;
  dir?: string;
  page?: string;
  /** A Razorpay order id, and the whole of the confirmation screen's state. */
  ref?: string;
};

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Payment history — ${brandName}` };
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<PaymentsQuery>;
}) {
  const [{ overview }, params] = await Promise.all([requirePortalSession(), searchParams]);
  const admin = getSupabaseAdmin();

  /**
   * All time by default, and that is not the same choice the admin reports
   * make.
   *
   * resolveRange falls back to the last 30 days, which is right for a console
   * watching a business. A customer buys a plan two or three times a year: on
   * their own history a 30-day default shows an empty table to somebody who
   * has definitely paid us, which reads as their payments having been lost.
   */
  const range = resolveRange({ ...params, range: params.range ?? "all" });
  const sort = parseSort(params, { key: "when", desc: true });

  const [{ rows, capped, error }, receipt, everPaid, settings] = await Promise.all([
    loadPayments(admin, overview.id, range),
    loadPaymentByOrder(admin, overview.id, params.ref),
    countAllPayments(admin, overview.id),
    publicSettings(),
  ]);

  const totals = totalPayments(rows);

  /*
   * What the receipt's payment did to the balance, read only when there is a
   * receipt to render. Its own round trip rather than part of the batch above,
   * because it needs the payment's id, which comes out of that batch - and a
   * page with no ?ref= must not pay for a query it will not use.
   *
   * Scoped to this customer's own id as well as the payment's. The view is
   * security_invoker and the service-role client bypasses RLS, so the only
   * thing stopping ?ref= reading a stranger's payment is that both reads are
   * filtered by the session's own user.
   */
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

  /* The range, the receipt and the sort all have to survive a click on
     anything else on this page. Paging is dropped by sortHrefFor itself: a
     re-sorted list is a new result set, and page three of the old one meant
     something else. */
  const carried = { ...rangeParams(range), ref: params.ref };
  const sortHref = sortHrefFor("/portal/payments", carried, sort, { hash: "list" });

  const ordered = sortRows(rows, PAYMENT_COLUMNS, sort);
  const pages = pageCount(ordered.length, PAGE_SIZE);
  const page = pageFromParam(params.page, pages);
  /* Sliced once and handed to both renderings. The table and the phone cards
     must be looking at the same twenty rows: two calls to pageSlice would be
     two chances for the pager underneath to describe one of them. */
  const visible = pageSlice(ordered, page, PAGE_SIZE);

  /**
   * Where a card's "Full receipt" goes.
   *
   * Only the phone cards use it. The table puts both ids in its last column,
   * but a card is not a link - the ids on it are select-all text, so tapping
   * one has to highlight it rather than navigate - which leaves the receipt
   * needing a link of its own, and the receipt is where the copy buttons and
   * the balance either side of the payment live.
   *
   * The range, the sort and the page all come along so that closing the
   * receipt with the browser's back button lands on the list as it was. The
   * hash is not decoration: the receipt renders at the very top of the page,
   * and a reader who tapped a card twelve rows down would otherwise see the
   * query string change and nothing move.
   */
  const cardReceiptHref = (row: (typeof visible)[number]) =>
    `/portal/payments?${queryString({
      ...carried,
      ref: row.razorpay_order_id,
      sort: sort.key,
      dir: sort.desc ? "desc" : "asc",
      page: page > 1 ? String(page) : undefined,
    })}#receipt`;

  const header = (
    <PageHeader
      title="Payment history"
      subtitle="Every payment, what it bought, and the reference to quote if you ever need to ask about one."
      actions={
        rows.length > 0 ? (
          <LinkButton
            href={`/portal/payments/export?${queryString(rangeParams(range))}`}
            variant="secondary"
            size="sm"
          >
            <Download size={14} />
            Download CSV
          </LinkButton>
        ) : null
      }
    />
  );

  /* ---------------------------------------------------------------------- */
  /* nothing has ever been bought                                            */
  /* ---------------------------------------------------------------------- */
  /*
   * A date filter, three zeroes and an empty table is a broken-looking answer
   * to "I have never bought anything", so a brand new account gets one
   * sentence and the way to change that instead.
   */
  if (everPaid === 0 && !receipt) {
    return (
      <>
        {header}
        <Panel bodyClassName="p-0">
          <EmptyState
            title="No payments yet"
            description="Anything you buy — a plan or a credit top-up — is listed here with its reference, what it cost and what it added."
            action={
              <LinkButton href="/portal/plan" variant="primary">
                <Wallet size={15} />
                Plan and credits
              </LinkButton>
            }
          />
        </Panel>
      </>
    );
  }

  return (
    <>
      {header}

      {receipt ? (
        <Receipt
          row={receipt}
          overview={overview}
          supportEmail={settings.supportEmail}
          effect={effect}
        />
      ) : null}

      {/* showBucket is off: nothing on this page is grouped into periods, so a
          daily/weekly/monthly toggle would change a number nobody can see. */}
      <DateRangeBar range={range} showBucket={false} />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/*
          Settled money only, on both figures.

          This is the number the old summary got wrong for months: it counted
          every payment row, so an abandoned checkout inflated what a customer
          believed they had spent with us, and no arithmetic on the page could
          reconcile it against their bank statement.
        */}
        <StatCard
          label="Total paid"
          value={fmtRupees(totals.paidInr)}
          sub={
            <>
              {fmtNumber(totals.settled)} settled payment{totals.settled === 1 ? "" : "s"}
              {totals.discountInr > 0 ? ` · ${fmtRupees(totals.discountInr)} off with codes` : ""}
            </>
          }
        />
        <StatCard
          label="Credits received"
          value={formatCredits(totals.credits)}
          tone="brand"
          sub="Added to your balance by these payments"
        />
        <StatCard
          label="Payments"
          value={fmtNumber(totals.rows)}
          sub={countLine(totals.settled, totals.unfinished, totals.failed)}
        />
      </div>

      <Panel
        id="list"
        title="Every payment in this range"
        description={
          capped ? (
            `Only the most recent ${fmtNumber(MAX_ROWS)} are shown, and the figures above cover those. Narrow the dates to see the rest.`
          ) : (
            <>
              {/* The headings that reorder are the table's, and there is no
                  table below md - so a phone was being told to tap something
                  that is not on its screen. */}
              <span className="hidden md:inline">Tap a column heading to reorder. </span>
              Only settled payments count towards the totals.
            </>
          )
        }
        className="scroll-mt-20"
        bodyClassName="p-0"
      >
        {error ? (
          <EmptyState
            title="Could not read your payments"
            description="Please try again in a moment. If it keeps happening, contact support — nothing you have paid for is affected."
          />
        ) : ordered.length === 0 ? (
          <EmptyState
            title="No payments in this range"
            description="Nothing was bought between these dates."
            action={
              <LinkButton href="/portal/payments?range=all" variant="secondary" size="sm">
                Show every payment
              </LinkButton>
            }
          />
        ) : (
          <>
            {/*
              TWO RENDERINGS OF ONE PAGE OF ROWS, and the breakpoint is md
              rather than sm. Eight columns need about 700px before the cells
              stop being one word wide; a 640px tablet in portrait would have
              got a table it still had to drag sideways, which is the thing the
              cards exist to avoid. Both read the same `visible` slice and both
              take every figure from payments.ts, so neither can drift.
            */}
            <PaymentCards rows={visible} receiptHref={cardReceiptHref} />

            <div className="hidden md:block">
              <DataTable
                rows={visible}
                columns={PAYMENT_COLUMNS}
                sort={sort}
                sortHref={sortHref}
                rowKey={(row) => row.id}
                /* The whole filtered set, not the page: a footer that quietly
                   totalled the twenty rows on screen is how a list comes to
                   disagree with the figures above it. */
                totalsOver={ordered}
                totalsLabel="Settled total"
              />
            </div>

            <div className="border-t border-divider px-4 py-3">
              <Pager
                page={page}
                total={ordered.length}
                pageSize={PAGE_SIZE}
                noun="payments"
                href={(next) =>
                  `/portal/payments?${queryString({
                    ...carried,
                    sort: sort.key,
                    dir: sort.desc ? "desc" : "asc",
                    page: next > 1 ? String(next) : undefined,
                  })}#list`
                }
                className="mt-0"
              />
            </div>
          </>
        )}
      </Panel>

      <div className="mt-3 space-y-2">
        <HelpNote title='What does "started, not paid" mean?'>
          A payment is recorded the moment the payment window opens, before any money moves. If the
          window is closed, or the card is never confirmed, the row stays as{" "}
          <strong>started, not paid</strong> — nothing was charged and nothing was added to your
          balance. Only rows marked <strong>Paid</strong> count towards the totals above.
        </HelpNote>

        <HelpNote title="I have paid but my credits are not here">
          Credits are added when Razorpay confirms the payment, which is normally a few seconds
          after you finish. If the row above still says started, not paid an hour later and money
          has left your account, send the reference on that row{" "}
          {settings.supportEmail ? `to ${settings.supportEmail}` : "to us"} — it is all that is
          needed to find the payment and put it right.{" "}
          {/* The address in app_settings is blank on this platform as it
              stands, so a sentence that only names an email is a dead end.
              /contact is always there and says whatever the owner has set. */}
          <Link href="/contact" className="link">
            How to reach us
          </Link>
          .
        </HelpNote>

        {/* The same sibling row the other two history pages carry, rather than
            one hand-written link: three pages that cross-reference each other
            differently is how a reader loses track of which one they are on. */}
        <LedgerLinks current="payments" />

        <p className="text-xs text-faint">All dates and times are IST.</p>
      </div>
    </>
  );
}

/** "2 paid · 1 started, not paid" - zero counts are left out rather than shown. */
function countLine(settled: number, unfinished: number, failed: number): string {
  const parts = [`${fmtNumber(settled)} paid`];
  if (unfinished > 0) parts.push(`${fmtNumber(unfinished)} started, not paid`);
  if (failed > 0) parts.push(`${fmtNumber(failed)} failed`);
  return parts.join(" · ");
}
