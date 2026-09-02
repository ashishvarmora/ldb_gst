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
        <div className="divide-y divide-divider">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-40 max-w-full" />
                <Skeleton className="mt-2 h-2.5 w-24" />
              </div>
              <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
              <Skeleton className="hidden h-3 w-16 shrink-0 sm:block" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
