import Link from "next/link";
import { Coins, Gift, History, Package } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * Plans and credits, in one place, split by what a tab is for.
 *
 * They were two pages that could not be read apart: a plan hands over credits,
 * credits are what the plan is spent on, and the rules for both were mixed in
 * with the record of what had already happened. So one destination, and inside
 * it a hard line - the first three tabs are things you SET, the History tab is
 * things that HAPPENED. Nothing appears in both.
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
  { key: "history", label: "History", icon: History },
  { key: "referrals", label: "Referrals", icon: Gift },
] as const;

export type Tab = (typeof TABS)[number]["key"];

export const BASE_PATH = "/admin/plans";

/** Every query parameter this section reads, across all four tabs. */
export type SectionParams = {
  tab?: string;
  /** History tab: payment filters, ledger filter, and the two page numbers. */
  status?: string;
  kind?: string;
  flow?: string;
  pay?: string;
  act?: string;
  /** Referrals tab. */
  ref?: string;
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
