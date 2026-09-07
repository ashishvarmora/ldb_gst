import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Receipt as ReceiptIcon,
  Search,
  Truck,
  X,
  XCircle,
} from "lucide-react";

import { CopyReference, type Reference } from "./CopyReference";
import { SettlementWatch } from "./SettlementWatch";
import {
  STATUS_LABEL,
  boughtLabel,
  creditsLine,
  hasGatewayReference,
  isSettled,
  listInr,
  type PaymentRow,
} from "./payments";
import { methodLabel } from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtRupees } from "@/lib/format";
import { DescRow, LinkButton, cx } from "@/components/ui";
import type { OfficerOverview } from "@/lib/types";

/**
 * What happened to one payment, on arrival from the checkout window.
 *
 * The owner asked for a congratulations screen after credits are added. This is
 * that screen, and the reason it is not simply a tick and the word "Thanks" is
 * that the browser does not know whether the credits arrived. Settlement is
 * decided by Razorpay's webhook and settle_payment(); the handshake the browser
 * brings back is a convenience path that can fail on a bad connection while the
 * money moves anyway. So this reads the payment ROW and says what the row says.
 * Four outcomes, four different things on screen, and only one of them
 * congratulates anybody.
 *
 * Whichever it is, the reference is on screen and copyable. If something went
 * wrong that is the only thing support can act on, and it used to be shown
 * nowhere at all.
 */

/**
 * How long a payment may sit unconfirmed before this stops waiting for it.
 *
 * Generous on purpose: created_at is stamped before the payment window even
 * opens, so it already includes however long somebody spent typing card
 * details, and a webhook is normally seconds behind that. Past this, waiting
 * quietly is worse than saying plainly that it has not been confirmed.
 */
const WAIT_MINUTES = 15;

/** After this, the payment is history rather than news, and so is the balance. */
const FRESH_MINUTES = 30;

function minutesSince(at: string | null): number {
  if (!at) return Number.POSITIVE_INFINITY;
  const then = Date.parse(at);
  if (!Number.isFinite(then)) return Number.POSITIVE_INFINITY;
  return (Date.now() - then) / 60_000;
}

const TONES = {
  good: "border-good-500/45 bg-good-500/8",
  warn: "border-warn-500/45 bg-warn-500/8",
  bad: "border-bad-500/45 bg-bad-500/8",
  neutral: "border-line bg-panel",
} as const;

const ICON_TONES = {
  good: "border-good-500/30 bg-good-500/12 text-good-500",
  warn: "border-warn-500/30 bg-warn-500/12 text-warn-500",
  bad: "border-bad-500/30 bg-bad-500/12 text-bad-500",
  neutral: "border-brand-500/30 bg-brand-500/12 text-brand-500",
} as const;

export function Receipt({
  row,
  overview,
  supportEmail,
  effect,
}: {
  row: PaymentRow;
  overview: OfficerOverview;
  supportEmail: string;
  /**
   * What this payment did to the balance, from payment_credit_effect.
   *
   * The owner asked to see the balance either side of a purchase. The figures
   * are the LEDGER's rather than computed here: balance_after off the row this
   * payment wrote, and balance_before as that row's balance_after minus its
   * delta. Taking "before" from the live profile would be wrong the moment
   * anything spends a credit in between - one search run in the seconds after
   * a top-up settles is enough. (This used to cite an automatic check every
   * fifteen minutes as the example; automatic checks are rated zero now and
   * write no ledger row at all, so a manual search is the only thing that can
   * move a balance under this panel.)
   *
   * Null when nothing settled, which is exactly when there is no movement.
   */
  effect: {
    credits_added: number;
    balance_before: number | null;
    balance_after: number | null;
  } | null;
}) {
  const settled = isSettled(row);
  const pending = row.status === "created";
  /** Still worth waiting for, rather than worth reporting. */
  const waiting = pending && minutesSince(row.created_at) < WAIT_MINUTES;
  /**
   * Just now, as opposed to a reference someone has reopened from their
   * history. The balance line and the congratulations both belong to the first
   * case only: on a week-old receipt "your balance is now" describes a balance
   * that has since been spent, which is a true number in a false sentence.
   */
  const fresh = settled && minutesSince(row.paid_at) < FRESH_MINUTES;

  const discount = Number(row.discount_inr) || 0;
  const credits = Number(row.credits) || 0;

  const tone = settled ? "good" : row.status === "failed" ? "bad" : "warn";
  const Icon = settled
    ? fresh
      ? CheckCircle2
      : ReceiptIcon
    : row.status === "failed"
      ? XCircle
      : waiting
        ? Clock
        : AlertTriangle;

  const title = settled
    ? fresh
      ? row.kind === "plan"
        ? "Your plan is active"
        : "Credits added"
      : "Payment receipt"
    : row.status === "failed"
      ? "That payment did not go through"
      : waiting
        ? "Waiting for confirmation"
        : "This payment has not been confirmed";

  /**
   * The reference, and nothing pretending to be one.
   *
   * An offline receipt an administrator entered carries a synthetic order id
   * that Razorpay has never heard of, so quoting it to anybody would send them
   * looking for a payment that does not exist at the gateway.
   */
  const references: Reference[] = hasGatewayReference(row)
    ? [
        { label: "Order reference", value: row.razorpay_order_id },
        ...(row.razorpay_payment_id
          ? [{ label: "Payment id", value: row.razorpay_payment_id }]
          : []),
      ]
    : [];

  return (
    /* id and scroll-mt for the phone cards' "Full receipt" link. This panel is
       the first thing on the page, so a reader who tapped a card twelve rows
       down needs the browser to bring them back up to it rather than leaving
       them looking at the same list with a longer URL. The margin clears the
       portal's sticky header, matching the list panel's own scroll-mt-20. */
    <section id="receipt" className={cx("mb-4 scroll-mt-20 rounded-xl border p-4", TONES[tone])}>
      <div className="flex items-start gap-3">
        <span
          className={cx(
            "inline-flex size-9 shrink-0 items-center justify-center rounded-xl border",
            ICON_TONES[tone],
          )}
        >
          <Icon size={17} />
        </span>

        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-strong">{title}</h2>
          <p className="mt-0.5 text-sm leading-relaxed text-muted">
            {settled ? (
              fresh ? (
                row.kind === "plan" ? (
                  <>
                    {fmtRupees(row.amount_inr)} paid. {overview.plan_name ?? "Your plan"} runs until{" "}
                    {overview.plan_expires_on ? fmtDate(overview.plan_expires_on) : "it is cancelled"}
                    {credits > 0 ? `, and ${formatCredits(credits)} credits came with it` : ""}.
                  </>
                ) : (
                  <>
                    {fmtRupees(row.amount_inr)} paid, and {formatCredits(credits)} credits are on
                    your balance.
                  </>
                )
              ) : (
                <>Paid on {fmtDateTime(row.paid_at ?? row.created_at)}.</>
              )
            ) : row.status === "failed" ? (
              <>
                {row.failure_reason ?? "Razorpay refused it."} Nothing was charged, and nothing was
                added to your balance — you can try again whenever you like.
              </>
            ) : waiting ? (
              <>
                Razorpay has not confirmed this one yet, so nothing has been added to your balance.
                It usually takes a few seconds, and this page will say so as soon as it lands.
              </>
            ) : (
              <>
                We have had no confirmation from Razorpay, so nothing has been added to your
                balance. If money has left your account, quote the reference below{" "}
                {supportEmail ? (
                  <>to {supportEmail}</>
                ) : (
                  /* app_settings holds no support address on this platform as
                     it stands, so "contact support" with no address is where
                     this sentence used to end. /contact always exists. */
                  <Link href="/contact" className="link">
                    to support
                  </Link>
                )}{" "}
                and it will be sorted out.
              </>
            )}
          </p>

          {/* The movement itself, as three numbers that reconcile.
              Stated even on an old receipt, unlike the "your balance is now"
              sentence above: what a payment DID is permanent, whereas what the
              balance is now stops being about this payment within minutes.
              This is the auditable line. */}
          {settled && effect && effect.balance_after !== null && Number(effect.credits_added) > 0 ? (
            <dl className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-lg border border-line bg-raised/60 px-3 py-2 text-sm">
              <dt className="text-xs text-faint">Balance before</dt>
              <dd className="font-medium tabular-nums text-muted">
                {formatCredits(Number(effect.balance_before ?? 0))}
              </dd>
              <dd className="text-faint" aria-hidden>
                &rarr;
              </dd>
              <dt className="sr-only">Credits added</dt>
              <dd className="font-medium tabular-nums text-good-500">
                +{formatCredits(Number(effect.credits_added))}
              </dd>
              <dd className="text-faint" aria-hidden>
                =
              </dd>
              <dt className="text-xs text-faint">after</dt>
              <dd className="font-semibold tabular-nums text-ink">
                {formatCredits(Number(effect.balance_after))}
              </dd>
            </dl>
          ) : null}
        </div>

        {/* The receipt is a query parameter, and every date preset and column
            sort on this page carries it through - which is right while it is
            being read, and clutter once it has been. This is the way out. */}
        <Link
          href="/portal/payments"
          aria-label="Close this receipt"
          className="-mt-1 -mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-faint transition hover:bg-sunken hover:text-ink"
        >
          <X size={16} />
        </Link>
      </div>

      {/* Every figure a customer or a support agent would read back over the
          telephone, in the order they ask for them. */}
      <dl className="mt-3 border-t border-divider pt-1">
        {/* "Order amount" rather than "Paid" until it has settled. The figure
            is what Razorpay was asked for, and on a failed or unconfirmed row
            heading it "Paid" states the one thing that is not true. */}
        <DescRow label={settled ? "Paid" : "Order amount"}>
          <span className="font-semibold tabular-nums text-strong">
            {fmtRupees(row.amount_inr)}
          </span>
        </DescRow>

        {discount > 0 ? (
          <DescRow label="Price before the code">
            <span className="tabular-nums">{fmtRupees(listInr(row))}</span>
          </DescRow>
        ) : null}

        {discount > 0 ? (
          <DescRow label="Discount">
            <span className="tabular-nums text-good-500">
              − {fmtRupees(discount)}
              {row.coupon?.code ? (
                <span className="ml-1 text-xs text-muted">with {row.coupon.code}</span>
              ) : null}
            </span>
          </DescRow>
        ) : null}

        <DescRow label="Bought">{boughtLabel(row)}</DescRow>

        {/*
          payments.credits, and where that figure comes from.

          For a top-up it is what settle_payment() grants, so the two cannot
          disagree. For a PLAN it is the plan's included_credits as recorded
          when the order was opened, while settle_payment reads the plan row
          again at settlement - so an administrator who edits a plan's included
          credits in the seconds between the two would leave this quoting the
          old figure. Shown anyway, because the alternative is matching the
          ledger grant back by the order id inside its note text, and a receipt
          that silently says nothing about the credits is worse than one that is
          a few seconds stale. The balance line below is read live either way.
        */}
        {row.status !== "failed" && credits > 0 ? (
          <DescRow label="Credits">
            <span className="tabular-nums">
              {creditsLine(row)}
              {pending ? <span className="ml-1 text-xs text-muted">once confirmed</span> : null}
              {settled && row.kind === "plan" ? (
                <span className="ml-1 text-xs text-muted">included with the plan</span>
              ) : null}
            </span>
          </DescRow>
        ) : null}

        <DescRow label="Method">{methodLabel(row.method)}</DescRow>

        <DescRow label={settled ? "Paid at" : "Started"}>
          <span className="whitespace-nowrap">
            {fmtDateTime(settled ? (row.paid_at ?? row.created_at) : row.created_at)}
          </span>
        </DescRow>

        <DescRow label="Status">{STATUS_LABEL[row.status]}</DescRow>

        {/* Only while it is news. See `fresh`. */}
        {fresh ? (
          <DescRow label="Balance now">
            <span className="font-semibold tabular-nums text-brand-500">
              {formatCredits(overview.credits)} credits
            </span>
          </DescRow>
        ) : null}
      </dl>

      {references.length > 0 ? (
        <div className="mt-3">
          <CopyReference items={references} />
        </div>
      ) : (
        <p className="mt-3 text-xs leading-relaxed text-muted">
          Recorded by hand{row.note ? `: ${row.note}` : ""}. There is no gateway reference for this
          one.
        </p>
      )}

      {waiting ? <SettlementWatch supportEmail={supportEmail} /> : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {/* Where somebody who has just paid actually wants to go: a plan buys
            truck slots, credits buy searches. */}
        {fresh ? (
          row.kind === "plan" ? (
            <LinkButton href="/portal/trucks" variant="primary" size="sm">
              <Truck size={14} />
              Watch a truck
            </LinkButton>
          ) : (
            <LinkButton href="/portal/search" variant="primary" size="sm">
              <Search size={14} />
              Search a truck
            </LinkButton>
          )
        ) : null}

        <LinkButton href="/portal/plan" variant="secondary" size="sm">
          Plan and credits
        </LinkButton>

        <Link
          href="#list"
          className="inline-flex min-h-9 items-center rounded-lg px-2 text-xs font-medium text-brand-500 transition hover:bg-sunken"
        >
          Every payment
        </Link>
      </div>
    </section>
  );
}
