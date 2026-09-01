import { HistoryTab } from "./HistoryTab";
import { PlansTab } from "./PlansTab";
import { RulesTab } from "./RulesTab";
import { TabStrip, activeTab, type SectionParams, type Tab } from "./TabStrip";
import { redirect } from "next/navigation";
import { Gift } from "lucide-react";
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
    "What a customer buys first. A plan sets the monthly price, the credits the account opens with, and how many trucks may be tracked automatically.",
  rules:
    "Two conversions, both set here, both live from the moment you save. Money becomes credits at the pack prices; credits become work at the rates below.",
  history:
    "What has already happened, one customer per row. Open a customer for their own credit history; the payment list underneath is the platform-wide record. Nothing on this tab can be edited.",
};

export default async function PlansAndCreditsPage({
  searchParams,
}: {
  searchParams: Promise<SectionParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;

  /* Referrals and coupons moved to their own section. Old links and bookmarks
     land there rather than on a tab that silently became Plans. */
  if (params.tab === "referrals" || params.tab === "coupons") {
    redirect(`/admin/rewards?section=${params.tab}`);
  }

  const tab = activeTab(params.tab);

  return (
    <>
      <PageHeader title="Plans & credits" subtitle={INTRO[tab]} />
      <TabStrip current={tab} />

      {tab === "plans" ? <PlansTab /> : null}
      {tab === "rules" ? <RulesTab /> : null}
      {tab === "history" ? <HistoryTab params={params} /> : null}

      {/* Named and linked rather than embedded: they are a different job, and
          somebody who came here looking for them should find the way. */}
      <div className="mt-5">
        <LinkCard
          href="/admin/rewards"
          icon={<Gift size={16} />}
          title="Referrals and coupons"
          description="Invite-and-earn terms, discount codes, and what each has cost — in their own section."
        />
      </div>
    </>
  );
}
