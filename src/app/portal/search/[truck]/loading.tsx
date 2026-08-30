import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
  SkeletonTimeline,
} from "@/components/Skeleton";

/**
 * Mirrors the real page: the route first and full width, the summary strip
 * under it, then the detail panels. A skeleton in a different shape makes the
 * page visibly rearrange as it loads, which reads as a glitch.
 */
export default function SearchResultLoading() {
  return (
    <>
      <Skeleton className="mb-4 h-3 w-36" />
      <SkeletonPageHeader actions={1} />

      <section className="panel mb-3 p-5">
        <Skeleton className="mb-4 h-3 w-24" />
        <SkeletonTimeline items={7} />
      </section>

      <SkeletonStatCards count={4} />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SkeletonPanel rows={6} />
        <SkeletonPanel rows={4} />
      </div>
    </>
  );
}
