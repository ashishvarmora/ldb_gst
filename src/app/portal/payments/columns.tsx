import {
  PAYMENT_SORT,
  STATUS_LABEL,
  STATUS_NOTE,
  STATUS_TONE,
  boughtLabel,
  hasGatewayReference,
  isSettled,
  listInr,
  settledSum,
  type PaymentRow,
} from "./payments";
import type { Column } from "@/components/charts";
import { Badge, Mono } from "@/components/ui";
import { methodLabel } from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtRelative, fmtRupees } from "@/lib/format";

/**
 * How one payment is drawn, column by column.
 *
 * Kept out of the page for the same reason the admin console keeps its lists in
 * tables.tsx: this is the part that has to stay in step with the CSV in
 * payments.ts, and a table defined inline inside four hundred lines of page is
 * a table nobody notices has drifted.
 *
 * The sort comparators come from payments.ts so the shared sortRows() does the
 * ordering, and each column's `cell` and the CSV's cell for the same field can
 * be read side by side.
 *
 * Only Paid and Credits carry a footer total, and both count SETTLED rows only.
 * Price deliberately does not: it is quoted on every row including the ones
 * that charged nothing, so a settled-only footer beneath it would be a figure
 * that does not add up to the column above it.
 */
export const PAYMENT_COLUMNS: Column<PaymentRow>[] = [
  {
    key: "when",
    label: "Date and time",
    className: "whitespace-nowrap",
    sortBy: PAYMENT_SORT.when,
    cell: (row) => {
      const at = row.paid_at ?? row.created_at;
      return (
        <>
          <span className="block text-sm text-ink">{fmtDateTime(at)}</span>
          <span className="block text-xs text-faint">{fmtRelative(at)}</span>
        </>
      );
    },
  },
  {
    key: "status",
    label: "Status",
    sortBy: PAYMENT_SORT.status,
    cell: (row) => (
      <>
        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
        {/* Razorpay's own words when it refused, and otherwise the one thing
            somebody reading an unfinished row wants confirmed. */}
        {row.failure_reason ? (
          <span className="mt-0.5 block max-w-56 text-xs leading-relaxed text-faint">
            {row.failure_reason}
          </span>
        ) : STATUS_NOTE[row.status] ? (
          <span className="mt-0.5 block text-xs text-faint">{STATUS_NOTE[row.status]}</span>
        ) : null}
      </>
    ),
  },
  {
    key: "bought",
    label: "What you bought",
    sortBy: PAYMENT_SORT.bought,
    cell: (row) => (
      <>
        <span className="block text-sm whitespace-nowrap text-ink">{boughtLabel(row)}</span>
        {/* A pack is named "Starter", which does not say what it was. A plan row
            already reads "... plan · 3 months" and needs no second line. */}
        {row.kind === "credits" ? (
          <span className="block text-xs text-faint">credit top-up</span>
        ) : null}
      </>
    ),
  },
  {
    key: "method",
    label: "Method",
    className: "whitespace-nowrap",
    sortBy: PAYMENT_SORT.method,
    cell: (row) => <span className="text-sm text-ink">{methodLabel(row.method)}</span>,
  },
  {
    key: "price",
    label: "Price",
    align: "right",
    sortBy: PAYMENT_SORT.price,
    cell: (row) => {
      const discount = Number(row.discount_inr) || 0;
      return (
        <>
          <span className="block text-sm whitespace-nowrap text-ink">{fmtRupees(listInr(row))}</span>
          {discount > 0 ? (
            <span className="block text-xs whitespace-nowrap text-good-500">
              − {fmtRupees(discount)}
              {row.coupon?.code ? ` · ${row.coupon.code}` : ""}
            </span>
          ) : null}
        </>
      );
    },
  },
  {
    key: "paid",
    label: "Paid",
    align: "right",
    sortBy: PAYMENT_SORT.paid,
    /* A dash, not a rupee figure. Printing what an abandoned checkout WOULD
       have cost in the column headed "Paid" is the exact confusion this page
       exists to end. */
    cell: (row) =>
      isSettled(row) ? (
        <span className="text-sm font-medium whitespace-nowrap text-ink">
          {fmtRupees(row.amount_inr)}
        </span>
      ) : (
        <span className="text-sm text-faint">—</span>
      ),
    total: (rows) => fmtRupees(settledSum(rows, (row) => Number(row.amount_inr) || 0)),
  },
  {
    key: "credits",
    label: "Credits",
    align: "right",
    sortBy: PAYMENT_SORT.credits,
    cell: (row) =>
      isSettled(row) ? (
        <span className="text-sm text-brand-500">{formatCredits(row.credits)}</span>
      ) : (
        <span className="text-sm text-faint">—</span>
      ),
    total: (rows) => formatCredits(settledSum(rows, (row) => Number(row.credits) || 0)),
  },
  {
    key: "reference",
    label: "Reference",
    className: "whitespace-nowrap",
    /* Not sortable: nobody orders a list by an opaque id, and a header that
       does nothing useful still invites a click. select-all so one tap on a
       phone highlights a whole id ready to copy. */
    cell: (row) =>
      hasGatewayReference(row) ? (
        <>
          <Mono className="block text-xs text-muted select-all">{row.razorpay_order_id}</Mono>
          {row.razorpay_payment_id ? (
            <Mono className="block text-xs text-faint select-all">{row.razorpay_payment_id}</Mono>
          ) : null}
        </>
      ) : (
        <span className="text-xs text-faint">{row.note ?? "recorded by hand"}</span>
      ),
  },
];
