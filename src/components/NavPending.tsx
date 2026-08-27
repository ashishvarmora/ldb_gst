"use client";

import { useLinkStatus } from "next/link";

import { cx } from "@/components/ui";

/**
 * Immediate feedback on the item the user actually tapped.
 *
 * `loading.tsx` swaps the page body for a skeleton, but that only happens once
 * the router commits. On a slow connection there is a gap first where nothing
 * moves and people tap again. These render inside a <Link> and light up the
 * moment the navigation starts.
 */

/** Small spinner, for a sidebar row. */
export function NavSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        "ml-auto size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70",
        className,
      )}
    />
  );
}

/**
 * A bar that fills across the top of a bottom-nav tab. On a phone the tab is
 * the thing under the thumb, so that is where the feedback belongs.
 */
export function NavTabPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      aria-hidden
      className="absolute inset-x-3 top-0 h-0.5 origin-left animate-pulse rounded-full bg-brand-500"
    />
  );
}
