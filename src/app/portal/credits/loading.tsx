import { Skeleton } from "@/components/Skeleton";

/**
 * Mirrors the page: the sibling links, the balance line, the two-up side
 * switch, then the ledger panel - the filter row, the totals line, the column
 * headings and the rows.
 *
 * ONE figure, not two, and not the three it was before that. The strip on this
 * page carries a single credits figure - each side drops the column that cannot
 * move, and the entry count sits at the far end of the same line (see Totals in
 * CreditLedger) - so a two-figure placeholder would resolve into one and
 * visibly shift the row under the reader's eye.
 *
 * Hand-rolled rather than SkeletonPanel for the same reason the activity page's
 * is: this panel leads with a control row, a totals line and a heading row
 * before its first row, and a skeleton with the wrong shape is worse than none,
 * because the page rearranges itself the moment the ledger lands.
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

          {/* The filter pills, and nothing above them. Both mounts here pin
              what a row is, so there are no group-by switches, and the sort
              that used to sit alone on a row of its own is on the column
              headings below - so the whole first band of this panel is one row
              of pills at 36px inside 16px of padding. */}
          <div className="border-b border-divider px-4 py-2">
            <div className="flex gap-1.5">
              <Skeleton className="h-9 w-28 shrink-0 rounded-full" />
              <Skeleton className="h-9 w-24 shrink-0 rounded-full" />
            </div>
          </div>

          {/* The totals, on one baseline: a label, its figure, and the entry
              count at the far end. 37px either side of the ledger arriving,
              where the tile-and-caption card it replaced was 87px. */}
          <div className="flex items-center gap-4 border-b border-divider bg-raised/40 px-4 py-2">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3.5 w-10" />
            <Skeleton className="ml-auto h-3 w-20 max-w-full" />
          </div>

          {/* The column headings, which are also the sort. One 40px band,
              because each heading is a thumb-sized target. */}
          <div className="flex h-10 items-center gap-3 border-b border-divider px-4">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="ml-auto h-3 w-16" />
            <span aria-hidden className="w-4 shrink-0" />
          </div>

          {/* ONE LINE A ROW, at 40px. Credits added is the side this page
              opens on and it is the raw ledger, so a row is a reason, a
              stamp, a figure and the chevron that opens the rest - not the
              two-line block with a sign badge the grouped side draws. Drawing
              that here would resolve 21px shorter per row, which over eight
              rows is the whole panel jumping. */}
          <div className="divide-y divide-divider">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className="flex h-10 items-center gap-2 px-4">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="ml-auto h-2.5 w-20 shrink-0" />
                <Skeleton className="h-3.5 w-8 shrink-0" />
                <Skeleton className="size-4 shrink-0 rounded" />
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
