import { Skeleton, SkeletonPageHeader } from "@/components/Skeleton";

/**
 * Mirrors the page: the sibling links, the balance line, the two-up side
 * switch, then the ledger panel - one control row, a two-column totals strip
 * and the rows.
 *
 * Two columns, not three. The totals strip on this page never carries both
 * "Credits added" and "Credits used" - each side drops the one that cannot
 * move - and a three-column placeholder would resolve into two and visibly
 * shift the divider under the reader's eye.
 *
 * Hand-rolled rather than SkeletonPanel for the same reason the activity page's
 * is: this panel leads with a control row and a totals strip before its first
 * row, and a skeleton with the wrong shape is worse than none, because the page
 * rearranges itself the moment the ledger lands.
 */
export default function CreditHistoryLoading() {
  return (
    <>
      <SkeletonPageHeader />

      <div className="space-y-3">
        <div className="flex gap-1.5">
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-line bg-panel px-4 py-3">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="h-5 w-16" />
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-raised p-1">
          {[0, 1].map((i) => (
            <div key={i} className="flex min-h-11 flex-col items-center justify-center gap-1.5">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-2 w-16" />
            </div>
          ))}
        </div>

        <section className="panel overflow-hidden">
          <div className="border-b border-line/70 px-4 py-3.5 sm:px-5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-2 h-2.5 w-64 max-w-full" />
          </div>

          {/* The shape note where the group-by chips would be, and the sort
              button at the far end - square-cornered and 36px, like the real
              one. */}
          <div className="space-y-2 border-b border-divider px-4 py-3">
            <div className="flex items-center gap-1.5">
              <Skeleton className="h-2.5 w-28" />
              <Skeleton className="ml-auto h-9 w-24 rounded-lg" />
            </div>
            <div className="flex gap-1.5">
              <Skeleton className="h-9 w-28 shrink-0 rounded-full" />
              <Skeleton className="h-9 w-24 shrink-0 rounded-full" />
            </div>
          </div>

          <div className="grid grid-cols-2 divide-x divide-divider border-b border-divider bg-raised/40">
            {[0, 1].map((i) => (
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
      </div>
    </>
  );
}
