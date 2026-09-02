import { CouponClaimsSection } from "./CouponClaimsSection";
import { CouponsTab } from "./CouponsTab";
import { ReferralClaimsSection } from "./ReferralClaimsSection";
import { ReferralsTab } from "./ReferralsTab";
import { type RewardParams } from "./params";
import { SectionTabs, activeSection, type Section } from "@/components/SectionTabs";
import { PageHeader } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";

export const metadata = { title: "Rewards — Rahdari admin" };

/**
 * Referrals and coupons: the terms, and what those terms have actually paid out.
 *
 * They were tabs four and five of Plans & credits, whose first three are the
 * price list and what has been charged against it. That put "what does a plan
 * cost" and "who earned a referral bonus" behind one heading, and the owner
 * said plainly that it read as a mess.
 *
 * FOUR views rather than two, split along the line the owner drew: the terms
 * you set, and the claims that resulted. They are genuinely different jobs.
 * Setting a coupon's percentage is a form you visit once; asking which code
 * has been used, by whom, and how many times is a report you come back to, and
 * it wants ordering, filtering and a total. Cramming both into one screen is
 * why "who used this code" was a panel at the bottom of a price list.
 *
 * The claims reports read the two views 0029 added rather than the raw
 * redemption table, because the raw table cannot answer the question. It
 * records amount_inr and discount_inr, which is the whole story for a
 * percentage code and nothing at all for a credit_bonus code - TOPUP500 pays
 * 500 credits and takes nothing off the price, so its one real claim rendered
 * as "order Rs 0, came off Rs 0". The view reports the reward in the unit it
 * was actually paid in.
 */
const REWARD_SECTIONS: Section[] = [
  { key: "referrals", label: "Referral terms", hint: "Invite someone, earn when they pay" },
  { key: "coupons", label: "Coupon codes", hint: "The codes themselves, and their limits" },
  {
    key: "referral-claims",
    label: "Referral claims",
    hint: "Every invite, who paid and what it earned",
  },
  {
    key: "coupon-claims",
    label: "Coupon claims",
    hint: "Every claim, by code and by account",
  },
];

/*
 * The two sorts of code, said in the heading of the section that sets them.
 *
 * They were described only in passing, and the owner's word for the result is
 * "messy": a discount code and a free credit code are paid in different units,
 * so a figure that does not say which unit it is in is a figure nobody can
 * check. Both coupon views now carry a classification filter that survives the
 * link between them.
 */

const INTRO: Record<string, string> = {
  referrals:
    "What an invite is worth, and when it counts. Changing these terms affects invites from now on — anything already earned stays earned.",
  coupons:
    "The codes themselves, in two sorts. A discount code takes rupees off a payment; a free credit code hands over credits, is claimed on its own with nothing bought, and is refused at a checkout.",
  "referral-claims":
    "Every invite ever sent, both sides named, and how long the invitee took to pay. Sortable and exportable.",
  "coupon-claims":
    "Every claim on every code — who, when, what actually came off a price and what credits were actually granted. Filter by sort of code, by outcome and by date; group by account to see one person against several codes.",
};

export default async function RewardsPage({
  searchParams,
}: {
  searchParams: Promise<RewardParams>;
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
      {section === "referral-claims" ? <ReferralClaimsSection params={params} /> : null}
      {section === "coupon-claims" ? <CouponClaimsSection params={params} /> : null}
    </>
  );
}
