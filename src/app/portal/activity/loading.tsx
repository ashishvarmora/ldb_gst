import { Skeleton, SkeletonPageHeader } from "@/components/Skeleton";

/**
 * Mirrors the page: three credit tiles, the two folded help notes, then the
 * ledger panel - its header, the group-by row, the row of filter pills, the
 * three totals and the charges.
 *
 * Hand-rolled rather than assembled from SkeletonStatCards and SkeletonPanel,
 * because neither draws the shape this page actually has: the tiles are a
 * three-column grid here, not two, and the panel leads with two rows of
 * controls and a totals strip above its first row. A skeleton with the wrong
 * shape is worse than no skeleton, because the page visibly rearranges itself
 * the moment the ledger arrives.
 */
export default function ActivityLoading() {
  return (
    <>
      <SkeletonPageHeader />

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-line bg-panel px-3 py-2.5">
            <Skeleton className="h-2.5 w-20 max-w-full" />
            <Skeleton className="mt-2 h-5 w-12" />
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        <Skeleton className="h-3 w-56 max-w-full" />
        <Skeleton className="h-3 w-48 max-w-full" />
      </div>

      <section className="panel mt-3 overflow-hidden">
        <div className="border-b border-line/70 px-4 py-3.5 sm:px-5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-2.5 w-64 max-w-full" />
        </div>

        {/* The two control rows: the group-by chips with the sort button at the
            far end, then the filter pills. The sort block is square-cornered and
            36px like the real one, because a round 32px placeholder there would
            visibly change shape and shift the row when the ledger lands. */}
        <div className="space-y-2 border-b border-divider px-4 py-3">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-8 w-16 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-full" />
            <Skeleton className="ml-auto h-9 w-24 rounded-lg" />
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-9 w-28 shrink-0 rounded-full" />
            <Skeleton className="h-9 w-24 shrink-0 rounded-full" />
            <Skeleton className="h-9 w-24 shrink-0 rounded-full" />
          </div>
        </div>

        <div className="grid grid-cols-3 divide-x divide-divider border-b border-divider bg-raised/40">
          {[0, 1, 2].map((i) => (
            <div key={i} className="px-4 py-2.5">
              <Skeleton className="h-2 w-16 max-w-full" />
              <Skeleton className="mt-2 h-3 w-10" />
            </div>
          ))}
        </div>

        <div className="divide-y divide-divider">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-9 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="mt-2 h-2.5 w-1/2" />
              </div>
              <Skeleton className="h-3 w-14 shrink-0" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
