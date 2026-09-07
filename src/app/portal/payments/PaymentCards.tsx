import Link from "next/link";
import { ChevronRight } from "lucide-react";

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
import { Badge, Mono, cx } from "@/components/ui";
import { methodLabel } from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtRelative, fmtRupees } from "@/lib/format";
import type { PaymentStatus } from "@/lib/types";

/**
 * One payment as a stacked card, for a phone.
 *
 * The table in columns.tsx is eight columns wide - date, status, what it
 * bought, method, price, paid, credits and two reference ids. It scrolls inside
 * its own container so it never took the page sideways with it, but on a 390px
 * screen that meant the reader saw a date and a badge and had to drag
 * horizontally, blind, to find the amount. Every column but the first was
 * effectively hidden, and the ones furthest right are the ones a support call
 * is about.
 *
 * So below md the same rows are drawn downwards instead: what it bought and
 * what it cost on the first line, the state and the moment on the second,
 * everything a support conversation asks for next in a two-up list, and the
 * gateway ids last. Nothing is summarised away and nothing is dropped - see the
 * check against columns.tsx below.
 *
 * EVERY FIGURE COMES FROM payments.ts, exactly as the table's does. That is the
 * whole reason this file holds no arithmetic: two renderings of one payment
 * that each decide for themselves what "paid" means is how a phone and a laptop
 * come to show a customer two different numbers, and this screen exists to end
 * that argument rather than to start it on a smaller screen.
 *
 * WHAT SURVIVES, against the columns it comes from:
 *
 *   payment id          the reference block, when the gateway has one
 *   order id            the reference block
 *   date and time       line two, with the relative age beside it
 *   status              line two, as the same Badge and tone as the table
 *   what was bought     line one
 *   method              the facts list
 *   amount paid         line one, right, as the one big figure
 *   discount            the facts list, with the code that took it off
 *   credits added       the facts list - one line each for the plan's
 *                       included credits and a top-up bought with it, then
 *                       their sum, exactly as the receipt words them
 *
 * The only thing left to the table is the sort, because a column heading is
 * what sorts and there are no headings here. Newest first is the default and is
 * what a phone is opened for; the date presets above still narrow the window.
 */

/**
 * The left edge, coloured by what became of the payment.
 *
 * The owner's actual complaint about the old summary was that an abandoned
 * checkout and a settled one looked alike. A badge fixes that for somebody
 * reading a row, but not for somebody thumbing down a list of twenty - so the
 * state is also on the card's edge, where it is legible without reading, and
 * settled rows get a quiet line rather than a green one so that the eye is
 * drawn to the exceptions rather than to the norm.
 */
const ACCENT: Record<PaymentStatus, string> = {
  paid: "border-l-line",
  created: "border-l-warn-500",
  failed: "border-l-bad-500",
};

type Fact = { label: string; value: React.ReactNode };

export function PaymentCards({
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

        const facts: Fact[] = [];

        /* Only when the big figure above is a dash. A settled row's paid
           amount is already the largest thing on the card, and repeating it
           here as "order amount" would read as a second charge. */
        if (!settled) {
          facts.push({ label: "Order amount", value: fmtRupees(row.amount_inr) });
        }

        /* Both halves of the arithmetic, and only when there is arithmetic to
           show: with no code, the list price and the amount paid are the same
           figure and a "Price" row under it explains nothing. */
        if (discount > 0) {
          facts.push({ label: "Price before the code", value: fmtRupees(listInr(row)) });
          facts.push({
            label: "Discount",
            value: (
              <span className="text-good-500">
                &minus; {fmtRupees(discount)}
                {/* Separated by a middot, as the table's discount cell is. A
                    4px margin alone put the code close enough to the figure to
                    read as part of it at 10px. */}
                {row.coupon?.code ? ` · ${row.coupon.code}` : ""}
              </span>
            ),
          });
        }

        /*
         * THE CREDITS, IN AS MANY LINES AS THE PAYMENT HAS KINDS OF THEM.
         *
         * One "Credits received" row read off row.credits until now, which on
         * a plan payment is the plan's included allowance only - so a phone
         * showed a customer who bought a plan with credits attached the
         * smaller half of what they had paid for. A combined payment gets
         * three rows, the last of them the sum, because a card is where the
         * arithmetic has to be visible: there is no column footer down here to
         * add it up. The labels are the receipt's own, from payments.ts.
         */
        if (settled) {
          for (const line of credits) {
            facts.push({
              label: line.label,
              value: (
                <span className={line.total ? "font-medium text-brand-500" : "text-brand-500"}>
                  {formatCredits(line.credits)}
                </span>
              ),
            });
          }
        } else {
          facts.push({
            label: CREDIT_LABEL.short,
            /* A dash, never a nought. Nothing was charged and nothing
               arrived, and a zero in this row reads as a payment that bought
               nothing. */
            value: <span className="text-faint">&mdash;</span>,
          });
        }

        facts.push({ label: "Method", value: methodLabel(row.method) });

        return (
          <li key={row.id} className={cx("border-l-2 px-4 py-3.5", ACCENT[row.status])}>
            {/* ------------- what it bought, and what it cost ------------- */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{boughtLabel(row)}</p>
                {/* A pack is named "Starter", which does not say what it was.
                    A plan row already reads "Base plan".

                    GUARDED ON THE PACK NAME, which the table's own version of
                    this is not. boughtLabel falls back to "Credit top-up" for a
                    pack that has since been deleted or an open-tier top-up that
                    never was one, so an unguarded gloss printed "Credit top-up"
                    and then "credit top-up" directly underneath it - which on a
                    card, where the two lines are touching, reads as a stutter
                    rather than as a gloss. */}
                {row.kind === "credits" && row.pack?.name ? (
                  <p className="text-[11px] text-faint">credit top-up</p>
                ) : null}
              </div>

              <div className="shrink-0 text-right">
                {settled ? (
                  <p className="text-base font-semibold tabular-nums text-strong">
                    {fmtRupees(row.amount_inr)}
                  </p>
                ) : (
                  <p className="text-base font-semibold text-faint">&mdash;</p>
                )}
                <p className="text-[10px] text-faint">{settled ? "paid" : "nothing paid"}</p>
              </div>
            </div>

            {/* ------------- the state, and the moment ------------- */}
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
              <span className="text-xs whitespace-nowrap text-muted">{fmtDateTime(at)}</span>
              <span className="text-[11px] whitespace-nowrap text-faint">{fmtRelative(at)}</span>
            </div>

            {note ? <p className="mt-1 text-[11px] leading-relaxed text-faint">{note}</p> : null}

            {/* ------------- everything asked for next ------------- */}
            <dl className="mt-2.5 border-t border-divider pt-2.5">
              {facts.map((fact) => (
                <div
                  key={fact.label}
                  className="flex items-baseline justify-between gap-3 py-0.5"
                >
                  <dt className="shrink-0 text-[11px] text-muted">{fact.label}</dt>
                  <dd className="min-w-0 text-right text-xs tabular-nums text-ink">
                    {fact.value}
                  </dd>
                </div>
              ))}
            </dl>

            {/* ------------- the ids a telephone call runs on ------------- */}
            <div className="mt-2.5 border-t border-divider pt-2.5">
              {hasGatewayReference(row) ? (
                <dl className="space-y-1">
                  <ReferenceLine label="Order id" value={row.razorpay_order_id} />
                  {row.razorpay_payment_id ? (
                    <ReferenceLine label="Payment id" value={row.razorpay_payment_id} />
                  ) : null}
                </dl>
              ) : (
                /* A receipt an administrator entered carries a synthetic order
                   id Razorpay has never heard of, so quoting it would send
                   somebody looking for a payment that does not exist. */
                <p className="text-[11px] leading-relaxed text-faint">
                  Recorded by hand{row.note ? `: ${row.note}` : ""}. There is no gateway reference
                  for this one.
                </p>
              )}

              {/*
                The ids above are select-all text rather than buttons, so a tap
                highlights one ready to copy without the row navigating out from
                under the finger - which is the whole reason this card is not
                itself a link. The receipt behind this link is where the copy
                buttons live, along with the balance before and after.
              */}
              <Link
                href={receiptHref(row)}
                className="-ml-1 mt-1.5 inline-flex min-h-9 items-center gap-1 rounded-lg px-1 text-xs font-medium text-brand-500 transition hover:bg-brand-500/8"
              >
                Full receipt
                <ChevronRight size={13} className="shrink-0" />
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One gateway id. select-all so a single tap highlights the whole thing on a
 * phone, break-all so a long one wraps rather than widening the card past the
 * viewport - a payment id that runs off the right-hand edge is one the reader
 * cannot finish reading and cannot scroll to.
 */
function ReferenceLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-20 shrink-0 text-[10px] font-semibold tracking-wider text-muted uppercase">
        {label}
      </dt>
      <dd className="min-w-0 flex-1">
        <Mono className="block break-all text-[11px] text-muted select-all">{value}</Mono>
      </dd>
    </div>
  );
}
