import { PlansTab } from "./PlansTab";
import { RulesTab } from "./RulesTab";
import { TabStrip, activeTab, type SectionParams, type Tab } from "./TabStrip";
import { redirect } from "next/navigation";
import { Gift, IndianRupee } from "lucide-react";
import { LinkCard, PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";

export const metadata = { title: "Plans & credits — Admin" };

/**
 * One sentence per tab, in the page header, so the reader knows what kind of
 * thing they are looking at before they touch anything: three tabs of rules,
 * one of records.
 */
const INTRO: Record<Tab, string> = {
  plans:
    "What a customer buys first. A plan sets its whole price, how long it runs, the credits the account opens with, and how many trucks may be tracked automatically.",
  rules:
    "Two conversions, both set here, both live from the moment you save. Money becomes credits at the pack prices; credits become work at the rates below.",
};

export default async function PlansAndCreditsPage({
  searchParams,
}: {
  searchParams: Promise<SectionParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;

  /*
   * Referrals and coupons moved to their own section, and History became the
   * Finance report. Old links and bookmarks land where the thing they were
   * looking for actually lives, rather than on a tab that silently became
   * Plans.
   *
   * CARRYING THE REST OF THE QUERY STRING IS THE POINT. This redirect used to
   * keep only the tab name, which broke the exact link it existed to preserve:
   * /admin/plans?tab=coupons&code=TOPUP500 arrived at the coupons section with
   * the code stripped off, so a code that had definitely been claimed rendered
   * as "No code chosen". Every rewards parameter comes across.
   */
  if (params.tab === "referrals" || params.tab === "coupons") {
    const carried = new URLSearchParams({ section: params.tab });
    for (const key of ["code", "cp", "red", "ref", "status", "group", "sort", "dir"] as const) {
      const value = params[key as keyof SectionParams];
      if (typeof value === "string" && value) carried.set(key, value);
    }
    redirect(`/admin/rewards?${carried}`);
  }
  if (params.tab === "history") redirect("/admin/finance");

  const tab = activeTab(params.tab);

  return (
    <>
      <PageHeader title="Plans & credits" subtitle={INTRO[tab]} />
      <TabStrip current={tab} />

      {tab === "plans" ? <PlansTab /> : null}
      {tab === "rules" ? <RulesTab /> : null}

      {/* Named and linked rather than embedded: each is a different job, and
          somebody who came here looking for one should find the way. */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <LinkCard
          href="/admin/rewards"
          icon={<Gift size={16} />}
          title="Referrals and coupons"
          description="Invite-and-earn terms, discount codes, and what each has cost — in their own section."
        />
        <LinkCard
          href="/admin/finance"
          icon={<IndianRupee size={16} />}
          title="What these prices have earned"
          description="Revenue by day and by method, the credit economy, and every receipt — in Finance."
        />
      </div>
    </>
  );
}
