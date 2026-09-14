import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { LinkPending } from "@/components/NavPending";
import { cx } from "@/components/ui";

/**
 * Sub-navigation inside one page.
 *
 * Several admin screens had grown into a single scroll of eight or ten panels -
 * settings was 746 lines of them - where finding one field meant scrolling past
 * nine things you were not looking for, and no two visits landed in the same
 * place. Grouping them and showing one group at a time turns that into a
 * two-step choice, and the group you are in is visible rather than inferred
 * from how far down the page you have got.
 *
 * The section lives in the URL, like every other bit of state in this codebase:
 * no JavaScript, a section can be linked to directly from a panel elsewhere,
 * and the back button steps back through sections rather than out of the page.
 *
 * Scrolls horizontally on a phone rather than wrapping to three rows, which
 * would push the actual content below the fold on the smallest screens.
 *
 * Changing section only changes ?section=, so the route segment is the same and
 * the page's loading.tsx never runs - the reader gets no skeleton, just a still
 * screen for as long as the server takes. LinkPending is what fills that gap:
 * the tab that was tapped lights up straight away. See NavPending.tsx.
 */

export type Section = { key: string; label: string; icon?: ReactNode; hint?: string };

/** The chosen section, or the first one - never nothing. */
export function activeSection(sections: Section[], raw: string | undefined): string {
  return sections.some((s) => s.key === raw) ? raw! : (sections[0]?.key ?? "");
}

export function SectionTabs({
  sections,
  active,
  basePath,
  /** Params that must survive a section change, e.g. an account id's tab. */
  keep = {},
  className,
}: {
  sections: Section[];
  active: string;
  basePath: string;
  keep?: Record<string, string | undefined>;
  className?: string;
}) {
  const hrefFor = (key: string) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(keep)) if (v) params.set(k, v);
    params.set("section", key);
    return `${basePath}?${params.toString()}`;
  };

  return (
    <nav
      aria-label="Sections"
      /*
       * `swipeable` carries the edge shadow that says this scrolls - without
       * it the last tab simply ended mid-word and read as a rendering fault.
       * --swipe-bg is the page rather than the default panel, because the
       * strip sits directly on the background. See globals.css.
       */
      style={{ "--swipe-bg": "var(--color-page)" } as CSSProperties}
      className={cx("swipeable -mx-4 mb-5 px-4 sm:mx-0 sm:px-0", className)}
    >
      <ul className="flex w-max min-w-full gap-1.5 border-b border-divider pb-2 sm:w-auto">
        {sections.map(({ key, label, icon, hint }) => {
          const on = key === active;
          return (
            <li key={key}>
              <Link
                href={hrefFor(key)}
                aria-current={on ? "page" : undefined}
                title={hint}
                className={cx(
                  "relative inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium whitespace-nowrap transition",
                  on
                    ? "border-brand-500 bg-brand-500/10 text-brand-500"
                    : "border-transparent text-muted hover:bg-sunken hover:text-ink",
                )}
              >
                <LinkPending size={14}>{icon}</LinkPending>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
