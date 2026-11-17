import { Skeleton, SkeletonStatCards } from "@/components/Skeleton";

/**
 * Mirrors the page: the blue offer card, the link with its two buttons, the
 * three steps, the four counts, then the list of people. The milestone panel is
 * left out because it may not be configured, and a placeholder for something
 * that never arrives is worse than a shorter wait.
 */
export default function ReferralsLoading() {
  return (
    <>
      <section className="invite-card mb-3 rounded-[20px] bg-navy px-5 py-5">
        <Skeleton className="h-5 w-56 max-w-full opacity-40" />
        <Skeleton className="mt-3 h-4 w-40 opacity-40" />
        <Skeleton className="mt-2 h-3 w-64 max-w-full opacity-30" />
      </section>

      <section className="panel mb-3 overflow-hidden">
        <div className="border-b border-line/70 px-4 py-3.5 sm:px-5">
          <Skeleton className="h-3.5 w-32" />
        </div>
        <div className="p-4 sm:p-5">
          <Skeleton className="h-10 w-full rounded-lg" />
          <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
            <Skeleton className="h-11 rounded-full" />
            <Skeleton className="h-11 rounded-full" />
          </div>
        </div>
      </section>

      <section className="panel mb-3 p-4 sm:p-5">
        <Skeleton className="h-3.5 w-28" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="mt-3 flex items-start gap-3">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="mt-2 h-2.5 w-56 max-w-full" />
            </div>
          </div>
        ))}
      </section>

      <SkeletonStatCards />

      <section className="panel overflow-hidden">
        <div className="border-b border-line/70 px-4 py-3.5 sm:px-5">
          <Skeleton className="h-3.5 w-40" />
        </div>
        <div className="divide-y divide-divider">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-36" />
                <Skeleton className="mt-2 h-2.5 w-56 max-w-full" />
              </div>
              <Skeleton className="h-5 w-16 shrink-0 rounded-full" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
