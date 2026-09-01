import type { AccountParams } from "./TabStrip";
import { pageRange } from "../../pager";
import { PaymentsTable } from "../../tables";
import { Pager, pageFromParam } from "@/components/Pager";
import { DescRow, Panel } from "@/components/ui";
import { fmtNumber, fmtRupees } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditPack, OfficerOverview, Payment, Plan } from "@/lib/types";

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
 * Captured is the only status that is money in hand. A row at "created" is an
 * intention and a "failed" one is nothing, so the totals count only captured -
 * anything else on this screen would overstate what the account has paid.
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

  const page = pageFromParam(params.ppage);
  const range = pageRange(page, PER_PAGE);

  const [{ data: payments, count }, { data: captured }, { data: plans }, { data: packs }, settings] =
    await Promise.all([
      admin
        .from("payments")
        .select("*", { count: "exact" })
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .range(range.from, range.to),
      /* Every captured payment, for the summary - the page above is only a
         slice, and a total from a slice is not a total. */
      admin.from("payments").select("amount_inr, credits, razorpay_payment_id").eq("user_id", id).eq("status", "captured"),
      admin.from("plans").select("id, name"),
      admin.from("credit_packs").select("id, name"),
      loadSettings(admin),
    ]);

  const rows = (payments ?? []) as Payment[];
  const capturedRows = (captured ?? []) as Pick<Payment, "amount_inr" | "credits" | "razorpay_payment_id">[];

  const planName = new Map(
    ((plans ?? []) as Pick<Plan, "id" | "name">[]).map((plan) => [plan.id, plan.name]),
  );
  const packName = new Map(
    ((packs ?? []) as Pick<CreditPack, "id" | "name">[]).map((pack) => [pack.id, pack.name]),
  );

  /*
   * Split by how the money arrived. A Razorpay payment carries a payment id; one
   * an admin recorded by hand does not, which is the only reliable way to tell
   * "paid through the gateway" from "entered here" without a second column.
   */
  const gateway = capturedRows.filter((row) => row.razorpay_payment_id);
  const offline = capturedRows.filter((row) => !row.razorpay_payment_id);
  const sum = (list: typeof capturedRows) => list.reduce((acc, row) => acc + (Number(row.amount_inr) || 0), 0);

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
            emptyTitle={(count ?? 0) > 0 ? "That page is past the end of the list" : "No payments yet"}
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
        <Panel title="Received" description="Captured payments only — intentions and failures are not money.">
          <dl>
            <DescRow label="Through the gateway">{fmtRupees(sum(gateway))}</DescRow>
            <DescRow label="Recorded by hand">{fmtRupees(sum(offline))}</DescRow>
            <DescRow label="Total received">{fmtRupees(sum(capturedRows))}</DescRow>
            <DescRow label="Payments">{fmtNumber(capturedRows.length)}</DescRow>
            <DescRow label="Credits sold">
              {fmtNumber(capturedRows.reduce((acc, row) => acc + (Number(row.credits) || 0), 0))}
            </DescRow>
          </dl>
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            &ldquo;Recorded by hand&rdquo; is a captured payment with no Razorpay id — money you
            entered here for a bank transfer or cash, rather than one the gateway took.
          </p>
        </Panel>
      </div>
    </div>
  );
}
