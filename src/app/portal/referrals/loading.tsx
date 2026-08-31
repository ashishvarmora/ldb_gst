import { Skeleton, SkeletonPageHeader, SkeletonStatCards } from "@/components/Skeleton";

/**
 * Mirrors the page: link panel, the four counts, then the list of people. The
 * milestone panel is left out because it may not be configured, and a
 * placeholder for something that never arrives is worse than a shorter wait.
 */
export default function ReferralsLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />

      <section className="panel mb-4 overflow-hidden">
        <div className="border-b border-line/70 px-5 py-3.5">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="mt-2 h-2.5 w-72 max-w-full" />
        </div>
        <div className="p-5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-2 h-10 w-full rounded-lg" />
          <div className="mt-2.5 flex gap-2">
            <Skeleton className="h-10 w-32 rounded-lg" />
            <Skeleton className="h-10 w-24 rounded-lg" />
          </div>
        </div>
      </section>

      <SkeletonStatCards />

      <section className="panel overflow-hidden">
        <div className="border-b border-line/70 px-5 py-3.5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-2 h-2.5 w-64 max-w-full" />
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
