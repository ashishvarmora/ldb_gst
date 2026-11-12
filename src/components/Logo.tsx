import { cx } from "@/components/ui";

/** The approved standalone emblem, kept proportional at every header size. */
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <img src="/brand/rahdari-mark-v2.webp" alt="" aria-hidden="true" width={Math.round(size * 1752 / 897)} height={size}
      className={cx("shrink-0 object-contain", className)} />
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
  const glyph = size === "lg" ? 48 : size === "sm" ? 32 : 36;

  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center", className)}
    >
      <LogoMark size={glyph} />
    </span>
  );
}
