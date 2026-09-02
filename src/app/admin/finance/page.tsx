import { Plus } from "lucide-react";

import { CreditsSection } from "./CreditsSection";
import { PaymentsSection } from "./PaymentsSection";
import { RecordPaymentForm } from "./RecordPaymentForm";
import { RevenueSection } from "./RevenueSection";
import { DateRangeBar } from "@/components/DateRangeBar";
import { Modal } from "@/components/Modal";
import { SectionTabs, activeSection, type Section } from "@/components/SectionTabs";
import { PageHeader } from "@/components/ui";
import type { ExplorerParams } from "@/components/report";
import { rangeParams, resolveRange } from "@/lib/analytics";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtRupees, istToday } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Plan, Profile } from "@/lib/types";

export const metadata = { title: "Finance — Admin" };

/**
 * Every question about money, in one place.
 *
 * It used to be spread over three screens that each answered a third of it and
 * disagreed about the rest: a "Money this month" panel on the Overview, a
 * History tab inside Plans & credits, and a per-customer summary on the account
 * page. Two of the three summed `status = 'captured'`, which this schema has
 * never written, so both read Rs 0 for ever.
 *
 * Now: one date range at the top, three sections under it, and every figure
 * from the same database functions. Revenue is what arrived, Credit economy is
 * what that money and the giveaways turned into, Receipts is the line-by-line
 * record. Nothing is computed twice.
 *
 * The page itself is this short deliberately. It checks who is asking, works
 * out the window, and hands over: each section reads only what it needs, which
 * is what stopped the Revenue tab paying for the credit ledger's seven queries
 * and the credit tab paying for the payment list's two.
 */
const SECTIONS: Section[] = [
  { key: "revenue", label: "Revenue", hint: "What came in, and where from" },
  { key: "credits", label: "Credit economy", hint: "What was issued, bought, given and spent" },
  { key: "receipts", label: "Receipts", hint: "Payment by payment" },
];

const INTRO: Record<string, string> = {
  revenue:
    "Money actually received, split by how it arrived and what it bought. A payment still at “started” is an intention, not revenue, and is never counted here. Every figure opens the payments behind it.",
  credits:
    "Every credit a customer was given, bought or spent, grouped however you ask — so “who claimed those free credits” is a question with an answer rather than a card with a number on it. Admin accounts are not customers and are left out.",
  receipts:
    "Every payment in the range, filterable. Cash and bank transfers are recorded here too, and settle exactly like a gateway payment.",
};

/**
 * Everything the three sections read out of the URL.
 *
 * `kind` is doing two jobs, and that is safe rather than sloppy: on Receipts it
 * is what was bought (plan or credits) and on Credit economy it is which half
 * of the ledger (added or spent). The two sections never appear in one URL, the
 * section tabs carry only the date range across a switch, and each side falls
 * back to its own default when it meets the other's value - so the worst a
 * hand-edited link can do is show an unfiltered report.
 */
export type FinanceParams = ExplorerParams & {
  section?: string;
  range?: string;
  from?: string;
  to?: string;
  bucket?: string;
  /* Receipts section. */
  status?: string;
  method?: string;
  kind?: string;
  page?: string;
};

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<FinanceParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const section = activeSection(SECTIONS, params.section);
  const range = resolveRange(params);
  const admin = getSupabaseAdmin();

  /*
   * The two lists the "Record a payment" modal needs, and nothing else.
   *
   * This used to be admin_account_activity() for the whole window - every
   * account's money, credits, searches and lifecycle stage - on every section,
   * to fill in a dropdown of names. The modal is in the page header, so it is
   * present whichever section is open; making its cost the whole activity
   * report meant the Receipts tab paid for a report it never rendered.
   */
  const [{ data: customers }, { data: plans }] = await Promise.all([
    admin
      .from("profiles")
      .select("id, full_name, email")
      .eq("role", "officer")
      .order("full_name", { nullsFirst: false }),
    admin.from("plans").select("id, name, price_per_month, included_credits").order("sort_order"),
  ]);

  const customerRows = (customers ?? []) as Pick<Profile, "id" | "full_name" | "email">[];
  const planRows = (plans ?? []) as Pick<
    Plan,
    "id" | "name" | "price_per_month" | "included_credits"
  >[];

  return (
    <>
      <PageHeader
        title="Finance"
        subtitle={INTRO[section]}
        actions={
          <Modal
            triggerLabel="Record a payment"
            triggerIcon={<Plus size={14} />}
            title="Record a payment received offline"
            description="Cash, a bank transfer, UPI or a cheque. It settles exactly like a gateway payment: credits are granted, a plan is assigned and extended, and any referral it earns is paid."
            width="md"
          >
            <RecordPaymentForm
              customers={customerRows.map((customer) => ({
                id: customer.id,
                label: `${customer.full_name ?? customer.email}${customer.full_name ? ` · ${customer.email}` : ""}`,
              }))}
              plans={planRows.map((plan) => ({
                id: plan.id,
                name: `${plan.name} — ${fmtRupees(plan.price_per_month)}/month, ${formatCredits(plan.included_credits)} credits`,
                price: Number(plan.price_per_month) || 0,
                credits: Number(plan.included_credits) || 0,
              }))}
              today={istToday()}
            />
          </Modal>
        }
      />

      <SectionTabs
        sections={SECTIONS}
        active={section}
        basePath="/admin/finance"
        keep={rangeParams(range)}
      />
      <DateRangeBar range={range} showBucket={section !== "receipts"} />

      {section === "revenue" ? <RevenueSection params={params} range={range} /> : null}
      {section === "credits" ? <CreditsSection params={params} range={range} /> : null}
      {section === "receipts" ? <PaymentsSection params={params} range={range} /> : null}
    </>
  );
}
