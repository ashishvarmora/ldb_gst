/**
 * Where the rewards screens live, and everything they read out of the URL.
 *
 * This used to come from ../plans/TabStrip, and that import was the whole bug
 * behind "the who-used-this-code link does not work". Referrals and coupons
 * moved here, but every link they generated still carried the old section's
 * BASE_PATH of /admin/plans and its ?tab= parameter - a path that no longer has
 * those tabs. So the "who used TOPUP500" button navigated to
 * /admin/plans?tab=coupons&code=TOPUP500, hit the compatibility redirect there,
 * and arrived at the coupons section with the code stripped off: "No code
 * chosen", on a code that had definitely been used.
 *
 * One constant, in the section that owns it, so a link out of a rewards screen
 * cannot address anything but a rewards screen.
 */
export const REWARDS_PATH = "/admin/rewards";

/** The four views, in the order they are read rather than alphabetically. */
export const REWARD_KEYS = ["referrals", "coupons", "referral-claims", "coupon-claims"] as const;

export type RewardKey = (typeof REWARD_KEYS)[number];

export type RewardParams = {
  /**
   * Which view. `section`, matching SectionTabs, not the `tab` the old Plans
   * strip used - the redirect from the old links translates it.
   */
  section?: string;

  /* Referrals terms. */
  ref?: string;

  /* Coupons: the page of the code list, the code whose claims are open, and
     the page of those. The code itself rather than its id, so a link to "who
     used SAVE20" reads as what it is. */
  cp?: string;
  code?: string;
  red?: string;

  /**
   * Which family of code, on both coupon screens: "discount", "credit", or
   * absent for both.
   *
   * One parameter shared by the code list and the claims report rather than
   * two, so "show me only the free credit codes" survives the jump from one to
   * the other. The owner's complaint was that free credits get mixed in with
   * discounts and become messy; a classification that resets itself when you
   * follow a link is not a classification.
   */
  kind?: string;

  /* The two claims reports: a date window, a sort, filters and a page. */
  range?: string;
  from?: string;
  to?: string;
  bucket?: string;
  sort?: string;
  dir?: string;
  status?: string;
  account?: string;
  group?: string;
  page?: string;
};

/**
 * Every parameter worth carrying across a link, minus the ones a given link is
 * about to set itself. Written once because the failure it prevents is
 * invisible: a pager that quietly drops ?code= looks like it worked.
 */
export function rewardCarry(
  params: RewardParams,
  section: RewardKey,
  drop: (keyof RewardParams)[] = [],
): Record<string, string | undefined> {
  const all: Record<string, string | undefined> = {
    section,
    code: params.code,
    kind: params.kind,
    cp: params.cp,
    red: params.red,
    ref: params.ref,
    range: params.range,
    from: params.from,
    to: params.to,
    bucket: params.bucket,
    sort: params.sort,
    dir: params.dir,
    status: params.status,
    account: params.account,
    group: params.group,
  };
  for (const key of drop) delete all[key];
  return all;
}
