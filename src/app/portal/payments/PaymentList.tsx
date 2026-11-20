import Link from "next/link";
import { ChevronDown, ChevronRight } from "lucide-react";

import { CopyReference, type Reference } from "./CopyReference";
import {
  STATUS_TONE,
  boughtLabel,
  hasGatewayReference,
  isSettled,
  listInr,
  paymentCredits,
  type PaymentRow,
} from "./payments";
import { Badge, cx } from "@/components/ui";
import { methodLabel } from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtDayTime, fmtRupees } from "@/lib/format";
import type { PaymentStatus } from "@/lib/types";

/**
 * The payments list: one compact row per payment, the same at every width.
 *
 *   Level 1 (the row): what was bought, amount, status chip, date-time,
 *                      method, a short reference.
 *   Level 2 (tap):     every id with a copy button, method, started and paid
 *                      times, failure reason, credits granted, code/discount,
 *                      a link to the receipt.
 *   Level 3:           the receipt itself (?ref=, printable), unchanged.
 *
 * A <details> per row, so it opens without any JavaScript. A failed payment
 * has a thin red edge and a red chip; its amount is muted because nothing was
 * charged - visible, not loud.
 */

/** The chip text. "Pending" is a checkout that was started and never paid. */
export const CHIP_LABEL: Record<PaymentStatus, string> = {
  paid: "Paid",
  failed: "Failed",
  created: "Pending",
};

const STATE_CLASS: Record<PaymentStatus, string> = {
  paid: "is-paid",
  failed: "is-failed",
  created: "is-pending",
};

/** "Gold plan" / "500 credits" / "Gold plan + 1,000 credits". */
export function whatBought(row: PaymentRow): string {
  const { topup, total } = paymentCredits(row);
  if (row.kind === "plan") {
    const plan = `${row.plan?.name ?? "Plan"} plan`;
    return topup > 0 ? `${plan} + ${formatCredits(topup)} credits` : plan;
  }
  return total > 0 ? `${formatCredits(total)} credits` : boughtLabel(row);
}

/** The last six characters of the id support will ask for. */
function shortRef(row: PaymentRow): string | null {
  if (!hasGatewayReference(row)) return null;
  const id = row.razorpay_payment_id ?? row.razorpay_order_id;
  return id ? `#${id.slice(-6)}` : null;
}

export function PaymentList({
  rows,
  receiptHref,
}: {
  rows: PaymentRow[];
  receiptHref: (row: PaymentRow) => string;
}) {
  return (
    <ul className="hrow-list">
      {rows.map((row) => {
        const settled = isSettled(row);
        const at = row.paid_at ?? row.created_at;
        const ref = shortRef(row);
        return (
          <li key={row.id} className={cx("hrow", STATE_CLASS[row.status])}>
            <details>
              <summary className="hrow-head">
                <span className="hrow-text">
                  <span className="hrow-title">{whatBought(row)}</span>
                  <span className="hrow-sub">
                    <span>{fmtDayTime(at)}</span>
                    <span>{hasGatewayReference(row) ? "Online" : methodLabel(row.method)}</span>
                    {ref ? <span className="hrow-mono">{ref}</span> : null}
                  </span>
                </span>
                <span className="hrow-end">
                  <span className={cx("hrow-amount", !settled && "is-muted")}>{fmtRupees(row.amount_inr)}</span>
                  <Badge tone={STATUS_TONE[row.status]}>{CHIP_LABEL[row.status]}</Badge>
                </span>
                <ChevronDown size={16} aria-hidden className="hrow-chev" />
              </summary>

              <PaymentDetail row={row} receiptHref={receiptHref(row)} />
            </details>
          </li>
        );
      })}
    </ul>
  );
}

function PaymentDetail({ row, receiptHref }: { row: PaymentRow; receiptHref: string }) {
  const settled = isSettled(row);
  const discount = Number(row.discount_inr) || 0;
  const gateway = hasGatewayReference(row);

  const ids: Reference[] = [];
  if (gateway && row.razorpay_payment_id) ids.push({ label: "Payment ID", value: row.razorpay_payment_id });
  if (gateway) ids.push({ label: "Order ID", value: row.razorpay_order_id });

  return (
    <div className="hrow-body">
      <dl className="hrow-facts">
        <div>
          <dt>Bought</dt>
          <dd>{boughtLabel(row)}</dd>
        </div>
        {discount > 0 ? (
          <div>
            <dt>Price</dt>
            <dd>
              {fmtRupees(listInr(row))} − {fmtRupees(discount)}
              {row.coupon?.code ? <span className="hrow-note"> code {row.coupon.code}</span> : null}
            </dd>
          </div>
        ) : null}
        <div>
          <dt>{settled ? "Paid" : "Amount"}</dt>
          <dd>
            {fmtRupees(row.amount_inr)}
            {settled ? null : <span className="hrow-note"> not charged</span>}
          </dd>
        </div>
        <div>
          <dt>Credits added</dt>
          <dd>
            {creditsText(row)}
          </dd>
        </div>
        <div>
          <dt>Method</dt>
          <dd>{gateway ? "Razorpay (card, UPI or netbanking)" : methodLabel(row.method)}</dd>
        </div>
        <div>
          <dt>Started</dt>
          <dd>{fmtDateTime(row.created_at)}</dd>
        </div>
        {row.paid_at ? (
          <div>
            <dt>Completed</dt>
            <dd>{fmtDateTime(row.paid_at)}</dd>
          </div>
        ) : (
          <div>
            <dt>Status</dt>
            <dd className={row.status === "failed" ? "is-bad" : undefined}>
              {row.status === "failed" ? "Failed" : "Not completed"}
              <span className="hrow-note"> · nothing charged</span>
            </dd>
          </div>
        )}
        {row.failure_reason ? (
          <div>
            <dt>Reason</dt>
            <dd>{row.failure_reason}</dd>
          </div>
        ) : null}
        {!gateway ? (
          <div>
            <dt>Recorded</dt>
            <dd>By our team{row.note ? `: ${row.note}` : ""}</dd>
          </div>
        ) : null}
      </dl>

      {ids.length > 0 ? <CopyReference items={ids} /> : null}

      <Link href={receiptHref} className="hrow-link">
        View receipt
        <ChevronRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

/** "1,500 credits (500 with plan + 1,000 top-up)", or "None" when nothing landed. */
function creditsText(row: PaymentRow): string {
  if (!isSettled(row)) return "None";
  const { plan, topup, total } = paymentCredits(row);
  if (total <= 0) return "None";
  if (plan > 0 && topup > 0) {
    return `${formatCredits(total)} credits (${formatCredits(plan)} with plan + ${formatCredits(topup)} top-up)`;
  }
  return `${formatCredits(total)} credits`;
}
