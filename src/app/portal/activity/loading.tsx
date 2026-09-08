import { Skeleton, SkeletonPageHeader } from "@/components/Skeleton";

/**
 * Mirrors the page: the sibling links, three credit tiles, the one folded help
 * note, then the ledger panel - its header, the group-by row, the row of
 * filter pills, the totals line, the column headings and the charges.
 *
 * ONE totals figure on ONE line. This page is spend-only, so the strip carries
 * "Credits used" and the charge count beside it rather than a second figure
 * reading the same number - see Totals in CreditLedger - and a two-column
 * placeholder would resolve into one and visibly shift the row.
 *
 * NO SPEND SPLIT. The proportion bar and its legend that used to sit under the
 * totals have gone from the page, so they have gone from here: a skeleton that
 * draws a band the page no longer has is the reflow this file exists to
 * prevent, pointing the other way.
 *
 * Hand-rolled rather than assembled from SkeletonStatCards and SkeletonPanel,
 * because neither draws the shape this page actually has: the tiles are a
 * three-column grid here, not two, and the panel leads with two rows of
 * controls, a totals line and a heading row above its first row. A skeleton
 * with the wrong shape is worse than no skeleton, because the page visibly
 * rearranges itself the moment the ledger arrives.
 */
export default function ActivityLoading() {
  return (
    <>
      <SkeletonPageHeader />

      <div className="mb-3 flex gap-1.5">
        <Skeleton className="h-9 w-32 rounded-full" />
        <Skeleton className="h-9 w-28 rounded-full" />
      </div>

      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border border-line bg-panel px-3 py-2.5">
            <Skeleton className="h-2.5 w-20 max-w-full" />
            <Skeleton className="mt-2 h-5 w-12" />
          </div>
        ))}
      </div>

      {/* One fold, one 36px summary row. The second note - the paragraph that
          taught the controls below it - has gone, and the switches and pills it
          described say it themselves. */}
      <div className="mt-3 flex h-9 items-center">
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>

      <section className="panel mt-3 overflow-hidden">
        {/* One bar, at the height of the <h2> it stands in for. The second was
            a panel description this mount no longer passes. */}
        <div className="border-b border-line/70 px-4 py-3.5 sm:px-5">
          <Skeleton className="h-5 w-32" />
        </div>

        {/* The two control rows: the group-by chips, then the filter pills.
            The sort control that used to sit at the far end of the first row
            has moved to the column headings below. */}
        <div className="border-b border-divider px-4 py-2">
          <div className="mb-2 flex items-center gap-1.5">
            {/* Wider than they were: each switch carries a tick or a plus now
                as well as its word. */}
            <Skeleton className="h-8 w-14 rounded-full" />
            <Skeleton className="h-8 w-16 rounded-full" />
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-9 w-28 shrink-0 rounded-full" />
            <Skeleton className="h-9 w-24 shrink-0 rounded-full" />
            <Skeleton className="h-9 w-24 shrink-0 rounded-full" />
          </div>
        </div>

        {/* The totals, on one baseline: a label, its figure, and the charge
            count at the far end. 37px either side of the ledger arriving. */}
        <div className="flex items-center gap-4 border-b border-divider bg-raised/40 px-4 py-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-3.5 w-10" />
          <Skeleton className="ml-auto h-3 w-24 max-w-full" />
        </div>

        {/* The column headings, which are also the sort. One 40px band,
            because each heading is a thumb-sized target. */}
        <div className="flex h-10 items-center gap-3 border-b border-divider px-4">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="ml-auto h-3 w-16" />
          <span aria-hidden className="w-4 shrink-0" />
        </div>

        {/* No sign badge: this mount is pinned to spending, so every row
            carries the same sign and the badge is not drawn - see RollupList. */}
        <div className="divide-y divide-divider">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-2">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="mt-1.5 h-2.5 w-1/2" />
              </div>
              <Skeleton className="h-3.5 w-10 shrink-0" />
              <Skeleton className="size-4 shrink-0 rounded" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
