import { Skeleton, SkeletonPanel, SkeletonStatCards, SkeletonTimeline } from "@/components/Skeleton";

/**
 * Mirrors the real page: the route first and full width, the summary strip
 * under it, then what to do next. A skeleton in a different shape makes the
 * page visibly rearrange as it loads, which reads as a glitch.
 */
export default function SearchResultLoading() {
  return (
    <>
      <Skeleton className="mb-3 h-3 w-36" />

      <div className="mb-4 flex items-center justify-between gap-3">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      <section className="panel mb-4 overflow-hidden">
        <div className="border-b border-line/70 px-5 py-3.5">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-2.5 w-72 max-w-full" />
        </div>
        <div className="p-5">
          <SkeletonTimeline items={7} />
        </div>
      </section>

      <SkeletonStatCards count={4} />

      <div className="mt-4">
        <SkeletonPanel rows={3} />
      </div>
    </>
  );
}
