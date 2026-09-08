import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

import {
  CREDIT_LABEL,
  STATUS_LABEL,
  STATUS_NOTE,
  STATUS_TONE,
  boughtLabel,
  creditLines,
  hasGatewayReference,
  isSettled,
  listInr,
  type PaymentRow,
} from "./payments";
import { Badge, DescRow, Mono, cx } from "@/components/ui";
import { methodLabel } from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtRelative, fmtRupees } from "@/lib/format";
import type { PaymentStatus } from "@/lib/types";

/**
 * Every payment as a two-line row that opens, for a phone.
 *
 * WHAT THIS REPLACED, and why it had to go. Below md the same rows used to be
 * drawn as stacked cards with everything on them at once - the price before the
 * code, the discount and its coupon, both kinds of credit, the method, the
 * order id, the payment id and a link to the receipt - every field, on every
 * row, always. Measured at 390px that is 284px per payment: two rows to a
 * screen, none of them whole on the first screen, and a customer with a hundred
 * payments scrolling twenty-eight thousand pixels to find one. The owner's
 * complaint was exactly that, and it was not a complaint about the fields. It
 * was a complaint about a list that had no summary in it.
 *
 * So the fields are still all here, one tap away, and the row itself is now
 * only what somebody SCANNING for a payment reads:
 *
 *   what it bought   the identity of the row - "Base plan", "Starter"
 *   the date         the thing a customer half-remembers and searches by
 *   the amount       what they are actually looking for, in a tabular column
 *   the status       but only when it is not "Paid" - see below
 *
 * Nothing else earns a place. The method is "Razorpay" on all but a handful of
 * rows and answers no question anybody scans with; the relative age restates
 * the date beside it; the ids are twenty opaque characters that are useless
 * until you have already found the row. All three are in the fold, where they
 * are read once, deliberately, by somebody on the telephone to support.
 *
 * STATUS IS PRINTED BY EXCEPTION. Ninety rows in a hundred are settled, and a
 * green "Paid" badge on ninety rows is ninety units of noise with the ten that
 * matter hidden inside it - which is the same failure the old summary had, in a
 * new shape. A settled row says so by carrying a real rupee figure where the
 * unsettled ones carry a dash, and by leaving its edge quiet; an unfinished or
 * failed one gets the badge, the coloured edge, and the field to itself. The
 * word is still in the accessible name of every row (see the sr-only span), and
 * the fold spells the status out in full whatever it is, so nothing is lost to
 * a screen reader or to somebody reading one payment properly.
 *
 * EVERY FIGURE COMES FROM payments.ts, exactly as the table's does. That is the
 * whole reason this file holds no arithmetic: two renderings of one payment
 * that each decide for themselves what "paid" means is how a phone and a laptop
 * come to show a customer two different numbers, and this screen exists to end
 * that argument rather than to start it on a smaller screen.
 *
 * WHAT SURVIVES, against the columns in columns.tsx and the CSV in payments.ts:
 *
 *   what was bought     the row, line one
 *   amount paid         the row, line one, right - the tabular money column
 *   date                the row, line two
 *   status              the row, line two when it is not "Paid"; the fold always
 *   date AND time       the fold, with the relative age beside it
 *   order amount        the fold, on anything that did not settle
 *   price before code   the fold, when a code came off
 *   discount + coupon   the fold, when a code came off
 *   credits included    the fold - one line each for the plan's allowance and a
 *   top-up credits      top-up bought with it, then their sum, in the receipt's
 *   credits in total    own words
 *   method              the fold
 *   order id            the fold, when the gateway has one
 *   payment id          the fold, when the gateway has one
 *
 * The only thing left to the table is the sort, because a column heading is
 * what sorts and there are no headings here. Newest first is the default and is
 * what a phone is opened for; the date presets above still narrow the window.
 *
 * ONE TYPE SCALE, THREE SIZES: 14px for anything that is the answer, 12px for
 * anything that qualifies it, 11px for a label or a badge. The old cards ran
 * from 10px to 16px across five steps, and 10px on a phone is below the size at
 * which a figure can be read at arm's length at all.
 */

/**
 * A NATIVE <details>, not a controlled component.
 *
 * This page is server-rendered end to end and holds no client state. Making the
 * list interactive would mean a "use client" boundary with fifty payments'
 * worth of props serialised into the page and a hydration pass before the first
 * tap does anything - on the connection this is actually used on, that is the
 * one moment the reader is most likely to tap. A <summary> opens before any
 * JavaScript has arrived, comes with the button role and aria-expanded for
 * free, keeps its open rows open across a date-range navigation or a Server
 * Action refresh, and lets Chrome's find-in-page open a shut row to show a
 * match - which is precisely how somebody hunts for an order id in a hundred
 * rows.
 *
 * What that costs is a height animation and "only one open at a time". The
 * animation is not worth a client component per row. The accordion is not worth
 * having at all: the commonest reason to open a payment is a charge a customer
 * thinks they were billed for twice, and that reader needs both rows open side
 * by side. <details name="..."> would give the exclusive behaviour natively and
 * is deliberately not used for that reason.
 */

/**
 * The left edge, coloured by what became of the payment.
 *
 * The owner's actual complaint about the old summary was that an abandoned
 * checkout and a settled one looked alike. A badge fixes that for somebody
 * reading a row, but not for somebody thumbing down a list of fifty - so the
 * state is also on the row's edge, where it is legible without reading, and
 * settled rows get a quiet line rather than a green one so that the eye is
 * drawn to the exceptions rather than to the norm. The border is on the <li>,
 * which is what carries the open fold too, so an open payment's detail stays
 * visibly attached to the row it belongs to.
 */
const ACCENT: Record<PaymentStatus, string> = {
  paid: "border-l-line",
  created: "border-l-warn-500",
  failed: "border-l-bad-500",
};

export function PaymentList({
  rows,
  receiptHref,
}: {
  rows: PaymentRow[];
  /** Where "Full receipt" goes - the page owns the query string. */
  receiptHref: (row: PaymentRow) => string;
}) {
  return (
    <ul className="divide-y divide-divider md:hidden">
      {rows.map((row) => {
        const settled = isSettled(row);
        const discount = Number(row.discount_inr) || 0;
        /* Both kinds of credit this payment granted, already worded - see
           creditLines. One line for a plain purchase, three for a combined one. */
        const credits = creditLines(row);
        /* The same instant the table's first column reads, and for the same
           reason: an unsettled row has no paid_at, and the moment somebody
           opened the payment window is the only date it has. */
        const at = row.paid_at ?? row.created_at;
        /* Razorpay's own words when it refused, else the one line the two
           unsettled states need. Identical to the table's status cell. */
        const note = row.failure_reason ?? STATUS_NOTE[row.status];
        /*
         * A pack is named "Starter", which does not say what it was, and a plan
         * row already reads "Base plan". Inline rather than on a second line:
         * the row has two lines and both are spoken for, and a gloss under a
         * title is what made the old card three lines tall before it had said
         * anything. Guarded on the pack name, because boughtLabel falls back to
         * "Credit top-up" for a pack that has since been deleted or an
         * open-tier top-up that never was one - and "Credit top-up credit
         * top-up" is a stutter, not a gloss.
         */
        const gloss = row.kind === "credits" && row.pack?.name ? "credit top-up" : null;

        return (
          <li key={row.id} className={cx("border-l-2", ACCENT[row.status])}>
            <details className="group">
              {/* ---------------- the row, shut ---------------- */}
              <summary
                className={cx(
                  "flex cursor-pointer list-none items-center gap-3 px-4 py-3",
                  "transition hover:bg-raised/70 [&::-webkit-details-marker]:hidden",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">
                    {boughtLabel(row)}
                    {gloss ? <span className="ml-1.5 text-xs text-faint">{gloss}</span> : null}
                  </span>

                  <span className="mt-0.5 flex items-center gap-2">
                    <span className="text-xs whitespace-nowrap text-muted">{fmtDate(at)}</span>
                    {settled ? (
                      /* The badge is printed by exception, so the word has to
                         be given back to a screen reader, which cannot see a
                         2px border on the left edge of a list item. */
                      <span className="sr-only">{STATUS_LABEL.paid}</span>
                    ) : (
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    )}
                  </span>
                </span>

                {/*
                  The money column. shrink-0 against a flex-1 title and a fixed
                  chevron, so every row's figure ends at the same x and
                  tabular-nums lines the digits up under each other - which is
                  what makes a column of amounts scannable rather than merely
                  present. A dash, never a nought and never the order amount:
                  printing what an abandoned checkout WOULD have cost in the
                  place the eye reads as "paid" is the exact confusion this page
                  exists to end.
                */}
                <span
                  className={cx(
                    "shrink-0 text-sm font-semibold tabular-nums",
                    settled ? "text-strong" : "text-faint",
                  )}
                >
                  {settled ? fmtRupees(row.amount_inr) : "—"}
                </span>

                <ChevronDown
                  size={16}
                  aria-hidden
                  className="shrink-0 text-faint transition group-open:rotate-180"
                />
              </summary>

              {/* ---------------- everything else, open ---------------- */}
              {/*
                DescRow, the same component and the same labels the receipt
                panel uses. An open row IS a receipt for one payment, and a
                phone that words the grant one way while the receipt above it
                words it another is the thing a customer forwards to an
                accountant. The ids sit in here rather than in the <summary>
                for a reason that is not layout - see ReferenceValue.
              */}
              <div className="border-t border-divider bg-raised/60 px-4 py-2">
                <dl>
                  {/*
                    THE ARITHMETIC, and only when there is arithmetic.

                    With a code, three lines: the list price, what came off, and
                    the result - a subtraction with no total under it leaves the
                    reader to do it, and the figure in the row above is small
                    print by then. With no code the list price and the amount
                    paid are the same number the row already shows, so the only
                    thing left worth saying is what an unsettled checkout was
                    FOR: that figure appears nowhere else on the screen, and it
                    is headed "Order amount" rather than "Paid" because on a row
                    that charged nothing "Paid" states the one thing that is not
                    true.
                  */}
                  {discount > 0 ? (
                    <>
                      <DescRow label="Price before the code">
                        <span className="tabular-nums">{fmtRupees(listInr(row))}</span>
                      </DescRow>
                      <DescRow label="Discount">
                        <span className="tabular-nums text-good-500">
                          &minus; {fmtRupees(discount)}
                          {row.coupon?.code ? (
                            <span className="ml-1 text-xs text-muted">with {row.coupon.code}</span>
                          ) : null}
                        </span>
                      </DescRow>
                    </>
                  ) : null}

                  {discount > 0 || !settled ? (
                    <DescRow label={settled ? "Paid" : "Order amount"}>
                      <span className="font-medium tabular-nums text-strong">
                        {fmtRupees(row.amount_inr)}
                      </span>
                    </DescRow>
                  ) : null}

                  {/*
                    WHAT IT GRANTED, IN AS MANY LINES AS IT HAS KINDS OF CREDIT.

                    A single "Credits received" row off row.credits is what this
                    used to be, and on a plan payment that column is the plan's
                    included allowance only - so a phone showed a customer who
                    bought a plan with credits attached the smaller half of what
                    they had paid for. A combined payment gets three lines, the
                    last of them the sum, because there is no column footer down
                    here to add it up. A dash, never a nought, on anything
                    unsettled: nothing arrived, and a zero in a credit column
                    reads as a grant of nothing. The unit is left off the figure
                    rather than printed as "500 credits": all three labels
                    already say the word, and this list has no room to say it
                    twice on one line.
                  */}
                  {settled ? (
                    credits.map((line) => (
                      <DescRow key={line.label} label={line.label}>
                        <span
                          className={cx(
                            "tabular-nums",
                            line.total ? "font-medium text-brand-500" : "text-brand-500",
                          )}
                        >
                          {formatCredits(line.credits)}
                        </span>
                      </DescRow>
                    ))
                  ) : (
                    <DescRow label={CREDIT_LABEL.short}>
                      <span className="text-faint">&mdash;</span>
                    </DescRow>
                  )}

                  <DescRow label="Method">{methodLabel(row.method)}</DescRow>

                  {/* The exact instant, which the shut row deliberately rounds
                      to a date, and the relative age beside it - the pair is
                      worth its line here and worth neither of its lines up
                      there. */}
                  <DescRow label={settled ? "Paid at" : "Started"}>
                    <span className="whitespace-nowrap">
                      {fmtDateTime(at)}
                      <span className="ml-1.5 text-xs text-faint">{fmtRelative(at)}</span>
                    </span>
                  </DescRow>

                  {/* Spelled out whatever it is, including the "Paid" the shut
                      row leaves off, with Razorpay's own refusal or the one
                      line the two unsettled states need underneath. */}
                  <DescRow label="Status">
                    {STATUS_LABEL[row.status]}
                    {note ? (
                      <span className="mt-0.5 block text-xs leading-relaxed text-faint">
                        {note}
                      </span>
                    ) : null}
                  </DescRow>

                  {/* ------- the ids a telephone call runs on ------- */}
                  {hasGatewayReference(row) ? (
                    <>
                      <DescRow label="Order id">
                        <ReferenceValue value={row.razorpay_order_id} />
                      </DescRow>
                      {row.razorpay_payment_id ? (
                        <DescRow label="Payment id">
                          <ReferenceValue value={row.razorpay_payment_id} />
                        </DescRow>
                      ) : null}
                    </>
                  ) : null}
                </dl>

                {/* A receipt an administrator entered carries a synthetic order
                    id Razorpay has never heard of, so quoting it would send
                    somebody looking for a payment that does not exist. Outside
                    the <dl> because it is a sentence, not a field. */}
                {hasGatewayReference(row) ? null : (
                  <p className="mt-2 text-xs leading-relaxed text-faint">
                    Recorded by hand{row.note ? `: ${row.note}` : ""}. There is no gateway
                    reference for this one.
                  </p>
                )}

                {/* The receipt is where the copy buttons live, along with the
                    balance before and after this payment - which is the one
                    thing the fold above cannot show, because it is read from
                    the ledger rather than from the payment. */}
                <Link
                  href={receiptHref(row)}
                  className="-ml-1 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-xs font-medium text-brand-500 transition hover:bg-brand-500/8"
                >
                  Full receipt
                  <ChevronRight size={13} className="shrink-0" />
                </Link>
              </div>
            </details>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One gateway id, as text a tap can select.
 *
 * THE REASON THE ROW IS NOT A LINK OR A BUTTON, and the reason these two lines
 * are in the fold rather than in the <summary>. An id is what a customer pastes
 * into a support message, and a tap has to highlight it rather than fire the
 * thing it is sitting inside - which a <summary>'s descendants cannot do,
 * because every tap in a summary toggles the row. The fold is ordinary flow
 * content, so select-all behaves here exactly as it does on the receipt: one
 * tap takes the whole id, no long-press, no dragging over twenty characters of
 * mono at 13px.
 *
 * break-all rather than leaning on DescRow's own break-words: both keep an
 * unspaced token inside the panel, but break-words only breaks it once it has
 * failed to fit a line of its own, which leaves an id split as nineteen
 * characters and then one. An id whose tail is a single character on its own
 * line is one a reader checks twice against the one they were quoted.
 */
function ReferenceValue({ value }: { value: string }) {
  return <Mono className="block break-all text-xs text-muted select-all">{value}</Mono>;
}
