import type { ReactNode } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * A panel that starts closed, for anything an officer does not need on the
 * first screen.
 *
 * Built on native <details> rather than React state: it costs no client
 * JavaScript, it survives a Server Action refresh with its open sections still
 * open, and the browser's own find-in-page can open it. On a phone that is the
 * difference between a page that scrolls forever and one that answers the
 * question in a glance.
 */
export function Disclosure({
  title,
  hint,
  badge,
  defaultOpen = false,
  bodyClassName,
  className,
  children,
}: {
  title: string;
  /** One line under the title, readable while the section is still shut. */
  hint?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  bodyClassName?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className={cx("panel group overflow-hidden", className)}>
      <summary
        className={cx(
          "flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 py-3",
          "transition hover:bg-raised/70 [&::-webkit-details-marker]:hidden",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-ink">{title}</span>
            {badge}
          </span>
          {hint ? <span className="mt-0.5 block text-xs text-muted">{hint}</span> : null}
        </span>
        <ChevronDown
          size={17}
          aria-hidden
          className="shrink-0 text-faint transition group-open:rotate-180"
        />
      </summary>

      <div className={cx("border-t border-divider", bodyClassName ?? "px-4 py-4")}>{children}</div>
    </details>
  );
}

/**
 * The quiet sibling of Disclosure, for explanation rather than for content.
 *
 * Every page here had grown a paragraph or two telling the reader what the page
 * is - what a credit buys, how long records are kept, why a leg counts as
 * repeated. All of it true, none of it needed twice, and on a phone all of it
 * standing between the reader and the thing they opened the page for.
 *
 * So it collapses to one line of small print. Somebody who needs the
 * explanation finds it exactly where the question occurs to them; everybody
 * else reads the page instead of the manual.
 *
 * Not a Panel: a bordered card would give this the same weight as the content
 * it is explaining, which is the problem it is meant to solve. Native <details>
 * again, so it costs no JavaScript and survives a Server Action refresh.
 */
export function HelpNote({
  title = "How this works",
  className,
  children,
}: {
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <details className={cx("group", className)}>
      <summary
        className={cx(
          "inline-flex min-h-9 cursor-pointer list-none items-center gap-1.5 rounded-lg pr-2",
          "text-xs font-medium text-muted transition hover:text-ink",
          "[&::-webkit-details-marker]:hidden",
        )}
      >
        <HelpCircle size={13} className="shrink-0" />
        {title}
        <ChevronDown size={13} aria-hidden className="shrink-0 transition group-open:rotate-180" />
      </summary>

      {/* text-left is not decoration: a centred ancestor - the pricing hero is
          one - would otherwise centre several lines of explanation, which is
          the exact thing this component exists to stop. */}
      <div className="mt-1.5 rounded-lg border border-line bg-raised/60 px-3 py-2.5 text-left text-xs leading-relaxed text-muted">
        {children}
      </div>
    </details>
  );
}
