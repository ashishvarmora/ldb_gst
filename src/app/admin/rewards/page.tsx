import { CouponsTab } from "../plans/CouponsTab";
import { ReferralsTab } from "../plans/ReferralsTab";
import { SectionTabs, activeSection, type Section } from "@/components/SectionTabs";
import { PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import type { SectionParams } from "../plans/TabStrip";

export const metadata = { title: "Rewards — Rahdari admin" };

/**
 * Referrals and coupons, out of Plans & credits and into their own place.
 *
 * They were tabs four and five of a section whose first three are the price
 * list and what has been charged against it. That put "what does a plan cost"
 * and "who earned a referral bonus" behind the same heading, and the owner said
 * plainly that it read as a mess.
 *
 * They belong together and apart: both are levers for getting more customers
 * rather than for pricing the product, and both have the same shape - terms at
 * the top, what those terms have actually cost underneath.
 *
 * The tab components are imported from ../plans rather than moved. Their forms,
 * Server Actions and query parameters all work; copying them here to satisfy a
 * folder boundary would be two of everything and a chance for the two to drift.
 */
const REWARD_SECTIONS: Section[] = [
  { key: "referrals", label: "Referrals", hint: "Invite someone, earn when they pay" },
  { key: "coupons", label: "Coupons", hint: "Discount codes, and what each has cost" },
];

const INTRO: Record<string, string> = {
  referrals:
    "Invite someone, earn when they pay. Set the terms here, and see who has actually earned something.",
  coupons:
    "Discount codes, and what each one has cost. A coupon reduces what somebody pays; it never reduces the credits they get.",
};

export default async function RewardsPage({
  searchParams,
}: {
  searchParams: Promise<SectionParams & { section?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const section = activeSection(REWARD_SECTIONS, params.section);

  return (
    <>
      <PageHeader title="Rewards" subtitle={INTRO[section]} />
      <SectionTabs sections={REWARD_SECTIONS} active={section} basePath="/admin/rewards" />

      {section === "referrals" ? <ReferralsTab params={params} /> : null}
      {section === "coupons" ? <CouponsTab params={params} /> : null}
    </>
  );
}
