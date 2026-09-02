import Link from "next/link";
import { Coins, Package } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * Plans and credits, in one place, split by what a tab is for.
 *
 * They were two pages that could not be read apart: a plan hands over credits,
 * credits are what the plan is spent on, and the rules for both were mixed in
 * with the record of what had already happened. So one destination, and inside
 * it a hard line - Plans and Credit rules are things you SET, History is things
 * that HAPPENED, and nothing appears in both.
 *
 * Referrals and Coupons used to be tabs four and five here. They are their own
 * section now - /admin/rewards - because they are levers for getting customers
 * rather than for pricing the product, and mixing them in made this heading
 * cover two unrelated jobs.
 *
 * History was tab three, and is now /admin/finance. It was a revenue report
 * living behind a price list: it summed payments over a capped scan of two
 * thousand rows in JavaScript, filtered on a payment status the schema never
 * writes, and answered half of what the Finance section answers properly. Two
 * reports of the same money is one report that is wrong. Old links redirect.
 *
 * The tab lives in the query string rather than in client state, the same way
 * the account page does it: every tab is server-rendered from its own queries,
 * so opening one costs only that tab's data; a tab can be linked to and
 * bookmarked; and a Server Action that refreshes the route comes back to the
 * tab you were on, with its filters and page numbers intact.
 */

export const TABS = [
  { key: "plans", label: "Plans", icon: Package },
  { key: "rules", label: "Credit rules", icon: Coins },
] as const;

export type Tab = (typeof TABS)[number]["key"];

export const BASE_PATH = "/admin/plans";

/** Every query parameter this section reads, across all five tabs. */
export type SectionParams = {
  tab?: string;
  /** Referrals tab. */
  ref?: string;
  /**
   * Coupons tab: the page of the code list, the code whose redemptions are
   * open, and the page of those. The code itself rather than its id, so the
   * link to "who used SAVE20" reads as what it is.
   */
  cp?: string;
  code?: string;
  red?: string;
};

export function activeTab(raw: string | undefined): Tab {
  const found = TABS.find((tab) => tab.key === raw);
  return found ? found.key : "plans";
}

/** The href for a tab, carrying nothing else - another tab's filters mean nothing here. */
export function tabHref(tab: Tab): string {
  return tab === "plans" ? BASE_PATH : `${BASE_PATH}?tab=${tab}`;
}

export function TabStrip({ current }: { current: Tab }) {
  return (
    <nav
      aria-label="Plans and credits sections"
      className="mb-5 flex gap-1 overflow-x-auto border-b border-divider pb-px"
    >
      {TABS.map(({ key, label, icon: Icon }) => {
        const active = key === current;
        return (
          <Link
            key={key}
            href={tabHref(key)}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex min-h-10 shrink-0 items-center gap-2 rounded-t-lg border-b-2 px-3.5 text-sm transition",
              active
                ? "border-brand-500 font-medium text-brand-500"
                : "border-transparent text-muted hover:bg-sunken/70 hover:text-ink",
            )}
          >
            <Icon size={15} className="shrink-0" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
