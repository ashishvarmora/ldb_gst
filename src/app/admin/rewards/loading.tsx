import { SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

/**
 * The shape all four rewards views share: a row of figures, then one wide
 * table.
 *
 * Matching the real shape matters more than looking busy — a skeleton that
 * settles into a different layout reads as the page having jumped, which is
 * worse feedback than none. Four cards and a table is what every one of these
 * sections resolves to.
 *
 * This only covers arriving at /admin/rewards from elsewhere. Moving between
 * the four sections changes nothing but ?section=, and Next does not re-run a
 * loading.tsx for a query-string change — that navigation is reported by the
 * section tabs themselves, which light up the pill you tapped.
 */
export default function Loading() {
  return (
    <>
      <SkeletonStatCards count={4} />
      <div className="mt-5">
        <SkeletonPanel rows={8} />
      </div>
    </>
  );
}
