import { Skeleton } from "@/components/Skeleton";

/**
 * Mirrors the page: the sibling links, the balance line, the two-up side
 * switch, then the ledger panel - one control row, a one-column totals strip
 * with its count line, and the rows.
 *
 * ONE column, not two, and not the three it was before that. The strip on this
 * page carries a single credits figure - each side drops the column that cannot
 * move, and the charge count that used to be a tile beside it is the caption
 * under it now (see Totals in CreditLedger) - so a wider placeholder would
 * resolve into one column and visibly shift the divider under the reader's eye.
 *
 * Hand-rolled rather than SkeletonPanel for the same reason the activity page's
 * is: this panel leads with a control row and a totals strip before its first
 * row, and a skeleton with the wrong shape is worse than none, because the page
 * rearranges itself the moment the ledger lands.
 */
export default function CreditHistoryLoading() {
  return (
    <>
      {/* Hand-rolled rather than SkeletonPageHeader, which always draws a
          subtitle bar and a button. This page has neither now - the subtitle
          went with the rest of the prose, and there was never an action here -
          so the shared one was promising 90px of furniture that resolves into
          a bare heading and shunts everything below it upwards. */}
      <div className="mb-5 sm:mb-6">
        <Skeleton className="h-6 w-44" />
      </div>

      <div className="space-y-2">
        <div className="flex gap-1.5">
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>

        {/* The (i) beside the label is a 28px circle, which is what sets this
            row's height rather than the figure - so it is drawn, or the card
            resolves eight pixels taller than its placeholder. */}
        <div className="flex items-center gap-2 rounded-xl border border-line bg-panel px-4 py-2">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="size-7 shrink-0 rounded-full" />
          <Skeleton className="ml-auto h-5 w-16 shrink-0" />
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-raised p-1">
          {[0, 1].map((i) => (
            <div key={i} className="flex min-h-10 flex-col items-center justify-center gap-1.5">
              <Skeleton className="h-2.5 w-24" />
              <Skeleton className="h-2 w-16" />
            </div>
          ))}
        </div>

        <section className="panel overflow-hidden">
          {/* One bar at the height of the <h2> it stands in for. There used to
              be a second under it for a panel description, which neither mount
              on this page passes any more - so it was 18px of furniture that
              resolved into nothing and pulled the ledger up as it went. */}
          <div className="border-b border-line/70 px-4 py-3.5 sm:px-5">
            <Skeleton className="h-5 w-28" />
          </div>

          {/* The sort button alone on the first row - both mounts here pin what
              a row is, so there are no group-by switches to draw. Square-
              cornered and 36px, like the real one. */}
          <div className="space-y-2 border-b border-divider px-4 py-3">
            <div className="flex items-center gap-1.5">
              <Skeleton className="ml-auto h-9 w-24 rounded-lg" />
            </div>
            <div className="flex gap-1.5">
              <Skeleton className="h-9 w-28 shrink-0 rounded-full" />
              <Skeleton className="h-9 w-24 shrink-0 rounded-full" />
            </div>
          </div>

          {/* Each bar stands in for the line box it replaces - 20px for the
              figure, 16px for the count line - so the strip is 87px either
              side of the ledger arriving rather than 73px and then 87px. */}
          <div className="border-b border-divider bg-raised/40">
            <div className="px-4 py-2.5">
              <Skeleton className="h-2.5 w-16 max-w-full" />
              <Skeleton className="mt-2 h-5 w-10" />
            </div>
            {/* The count line, which the placeholder used to leave out
                entirely - 29px of strip that appeared with the ledger. */}
            <div className="border-t border-divider px-4 py-1.5">
              <Skeleton className="h-4 w-28 max-w-full" />
            </div>
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
