import type { AccountParams } from "./TabStrip";
import { pageWindow } from "../../pager";
import { PaymentsTable } from "../../tables";
import { Pager } from "@/components/Pager";
import { DescRow, Panel } from "@/components/ui";
import { PAYMENT_METHODS, methodLabel } from "@/lib/analytics";
import { fmtNumber, fmtRupees } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditPack, OfficerOverview, Payment, PaymentMethod, Plan } from "@/lib/types";

const PER_PAGE = 15;

/**
 * The money one account has actually paid, apart from what its credits did.
 *
 * This lived inside the Credits tab, under the credit ledger, which put two
 * different questions on one screen: "what did the balance do" and "what money
 * came in". They are not the same - an admin can grant credits with no payment,
 * and a payment can sit at "created" having moved no credits - so reading one
 * for the other quietly misled. Its own tab now.
 *
 * 'paid' is the only status that is money in hand, and it is the only status
 * settle_payment() ever writes. The summary used to filter on 'captured', a
 * value this schema has never stored, so every figure in this panel read Rs 0
 * regardless of what the account had paid. A check constraint on the column now
 * makes that spelling impossible to reintroduce.
 */
export async function PaymentsTab({
  id,
  params,
}: {
  id: string;
  overview: OfficerOverview;
  params: AccountParams;
}) {
  const admin = getSupabaseAdmin();

  /*
   * The count first, in its own head request, so the page number can be clamped
   * against it. A range that starts past the last row is not an empty page -
   * PostgREST answers it with 416, which arrives as a null count, reads as zero
   * rows, and leaves the Pager hiding itself with no link back.
   */
  const { count: total } = await admin
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", id);

  const { page, from, to } = pageWindow(params.ppage, total ?? 0, PER_PAGE);

  const [{ data: payments, count }, { data: settled }, { data: plans }, { data: packs }, settings] =
    await Promise.all([
      admin
        .from("payments")
        .select("*", { count: "exact" })
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .range(from, to),
      /* Every settled payment, for the summary - the page above is only a
         slice, and a total from a slice is not a total. */
      admin
        .from("payments")
        .select("amount_inr, credits, method")
        .eq("user_id", id)
        .eq("status", "paid"),
      admin.from("plans").select("id, name"),
      admin.from("credit_packs").select("id, name"),
      loadSettings(admin),
    ]);

  const rows = (payments ?? []) as Payment[];
  const settledRows = (settled ?? []) as Pick<Payment, "amount_inr" | "credits" | "method">[];

  const planName = new Map(
    ((plans ?? []) as Pick<Plan, "id" | "name">[]).map((plan) => [plan.id, plan.name]),
  );
  const packName = new Map(
    ((packs ?? []) as Pick<CreditPack, "id" | "name">[]).map((pack) => [pack.id, pack.name]),
  );

  /*
   * Split by how the money arrived, from the method column rather than by
   * guessing from a missing Razorpay id. The guess was wrong in both
   * directions: a gateway payment settled before that id was stored looked
   * offline, and a cash receipt could not say it was cash.
   *
   * Only the methods this account has actually used get a row - a customer who
   * has only ever paid by card should not read five zeroes.
   */
  const byMethod = new Map<PaymentMethod, { total: number; count: number }>();
  for (const row of settledRows) {
    const bucket = byMethod.get(row.method) ?? { total: 0, count: 0 };
    bucket.total += Number(row.amount_inr) || 0;
    bucket.count += 1;
    byMethod.set(row.method, bucket);
  }

  const received = settledRows.reduce((acc, row) => acc + (Number(row.amount_inr) || 0), 0);
  const creditsSold = settledRows.reduce((acc, row) => acc + (Number(row.credits) || 0), 0);

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
      <div className="space-y-5 xl:col-span-2">
        <Panel
          title="Payments"
          description="Money this account has paid, newest first. Credit grants with no money are on the Credits tab."
          bodyClassName="p-0"
        >
          <PaymentsTable
            rows={rows}
            planName={planName}
            packName={packName}
            emptyTitle={
              (count ?? 0) > 0 ? "That page is past the end of the list" : "No payments yet"
            }
            emptyDescription={
              (count ?? 0) > 0
                ? "Use the page links below to get back."
                : settings.razorpayEnabled
                  ? "Anything they buy in the app shows up here with its order id."
                  : "Online payment is off, so credits arrive through Add credits on the Credits tab."
            }
          />
          {(count ?? 0) > 0 ? (
            <Pager
              className="border-t border-divider px-5 py-3"
              page={page}
              total={count ?? rows.length}
              pageSize={PER_PAGE}
              noun="payments"
              href={{ path: `/admin/officers/${id}`, params: { tab: "payments" }, pageKey: "ppage" }}
            />
          ) : null}
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel
          title="Received"
          description="Settled payments only — an intention and a failure are not money."
        >
          <dl>
            {PAYMENT_METHODS.filter((method) => byMethod.has(method.key)).map((method) => (
              <DescRow key={method.key} label={methodLabel(method.key)}>
                {fmtRupees(byMethod.get(method.key)?.total ?? 0)}
              </DescRow>
            ))}
            <DescRow label="Total received">{fmtRupees(received)}</DescRow>
            <DescRow label="Payments">{fmtNumber(settledRows.length)}</DescRow>
            <DescRow label="Credits sold">{fmtNumber(creditsSold)}</DescRow>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            Cash, bank transfers and cheques are recorded from Finance, and settle exactly like a
            gateway payment — the same credits, the same plan, the same referral reward.
          </p>
        </Panel>
      </div>
    </div>
  );
}
