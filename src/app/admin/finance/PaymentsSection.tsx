import Link from "next/link";
import { AlertTriangle, Filter } from "lucide-react";

import type { FinanceParams } from "./page";
import { RecheckPayment } from "./RecheckPayment";
import { pageWindow, type AdminQuery } from "../pager";
import { PAYMENT_LABEL, PAYMENT_TONE, isPaymentStatus, type NameLookup } from "../tables";
import { Select } from "@/components/form";
import { FilterSubmitButton } from "@/components/NavPending";
import { Pager } from "@/components/Pager";
import {
  Badge,
  EmptyState,
  Mono,
  Panel,
  TableWrap,
  Tbody,
  Thead,
  Tr,
} from "@/components/ui";
import {
  PAYMENT_METHODS,
  methodLabel,
  rangeParams,
  type DateRange,
} from "@/lib/analytics";
import { formatCredits } from "@/lib/credits";
import { fmtDateTime, fmtNumber, fmtRelative, fmtRupees } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditPack, Payment, Plan } from "@/lib/types";

/**
 * The itemised record, filterable three ways.
 *
 * Paged in the database rather than scanned into memory. The tab this replaces
 * pulled two thousand payments over PostgREST and filtered them in JavaScript,
 * which is fine at today's volumes and quietly wrong at ten times them - and
 * "quietly" is the problem: a capped list looks like a complete one.
 *
 * Filtering by method is the new column pulling its weight: "show me every
 * cash payment last quarter" was previously a question with no answer at all.
 */
const PER_PAGE = 25;

type PaymentRow = Payment & {
  profiles: { full_name: string | null; email: string } | null;
};

export async function PaymentsSection({
  params,
  range,
}: {
  params: FinanceParams;
  range: DateRange;
}) {
  const admin = getSupabaseAdmin();

  const status = isPaymentStatus(params.status) ? params.status : undefined;
  const method = PAYMENT_METHODS.some((m) => m.key === params.method) ? params.method : undefined;
  const kind = params.kind === "plan" || params.kind === "credits" ? params.kind : undefined;

  /*
   * The filters, written once and applied to both reads.
   *
   * The count has to be taken before the range, so the page number can be
   * clamped against a real row total - a range starting past the last row comes
   * back as 416 with a null count, which reads as an empty list and hides the
   * link back. Counting means running the same filters twice, and two copies of
   * a filter chain is two chances to narrow one and forget the other, so both
   * reads go through here.
   *
   * The window is on created_at rather than paid_at so a payment that was
   * started inside the range but never completed still shows up. That is the
   * whole point of being able to filter to "started, not paid": those rows are
   * invisible if the list only knows about money that arrived.
   */
  const withFilters = (query: AdminQuery): AdminQuery => {
    let next = query
      .gte("created_at", `${range.from}T00:00:00+05:30`)
      .lt("created_at", `${nextDay(range.to)}T00:00:00+05:30`);
    if (status) next = next.eq("status", status);
    if (method) next = next.eq("method", method);
    if (kind) next = next.eq("kind", kind);
    return next;
  };

  const { count: total } = await withFilters(
    admin.from("payments").select("id", { count: "exact", head: true }),
  );

  const { page, from, to } = pageWindow(params.page, total ?? 0, PER_PAGE);

  const [{ data, count, error }, { data: plans }, { data: packs }] = await Promise.all([
    withFilters(admin.from("payments").select("*, profiles(full_name, email)", { count: "exact" }))
      .order("created_at", { ascending: false })
      .range(from, to),
    admin.from("plans").select("id, name"),
    admin.from("credit_packs").select("id, name"),
  ]);

  const rows = (data ?? []) as PaymentRow[];
  const planName = new Map(((plans ?? []) as Pick<Plan, "id" | "name">[]).map((p) => [p.id, p.name]));
  const packName = new Map(
    ((packs ?? []) as Pick<CreditPack, "id" | "name">[]).map((p) => [p.id, p.name]),
  );

  const carried = { ...rangeParams(range), section: "receipts" };

  return (
    <Panel
      title="Receipts"
      description={
        error
          ? undefined
          : `${fmtNumber(count ?? 0)} payment${count === 1 ? "" : "s"} started in this range.`
      }
      bodyClassName="p-0"
      actions={
        <form method="get" action="/admin/finance" className="flex flex-wrap items-center gap-1.5">
          {Object.entries(carried).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <Select name="status" defaultValue={status ?? ""} className="h-9 py-0 text-xs">
            <option value="">Any status</option>
            <option value="paid">Paid</option>
            <option value="created">Started, not paid</option>
            <option value="failed">Failed</option>
          </Select>
          <Select name="method" defaultValue={method ?? ""} className="h-9 py-0 text-xs">
            <option value="">Any method</option>
            {PAYMENT_METHODS.map((option) => (
              <option key={option.key} value={option.key}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select name="kind" defaultValue={kind ?? ""} className="h-9 py-0 text-xs">
            <option value="">Anything bought</option>
            <option value="plan">Plans</option>
            <option value="credits">Credit packs</option>
          </Select>
          {/* A method="get" form is a browser navigation React never sees, so
              neither useFormStatus nor a loading.tsx can report it. This button
              watches its own form's submit event instead - without it, applying
              a filter over a slow connection looks like nothing happened and
              people press Apply again. */}
          <FilterSubmitButton icon={<Filter size={13} />}>Apply</FilterSubmitButton>
        </form>
      }
    >
      {error ? (
        <div className="px-5 py-4">
          <p className="flex items-start gap-2 text-sm text-bad-500">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            Could not read the payment list: {error.message}
          </p>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No payments match"
          description="Widen the date range, or clear a filter."
        />
      ) : (
        <>
          <TableWrap>
            <Thead>
              <th className="th">When</th>
              <th className="th">Customer</th>
              <th className="th">Bought</th>
              <th className="th">Method</th>
              <th className="th text-right">Amount</th>
              <th className="th text-right">Credits</th>
              <th className="th">Status</th>
              <th className="th">Reference</th>
            </Thead>
            <Tbody>
              {rows.map((row) => {
                const discount = Number(row.discount_inr ?? 0);
                const charged = Number(row.amount_inr) || 0;
                return (
                  <Tr key={row.id}>
                    <td className="td whitespace-nowrap">
                      <span className="block text-sm text-ink">
                        {fmtRelative(row.paid_at ?? row.created_at)}
                      </span>
                      <span className="block text-xs text-faint">
                        {fmtDateTime(row.paid_at ?? row.created_at)}
                      </span>
                    </td>
                    <td className="td text-sm">
                      <Link
                        href={`/admin/officers/${row.user_id}`}
                        className="transition hover:text-brand-400"
                      >
                        {row.profiles?.full_name ?? row.profiles?.email ?? "—"}
                      </Link>
                    </td>
                    <td className="td text-sm">
                      {row.kind === "plan" ? (
                        <>
                          <Badge tone="brand">plan</Badge>
                          <span className="mt-0.5 block text-xs text-muted">
                            {(row.plan_id ? planName.get(row.plan_id) : null) ?? "removed"}
                          </span>
                        </>
                      ) : (
                        <>
                          <Badge>pack</Badge>
                          <span className="mt-0.5 block text-xs text-muted">
                            {(row.pack_id ? packName.get(row.pack_id) : null) ?? "custom"}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="td">
                      <Badge tone={row.method === "razorpay" ? "neutral" : "brand"}>
                        {methodLabel(row.method)}
                      </Badge>
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
                      {/* Never assign the plan by hand for these - see recheckPayment. */}
                      {row.method === "razorpay" && row.status !== "paid" ? (
                        <RecheckPayment orderId={row.razorpay_order_id} />
                      ) : null}
                    </td>
                    <td className="td">
                      {/* An offline receipt has a synthetic order id nobody can
                          look up anywhere, so its note is the useful thing to
                          show instead. */}
                      {row.method === "razorpay" ? (
                        <Mono className="text-xs text-faint">{row.razorpay_order_id}</Mono>
                      ) : (
                        <span className="text-xs text-faint">{row.note ?? "recorded by hand"}</span>
                      )}
                    </td>
                  </Tr>
                );
              })}
            </Tbody>
          </TableWrap>

          <div className="border-t border-divider px-4 py-3 sm:px-5">
            <Pager
              page={page}
              total={count ?? rows.length}
              pageSize={PER_PAGE}
              noun="payments"
              href={{
                path: "/admin/finance",
                params: { ...carried, status, method, kind },
              }}
              className=""
            />
          </div>
        </>
      )}
    </Panel>
  );
}

/** The day after a YYYY-MM-DD, for a half-open upper bound. */
function nextDay(date: string): string {
  const at = new Date(`${date}T12:00:00Z`);
  at.setUTCDate(at.getUTCDate() + 1);
  return at.toISOString().slice(0, 10);
}
