import Link from "next/link";

import {
  Badge,
  EmptyState,
  Mono,
  TableWrap,
  Tbody,
  Thead,
  Tr,
  type BadgeTone,
} from "@/components/ui";
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, fmtRupees } from "@/lib/format";
import type { Payment, PaymentStatus, SearchLog } from "@/lib/types";

/**
 * The three lists this console shows in more than one place, owned once.
 *
 * Payments, credit movements and upstream calls each answer a question at two
 * scales - "across everyone" on a global page, and "for this customer" on their
 * own page - and each had grown a second near-copy with its own columns, its own
 * status wording and its own idea of what to do with a discount. One of those
 * copies is always the stale one.
 *
 * So each table lives here and takes the account column as a flag: a global
 * list names the customer and links through, an account's own page does not
 * repeat a name that is already in the page title.
 */

/** Below this a balance is worth chasing before the customer stops mid-job. */
export const LOW_BALANCE = 20;

/** One rule for colouring a balance, so the same number is never two colours. */
export function balanceTone(credits: number | null | undefined): BadgeTone {
  const value = Number(credits ?? 0);
  if (value <= 0) return "bad";
  if (value < LOW_BALANCE) return "warn";
  return "good";
}

export const PAYMENT_TONE: Record<PaymentStatus, BadgeTone> = {
  paid: "good",
  created: "warn",
  failed: "bad",
};

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  paid: "Paid",
  created: "Started, not paid",
  failed: "Failed",
};

export function isPaymentStatus(value: string | undefined): value is PaymentStatus {
  return value === "paid" || value === "created" || value === "failed";
}

/** id -> what to call the account. Absent means no Customer column at all. */
export type NameLookup = ReadonlyMap<string, string>;

function AccountCell({ id, nameOf }: { id: string; nameOf: NameLookup }) {
  return (
    <td className="td text-sm">
      <Link href={`/admin/officers/${id}`} className="transition hover:text-brand-400">
        {nameOf.get(id) ?? "--"}
      </Link>
    </td>
  );
}

/** The two lines every log row starts with: how long ago, and exactly when. */
function WhenCell({ at, exact }: { at: string; exact?: string }) {
  return (
    <td className="td whitespace-nowrap">
      <span className="block text-sm text-ink">{fmtRelative(at)}</span>
      <span className="block text-xs text-faint">{exact ?? fmtDateTime(at)}</span>
    </td>
  );
}

/* -------------------------------------------------------------------------- */
/* Payments                                                                    */
/* -------------------------------------------------------------------------- */

export function PaymentsTable({
  rows,
  nameOf,
  planName,
  packName,
  emptyTitle,
  emptyDescription,
}: {
  rows: Payment[];
  /** Given, the table names the customer on every row and links to them. */
  nameOf?: NameLookup;
  planName?: ReadonlyMap<string, string>;
  packName?: ReadonlyMap<string, string>;
  emptyTitle: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <TableWrap>
      <Thead>
        <th className="th">When</th>
        {nameOf ? <th className="th">Customer</th> : null}
        <th className="th">Bought</th>
        <th className="th text-right">Amount</th>
        <th className="th text-right">Credits</th>
        <th className="th">Status</th>
        <th className="th">Order</th>
      </Thead>
      <Tbody>
        {rows.map((row) => {
          // amount_inr is what was actually charged. A discounted payment shown
          // without its discount reads as a smaller purchase than it was, so the
          // list price and the money given away are named underneath it.
          const discount = Number(row.discount_inr ?? 0);
          const charged = Number(row.amount_inr);

          return (
            <Tr key={row.id}>
              <WhenCell at={row.created_at} />
              {nameOf ? <AccountCell id={row.user_id} nameOf={nameOf} /> : null}
              <td className="td text-sm">
                {row.kind === "plan" ? (
                  <>
                    <Badge tone="brand">plan</Badge>
                    {/* "removed" only when a lookup was actually possible and
                        missed - a caller that passes no map is not evidence the
                        plan is gone. */}
                    <span className="mt-0.5 block text-xs text-muted">
                      {planName
                        ? ((row.plan_id ? planName.get(row.plan_id) : null) ?? "removed")
                        : null}
                      {row.months > 1 ? ` · ${row.months} months` : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <Badge>pack</Badge>
                    {packName ? (
                      <span className="mt-0.5 block text-xs text-muted">
                        {(row.pack_id ? packName.get(row.pack_id) : null) ?? "removed"}
                      </span>
                    ) : null}
                  </>
                )}
              </td>
              <td className="td text-right text-sm font-medium tabular-nums text-ink">
                {fmtRupees(charged)}
                {discount > 0 ? (
                  <span className="mt-0.5 block text-xs font-normal text-faint">
                    {fmtRupees(charged + discount)} before {fmtRupees(discount)} off
                  </span>
                ) : null}
              </td>
              <td className="td text-right text-sm tabular-nums text-muted">
                {formatCredits(row.credits)}
              </td>
              <td className="td">
                <Badge tone={PAYMENT_TONE[row.status]}>{PAYMENT_LABEL[row.status]}</Badge>
                {row.failure_reason ? (
                  <span className="mt-0.5 block max-w-48 truncate text-xs text-faint">
                    {row.failure_reason}
                  </span>
                ) : null}
              </td>
              <td className="td">
                <Mono className="text-xs text-faint">{row.razorpay_order_id}</Mono>
              </td>
            </Tr>
          );
        })}
      </Tbody>
    </TableWrap>
  );
}

/* -------------------------------------------------------------------------- */
/* Credit movements                                                            */
/* -------------------------------------------------------------------------- */


/* -------------------------------------------------------------------------- */
/* Upstream calls                                                              */
/* -------------------------------------------------------------------------- */

/** The global log joins the account in so a row can name itself. */
export type SearchLogRow = SearchLog & {
  profiles?: { full_name: string | null; email: string } | null;
};

export function SearchLogTable({
  rows,
  showAccount = false,
  emptyTitle,
  emptyDescription,
}: {
  rows: SearchLogRow[];
  showAccount?: boolean;
  emptyTitle: string;
  emptyDescription?: string;
}) {
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <TableWrap>
      <Thead>
        <th className="th">When</th>
        {showAccount ? <th className="th">Customer</th> : null}
        <th className="th">Truck</th>
        <th className="th">Kind</th>
        <th className="th">Result</th>
        <th className="th text-right">Latency</th>
      </Thead>
      <Tbody>
        {rows.map((row) => (
          <Tr key={row.id}>
            <WhenCell at={row.created_at} />
            {showAccount ? (
              <td className="td text-sm">
                <Link
                  href={`/admin/officers/${row.user_id}`}
                  className="transition hover:text-brand-400"
                >
                  {row.profiles?.full_name ?? row.profiles?.email ?? "--"}
                </Link>
              </td>
            ) : null}
            <td className="td">
              <Link href={`/admin/explore?q=${row.truck_number}`} className="hover:text-brand-500">
                <Mono className="text-ink">{row.truck_number}</Mono>
              </Link>
            </td>
            <td className="td">
              <Badge tone={row.source === "manual" ? "brand" : "neutral"}>
                {row.source === "manual" ? "manual" : "automatic"}
              </Badge>
            </td>
            <td className="td">
              {row.ok ? (
                <span className="text-sm text-ink">
                  {fmtNumber(row.new_events)} new / {fmtNumber(row.events_found)} found
                </span>
              ) : (
                <Badge tone="bad">
                  {row.http_status ? `HTTP ${row.http_status}` : "error"}
                  {row.error ? ` · ${row.error.slice(0, 40)}` : ""}
                </Badge>
              )}
            </td>
            <td className="td text-right text-sm tabular-nums text-muted">
              {row.response_ms ? `${fmtNumber(row.response_ms)} ms` : "--"}
            </td>
          </Tr>
        ))}
      </Tbody>
    </TableWrap>
  );
}
