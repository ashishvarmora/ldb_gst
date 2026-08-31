import { Skeleton, SkeletonPageHeader } from "@/components/Skeleton";

export default function PlansLoading() {
  return (
    <>
      <SkeletonPageHeader />

      {/* The public plan page preview, then the admin cards below it. */}
      <div className="panel mb-6 overflow-hidden">
        <div className="border-b border-line/70 px-5 py-3.5">
          <Skeleton className="h-3 w-48" />
          <Skeleton className="mt-2 h-2.5 w-64" />
        </div>
        <div className="grid grid-cols-1 gap-4 px-5 py-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {Array.from({ length: 3 }, (_, i) => (
            <Skeleton key={i} className="h-52 rounded-xl" />
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="panel overflow-hidden">
            <div className="border-b border-line/70 px-5 py-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-2.5 w-48" />
            </div>
            <div className="space-y-3 px-5 py-4">
              {Array.from({ length: 4 }, (_, r) => (
                <Skeleton key={r} className="h-2.5 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
