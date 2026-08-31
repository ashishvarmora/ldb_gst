import Link from "next/link";
import type { ReactNode } from "react";
import { Activity, LayoutDashboard, Settings, Truck, Wallet } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * The account page used to be one column of eleven panels, and finding the
 * credit history meant scrolling past every truck. It is now five tabs.
 *
 * The tab lives in the query string rather than in client state, on purpose:
 * every tab is server-rendered from its own queries, so opening one costs only
 * that tab's data instead of all of it; a tab can be linked to, bookmarked and
 * opened in a new browser tab; and a Server Action that refreshes the route
 * comes back to the tab you were on. It also means the filters and page numbers
 * inside a tab are just more query parameters, with nothing to keep in sync.
 */

export const TABS = [
  { key: "overview", label: "Overview", icon: LayoutDashboard },
  { key: "credits", label: "Credits", icon: Wallet },
  { key: "trucks", label: "Trucks", icon: Truck },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "settings", label: "Settings", icon: Settings },
] as const;

export type Tab = (typeof TABS)[number]["key"];

/** Every query parameter the account page reads, across all five tabs. */
export type AccountParams = {
  tab?: string;
  /** Credits tab: money in / usage, and the two page numbers. */
  flow?: string;
  cpage?: string;
  ppage?: string;
  /** Trucks tab. */
  tq?: string;
  tstatus?: string;
  tsort?: string;
  tpage?: string;
  /**
   * Activity tab. The alerts panel there is a short preview with a link into
   * the delivery log, so it carries no filter or page of its own.
   */
  source?: string;
  outcome?: string;
  spage?: string;
};

export function activeTab(raw: string | undefined): Tab {
  const found = TABS.find((tab) => tab.key === raw);
  return found ? found.key : "overview";
}

export function TabStrip({
  basePath,
  current,
  counts,
}: {
  basePath: string;
  current: Tab;
  /** Optional figure beside a tab label, e.g. the number of trucks. */
  counts?: Partial<Record<Tab, ReactNode>>;
}) {
  return (
    <nav
      aria-label="Account sections"
      className="mb-5 flex gap-1 overflow-x-auto border-b border-divider pb-px"
    >
      {TABS.map(({ key, label, icon: Icon }) => {
        const active = key === current;
        return (
          <Link
            key={key}
            href={key === "overview" ? basePath : `${basePath}?tab=${key}`}
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
            {counts?.[key] !== undefined && counts[key] !== null ? (
              <span
                className={cx(
                  "rounded-full px-1.5 text-[11px] tabular-nums",
                  active ? "bg-brand-500/15 text-brand-500" : "bg-sunken text-faint",
                )}
              >
                {counts[key]}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
