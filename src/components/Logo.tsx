import { cx } from "@/components/ui";

/**
 * The mark.
 *
 * It was a stock lorry glyph, which said "trucks" and nothing else - every
 * fleet product on the market wears one, and at 16px in a tab strip it is a
 * grey smudge. What this platform actually does is watch a vehicle pass fixed
 * points on a road, so the mark is the road: a carriageway in perspective,
 * its lane dashes shortening towards the distance, and one ring where the
 * vehicle was last seen.
 *
 * Drawn geometrically rather than as a picture so it survives being small.
 * Three tapering dashes and a ring still read at 16px; a windscreen and wing
 * mirrors do not.
 *
 * Colour comes from `currentColor` throughout, so the same file serves the
 * light header, the dark footer and a monochrome favicon without a second
 * copy existing to fall out of step.
 */
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cx("shrink-0", className)}
    >
      {/* The carriageway, wide at the reader and narrowing into the distance.
          Deliberately broad at the base: the first draft tapered from 5.2 and
          at 17px in a badge it read as a thin obelisk rather than a road. The
          wider it opens towards the reader, the faster perspective registers. */}
      <path
        d="M3.4 21.6 L9.7 7.4 h4.6 L20.6 21.6 Z"
        fill="currentColor"
        fillOpacity="0.18"
      />
      {/* Its edges, so the shape holds when the fill is nearly invisible. */}
      <path
        d="M3.4 21.6 L9.7 7.4 M20.6 21.6 L14.3 7.4"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />
      {/* Lane dashes. Each is shorter and thinner than the one before it, which
          is what makes a flat shape read as distance rather than a triangle. */}
      <path
        d="M12 20.6 v-3 M12 15.6 v-2.2 M12 11.5 v-1.5"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeOpacity="0.9"
      />
      {/* Where it was last seen. */}
      <circle cx="12" cy="4.8" r="3" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="12" cy="4.8" r="1.05" fill="currentColor" />
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
