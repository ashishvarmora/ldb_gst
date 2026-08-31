import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

export default function CreditsLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatCards />

      {/* the two-conversion explainer */}
      <div className="panel mb-6 overflow-hidden">
        <div className="border-b border-line/70 px-5 py-3.5">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="mt-2 h-2.5 w-64" />
        </div>
        <div className="grid grid-cols-1 gap-3 px-5 py-5 lg:grid-cols-2">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      </div>

      {/* money -> credits: the pack ladder */}
      <div className="mb-6 space-y-3">
        <Skeleton className="h-3 w-40" />
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="panel px-4 py-4">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="mt-2 h-2.5 w-56" />
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {Array.from({ length: 4 }, (_, f) => (
                <Skeleton key={f} className="h-10 w-full rounded-lg" />
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* credits -> usage: the two-way rate editors */}
      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="panel overflow-hidden">
            <div className="border-b border-line/70 px-5 py-3.5">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="mt-2 h-2.5 w-48" />
            </div>
            <div className="space-y-4 px-5 py-5">
              <Skeleton className="h-10 w-full rounded-lg" />
              <div className="grid grid-cols-2 gap-2">
                <Skeleton className="h-12 rounded-lg" />
                <Skeleton className="h-12 rounded-lg" />
              </div>
              <Skeleton className="h-14 w-full rounded-lg" />
              <Skeleton className="h-24 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>

      <SkeletonPanel rows={5} />
    </>
  );
}
