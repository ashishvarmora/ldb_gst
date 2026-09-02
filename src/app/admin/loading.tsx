import {
  Skeleton,
  SkeletonChart,
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
} from "@/components/Skeleton";

/**
 * The overview's shape while its aggregates land: six headline figures, then
 * the chart and the report cards beside the attention list.
 *
 * SkeletonStatCards brings its own grid, so it is dropped straight in here
 * rather than wrapped in one. A grid inside a grid gave the outer one a single
 * child and therefore a single column, which on a phone crushed all six cards
 * into the left half of the screen with their contents spilling out - a
 * placeholder that rearranges the page the moment the data arrives is worse
 * than no placeholder at all.
 */
export default function AdminLoading() {
  return (
    <>
      <SkeletonPageHeader actions={2} />

      <SkeletonStatCards count={6} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <section className="panel overflow-hidden">
            <div className="border-b border-line/70 px-5 py-3.5">
              <Skeleton className="h-3 w-44" />
              <Skeleton className="mt-2 h-2.5 w-72 max-w-full" />
            </div>
            <div className="p-5">
              <SkeletonChart />
            </div>
          </section>

          {/* The four reports the overview links to. */}
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }, (_, i) => (
              <SkeletonLinkCard key={i} />
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <SkeletonPanel rows={5} />
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonLinkCard key={i} />
          ))}
        </div>
      </div>
    </>
  );
}

/** One of the cards that names a report and links to it. */
function SkeletonLinkCard() {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3.5">
      <Skeleton className="size-9 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-2 h-2.5 w-full" />
      </div>
    </div>
  );
}
