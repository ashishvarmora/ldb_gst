import { Skeleton, SkeletonPageHeader } from "@/components/Skeleton";

/**
 * The page's own shape: header with the export button, the range presets, three
 * figures, then the table.
 *
 * The three figures are a three-across grid rather than SkeletonStatCards' own
 * two-across one, because this page has three and a skeleton that lays out four
 * makes the whole strip re-shuffle the moment the query lands - the jump these
 * files exist to prevent.
 *
 * Nothing here stands in for the receipt panel. It only appears on arrival from
 * the payment window, it is the first thing on the page when it does, and a
 * skeleton block that is usually followed by nothing would push the real
 * content down and then snap it back on every ordinary visit.
 */
export default function PaymentsLoading() {
  return (
    <>
      <SkeletonPageHeader actions={1} />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {["w-16", "w-24", "w-28", "w-28", "w-24", "w-28", "w-20"].map((width, i) => (
          <Skeleton key={i} className={`h-9 rounded-lg ${width}`} />
        ))}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="panel px-4 py-3.5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-2.5 h-2.5 w-32" />
          </div>
        ))}
      </div>

      <section className="panel overflow-hidden">
        <div className="border-b border-line/70 px-4 py-3.5 sm:px-5">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="mt-2 h-2.5 w-64 max-w-full" />
        </div>
        {/*
          Two shapes, at the same breakpoint the real list switches on, and the
          phone shape is now the SHUT row rather than an open card.

          This drew four card-shaped blocks about 280px tall each, which is what
          the phone list used to resolve into. The rows fold now - see
          PaymentList - so a shut one is 62px: px-4 py-3 round a 38px two-line
          block, with the money and the chevron beside it. A skeleton still
          drawing cards would be off by more than three thousand pixels on one
          screen, and it would be wrong in the worst direction, resolving into
          something far shorter and snapping the whole list up under the
          reader's thumb. Eight of them fills about a screen of list, which is
          all a skeleton is for; the real page loads fifty.
        */}
        <div className="divide-y divide-divider md:hidden">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="border-l-2 border-l-line px-4 py-3">
              <div className="flex min-h-[38px] items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-32 max-w-full" />
                  <Skeleton className="mt-2 h-2.5 w-20" />
                </div>
                <Skeleton className="h-3.5 w-14 shrink-0" />
                <Skeleton className="size-4 shrink-0 rounded" />
              </div>
            </div>
          ))}
        </div>

        <div className="hidden divide-y divide-divider md:block">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-40 max-w-full" />
                <Skeleton className="mt-2 h-2.5 w-24" />
              </div>
              <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
              <Skeleton className="h-3 w-16 shrink-0" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
