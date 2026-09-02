import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
} from "@/components/Skeleton";

/**
 * The Users report's shape while it loads: header, the date bar, six headline
 * figures, the sign-up table beside the lifecycle breakdown and its link cards,
 * then the full-width accounts table.
 *
 * The accounts table gets its own full-width panel here because that is where
 * it now sits. The previous skeleton stopped at the two-column grid, so the
 * longest thing on the page - twenty-five rows of accounts - appeared out of
 * nowhere and shoved the footer down as it arrived.
 */
export default function UsersLoading() {
  return (
    <>
      <SkeletonPageHeader actions={1} />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {["w-16", "w-24", "w-28", "w-28", "w-24", "w-28", "w-20"].map((width, i) => (
          <Skeleton key={i} className={`h-9 rounded-lg ${width}`} />
        ))}
      </div>

      <SkeletonStatCards count={6} />

      <div className="mb-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SkeletonPanel rows={6} />
        </div>
        <div className="space-y-5">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={2} title={false} />
        </div>
      </div>

      <SkeletonPanel rows={8} />
    </>
  );
}
