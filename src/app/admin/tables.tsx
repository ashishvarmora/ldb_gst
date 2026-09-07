import Link from "next/link";
import { MapPin } from "lucide-react";

import type { AdminQuery } from "./pager";
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
import { formatCredits } from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, fmtRupees } from "@/lib/format";
import { autoPauseCountdown, pauseCopyFor } from "@/lib/pause";
import type { Payment, PaymentStatus, TruckDirectoryRow, TruckStatus } from "@/lib/types";

/**
 * The lists this console shows in more than one place, owned once.
 *
 * Payments and trucks each answer a question at two scales - "across everyone"
 * on a global page, and "for this customer" on their own page - and each had
 * grown a second near-copy with its own columns, its own wording and its own
 * idea of what to filter on. One of those copies is always the stale one.
 *
 * So each table lives here and takes the account column as a flag: a global
 * list names the customer and links through, an account's own page does not
 * repeat a name that is already in the page title. The words a truck list
 * filters and sorts by live here too, for the same reason - two screens
 * offering different options for the same underlying column is the drift
 * starting again.
 *
 * There was a third list, of upstream calls. LogExplorer replaced it, and
 * nothing rendered it after that, so it has gone.
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

/**
 * What one payment did to the balance: before, and after.
 *
 * Nothing at all when no ledger row was written against the payment, and that
 * emptiness is the useful signal - a settled payment with no movement is a
 * genuine problem, and a dash says so more clearly than a zero would.
 */
function BalanceCell({
  effect,
}: {
  effect?: { credits_added: number; balance_before: number | null; balance_after: number | null };
}) {
  const added = Number(effect?.credits_added ?? 0);

  if (!effect || added === 0 || effect.balance_after === null) {
    return (
      <td className="td text-right text-xs text-faint">
        <span title="No credit movement is recorded against this payment.">&mdash;</span>
      </td>
    );
  }

  return (
    <td className="td text-right text-sm whitespace-nowrap tabular-nums">
      <span className="text-muted">{formatCredits(Number(effect.balance_before ?? 0))}</span>
      <span className="mx-1 text-faint" aria-hidden>
        &rarr;
      </span>
      <span className="font-medium text-ink">{formatCredits(Number(effect.balance_after))}</span>
      <span className="mt-0.5 block text-xs font-normal text-good-500">
        +{formatCredits(added)}
      </span>
    </td>
  );
}

export function PaymentsTable({
  rows,
  nameOf,
  planName,
  packName,
  emptyTitle,
  emptyDescription,
  effectOf,
}: {
  rows: Payment[];
  /** Given, the table names the customer on every row and links to them. */
  nameOf?: NameLookup;
  planName?: ReadonlyMap<string, string>;
  packName?: ReadonlyMap<string, string>;
  emptyTitle: string;
  emptyDescription?: string;
  /**
   * What each payment did to the balance, keyed by payment id, from
   * payment_credit_effect.
   *
   * The support question this answers is "they say the credits never arrived" -
   * and "Credits: 10" beside the payment does not answer it, because that
   * column is what the payment was FOR, copied off the order at checkout. It
   * says nothing about whether a ledger row was ever written. The balance
   * either side is the proof, and its absence is the proof of the opposite.
   */
  effectOf?: ReadonlyMap<
    string,
    { credits_added: number; balance_before: number | null; balance_after: number | null }
  >;
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
        {effectOf ? <th className="th text-right whitespace-nowrap">Balance</th> : null}
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
              {effectOf ? <BalanceCell effect={effectOf.get(row.id)} /> : null}
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
/* Trucks                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * How the lorry is MOVING, worked out from its last crossing.
 *
 * Deliberately not the same question as whether it is being checked at all: a
 * paused truck reports "unknown" for ever, so a movement filter could never
 * answer "which of these are switched off". That is TRUCK_TRACKING below.
 */
export const TRUCK_STATUS_LABEL: Record<TruckStatus, string> = {
  moving: "Moving",
  idle: "Idle",
  no_activity: "No activity",
  unknown: "Never seen",
};

export const TRUCK_STATUS_TONE: Record<TruckStatus, BadgeTone> = {
  moving: "good",
  idle: "warn",
  no_activity: "bad",
  unknown: "neutral",
};

/**
 * Whether the platform is checking this truck at all, which is the question
 * that comes first: everything below it is meaningless for a lorry nothing
 * looks at. A truck with no alert switched on is never checked either - it
 * costs nothing and never moves - so it belongs in this list rather than
 * alongside the movement states, where it used to sit.
 */
export const TRUCK_TRACKING_LABEL = {
  live: "Live only",
  paused: "Paused only",
  unwatched: "No alert switched on",
} as const;

export type TruckTracking = keyof typeof TRUCK_TRACKING_LABEL;

/**
 * The orders that answer a real question about a fleet: what moved last, what
 * has gone quiet, what nobody is watching, and what was added when.
 */
export const TRUCK_SORTS = {
  event: { label: "Last crossing", column: "last_event_at", ascending: false },
  added: { label: "Recently added", column: "created_at", ascending: false },
  number: { label: "Truck number", column: "truck_number", ascending: true },
  alerts: { label: "Fewest alerts", column: "alert_count", ascending: true },
  events: { label: "Most crossings", column: "event_count", ascending: false },
} as const;

export type TruckSort = keyof typeof TRUCK_SORTS;

export function isTruckStatus(value: string | undefined | null): value is TruckStatus {
  return value !== undefined && value !== null && value in TRUCK_STATUS_LABEL;
}

export function isTruckTracking(value: string | undefined | null): value is TruckTracking {
  return value !== undefined && value !== null && value in TRUCK_TRACKING_LABEL;
}

export function isTruckSort(value: string | undefined | null): value is TruckSort {
  return value !== undefined && value !== null && value in TRUCK_SORTS;
}

export type TruckFilters = {
  /** One account's trucks. Absent means every account's. */
  officerId?: string;
  /** Registration number, already normalised to letters and digits. */
  plate?: string;
  status?: TruckStatus | "";
  tracking?: TruckTracking | "";
};

/**
 * The filters, applied to every read a truck list makes.
 *
 * Both screens count before they page - see pageWindow - and the count and the
 * rows have to see exactly the same filters. Writing the chain out twice per
 * screen, four times in all, is how the two lists drifted apart in the first
 * place.
 */
export function narrowTrucks(query: AdminQuery, filters: TruckFilters): AdminQuery {
  let narrowed = query;

  if (filters.officerId) narrowed = narrowed.eq("officer_id", filters.officerId);
  if (filters.plate) narrowed = narrowed.ilike("truck_number", `%${filters.plate}%`);
  if (filters.status) narrowed = narrowed.eq("status", filters.status);
  if (filters.tracking === "live") narrowed = narrowed.eq("is_active", true);
  else if (filters.tracking === "paused") narrowed = narrowed.eq("is_active", false);
  else if (filters.tracking === "unwatched") narrowed = narrowed.eq("alert_count", 0);

  return narrowed;
}

/**
 * One truck under tracking, at either scale.
 *
 * The account columns appear only on the global list, where naming the customer
 * is the point; an account's own page has that name in its title already and
 * shows what the lorry has cost instead, which is the figure only that page can
 * work out.
 */
export function TrucksTable({
  rows,
  showAccount = false,
  watchers,
  spentByTruck,
}: {
  rows: TruckDirectoryRow[];
  /** True, and the table names the account watching each truck and its posting. */
  showAccount?: boolean;
  /** Truck number -> how many accounts watch it. Over one is worth flagging. */
  watchers?: ReadonlyMap<string, number>;
  /** Truck number -> credits it has cost, across the whole ledger. */
  spentByTruck?: ReadonlyMap<string, number>;
}) {
  return (
    <TableWrap>
      <Thead>
        <th className="th">Truck</th>
        {showAccount ? <th className="th">Account</th> : null}
        {showAccount ? <th className="th">Posting</th> : null}
        <th className="th">Status</th>
        <th className="th">Last toll plaza</th>
        {spentByTruck ? <th className="th text-right">Credits used</th> : null}
        <th className="th text-right">Alerts</th>
        <th className="th text-right">Crossings</th>
        <th className="th">Last check</th>
        <th className="th">Added</th>
      </Thead>
      <Tbody>
        {rows.map((truck) => (
          <Tr key={truck.tracked_truck_id}>
            <td className="td">
              <span className="flex flex-wrap items-center gap-1.5">
                <Link
                  href={`/admin/explore?q=${truck.truck_number}`}
                  className="transition hover:text-brand-500"
                >
                  <Mono className="font-semibold text-ink">{truck.truck_number}</Mono>
                </Link>
                {(watchers?.get(truck.truck_number) ?? 0) > 1 ? (
                  <Badge tone="warn">also watched elsewhere</Badge>
                ) : null}
              </span>
              {truck.label ? (
                <span className="block text-xs text-faint">{truck.label}</span>
              ) : null}
            </td>

            {showAccount ? (
              <td className="td">
                <Link
                  href={`/admin/officers/${truck.officer_id}`}
                  className="block text-sm text-ink transition hover:text-brand-400"
                >
                  {truck.officer_name ?? truck.officer_email}
                </Link>
                <span className="block truncate text-xs text-faint">
                  {truck.officer_phone ?? truck.officer_email}
                </span>
              </td>
            ) : null}

            {showAccount ? (
              <td className="td">
                <span className="block text-sm text-ink">{truck.office ?? "--"}</span>
                <span className="block text-xs text-faint">
                  {[truck.district, truck.state].filter(Boolean).join(", ") || "--"}
                </span>
              </td>
            ) : null}

            {/* Paused wins over the movement status rather than sitting beside
                it. A truck nothing checks keeps whatever it last reported, so
                showing "Idle" for it would be reporting a stale reading as
                current.

                And it says WHICH stop fired. This was a bare "paused", which
                is the whole of what an administrator could see while the
                customer's own screen explained it in a paragraph - so the one
                person taking the "why has my lorry stopped?" call was the one
                person with no answer. The wording is the same table the portal
                reads, so the two cannot drift. */}
            <td className="td">
              {truck.is_active ? (
                <>
                  <Badge tone={TRUCK_STATUS_TONE[truck.status]}>
                    {TRUCK_STATUS_LABEL[truck.status]}
                  </Badge>
                  {/* A truck still running with a stop time coming. Worth
                      seeing here, because "it is about to go quiet" is the
                      call this prevents rather than answers. */}
                  {autoPauseCountdown(truck) ? (
                    <span className="mt-0.5 block text-[11px] whitespace-nowrap text-faint">
                      stops {autoPauseCountdown(truck)}
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <Badge tone={pauseCopyFor(truck)?.tone ?? "neutral"}>
                    {pauseCopyFor(truck)?.badge ?? "paused"}
                  </Badge>
                  {truck.paused_at ? (
                    <span className="mt-0.5 block text-[11px] whitespace-nowrap text-faint">
                      {fmtRelative(truck.paused_at)}
                    </span>
                  ) : null}
                </>
              )}
            </td>

            <td className="td">
              {truck.last_location ? (
                <span className="flex items-center gap-1.5 text-sm text-ink">
                  <MapPin size={13} className="shrink-0 text-faint" />
                  {truck.last_location}
                </span>
              ) : (
                <span className="text-sm text-faint">--</span>
              )}
              <span className="block text-xs whitespace-nowrap text-faint">
                {fmtDateTime(truck.last_event_at)}
              </span>
            </td>

            {spentByTruck ? (
              <td className="td text-right text-sm tabular-nums text-ink">
                {spentByTruck.get(truck.truck_number) ? (
                  formatCredits(spentByTruck.get(truck.truck_number)!)
                ) : (
                  <span className="text-faint">0</span>
                )}
              </td>
            ) : null}

            <td className="td text-right whitespace-nowrap">
              {truck.alert_count === 0 ? (
                <Badge tone="warn">never checked</Badge>
              ) : (
                <span className="text-sm tabular-nums text-ink">{truck.alert_count}</span>
              )}
            </td>

            <td className="td text-right text-sm tabular-nums text-muted">
              {fmtNumber(truck.event_count)}
            </td>

            <td className="td text-xs whitespace-nowrap text-muted">
              {fmtRelative(truck.last_polled_at)}
            </td>

            <td className="td text-xs whitespace-nowrap text-muted">
              {fmtDate(truck.created_at)}
            </td>
          </Tr>
        ))}
      </Tbody>
    </TableWrap>
  );
}
