import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

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
