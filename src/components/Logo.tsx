import { cx } from "@/components/ui";

/** Compact blue-and-orange R monogram from the dashboard reference. */
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 48" width={size} height={size} fill="none" aria-hidden="true" focusable="false" className={cx("shrink-0", className)}>
      <path d="M26 5h19c10 0 16 6 16 14 0 7-4 12-10 14l11 10H45L31 29h13c4 0 6-4 5-7-1-3-3-4-7-4H34L26 5Z" fill="#1558B8" />
      <path d="M7 24c2-3 4-5 8-5h22l-8 10H18L7 43H0L14 24H7Z" fill="#FF8515" />
      <path d="m28 5 8 13h8L36 5h-8Z" fill="#3896ED" />
      <path d="m20 33 8-10h10l-9 12c-3 4-7 6-12 6h-4l6-8h1Z" fill="#1558B8" />
    </svg>
  );
}

/**
 * The mark in its badge, which is how it appears everywhere except the favicon.
 *
 * One component rather than the same four utility classes copied into the
 * public header, the portal header, the footer and the sign-in card - where
 * they had already drifted by a border radius.
 */
export function LogoBadge({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const box = size === "lg" ? "size-12 rounded-2xl" : size === "sm" ? "size-8 rounded-xl" : "size-9 rounded-xl";
  const glyph = size === "lg" ? 26 : size === "sm" ? 17 : 19;

  return (
    <span
      className={cx(
        "inline-flex items-center justify-center border border-brand-500/30 bg-brand-500/12 text-brand-500",
        box,
        className,
      )}
    >
      <LogoMark size={glyph} />
    </span>
  );
}
