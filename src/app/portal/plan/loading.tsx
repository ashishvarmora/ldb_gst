import { Skeleton, SkeletonPageHeader } from "@/components/Skeleton";

/**
 * Mirrors the page's own shape: one summary strip, one grid of cards, then the
 * folded sections as bare rows. Which of the two layouts loads is not known
 * yet, so this matches the parts they share.
 */
export default function PlanLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />

      <section className="panel mb-4 grid grid-cols-1 divide-y divide-divider sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="px-4 py-3.5">
            <Skeleton className="h-2.5 w-24" />
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-2.5 h-2.5 w-32" />
          </div>
        ))}
      </section>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="panel p-3">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-3 h-5 w-20" />
            <Skeleton className="mt-2 h-3 w-14" />
            <Skeleton className="mt-3 h-9 w-full rounded-lg" />
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-3">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="panel flex items-center gap-3 px-4 py-4">
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="mt-2 h-2.5 w-56 max-w-full" />
            </div>
            <Skeleton className="size-4 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </>
  );
}
