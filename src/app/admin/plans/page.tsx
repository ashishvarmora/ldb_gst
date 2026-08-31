import { HistoryTab } from "./HistoryTab";
import { PlansTab } from "./PlansTab";
import { ReferralsTab } from "./ReferralsTab";
import { RulesTab } from "./RulesTab";
import { TabStrip, activeTab, type SectionParams, type Tab } from "./TabStrip";
import { PageHeader } from "@/components/ui";
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
    "What has already happened: every payment, and every credit that moved. Nothing on this tab can be edited.",
  referrals:
    "Invite someone, earn when they pay. Set the terms here, and see who has actually earned something.",
};

export default async function PlansAndCreditsPage({
  searchParams,
}: {
  searchParams: Promise<SectionParams>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const tab = activeTab(params.tab);

  return (
    <>
      <PageHeader title="Plans & credits" subtitle={INTRO[tab]} />
      <TabStrip current={tab} />

      {tab === "plans" ? <PlansTab /> : null}
      {tab === "rules" ? <RulesTab /> : null}
      {tab === "history" ? <HistoryTab params={params} /> : null}
      {tab === "referrals" ? <ReferralsTab params={params} /> : null}
    </>
  );
}
