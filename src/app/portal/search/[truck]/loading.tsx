import { Skeleton, SkeletonTimeline } from "@/components/Skeleton";

/**
 * Mirrors the real page: plate and chips, the action row, the last-seen card,
 * the route, then the stats strip. A skeleton in a different shape makes the
 * page visibly rearrange as it loads, which reads as a glitch.
 */
export default function SearchResultLoading() {
  return (
    <>
      <Skeleton className="mb-3 h-3 w-36" />

      <Skeleton className="h-8 w-52 max-w-full" />
      <div className="mt-2 flex gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="mt-2 h-2.5 w-28" />

      <div className="mt-4 mb-6 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-20 rounded-full" />
        <Skeleton className="h-10 w-36 rounded-full" />
        <Skeleton className="h-10 w-40 rounded-full" />
        <Skeleton className="h-10 w-40 rounded-full" />
      </div>

      <div className="mb-4 rounded-xl border border-line p-4 sm:p-5">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-2 h-6 w-60 max-w-full" />
        <Skeleton className="mt-3 h-3 w-72 max-w-full" />
        <Skeleton className="mt-3 h-10 w-24 rounded-full" />
      </div>

      <section className="panel mb-4 overflow-hidden">
        <div className="border-b border-line/70 px-5 py-3.5">
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="p-5">
          <SkeletonTimeline items={6} />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="px-4 py-3">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="mt-2 h-4 w-12" />
          </div>
        ))}
      </div>
    </>
  );
}
