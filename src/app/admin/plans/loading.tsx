import { Skeleton, SkeletonPageHeader } from "@/components/Skeleton";

export default function PlansLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="panel overflow-hidden">
            <div className="border-b border-line/70 px-5 py-4">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-2.5 w-48" />
            </div>
            <div className="space-y-3 px-5 py-4">
              {Array.from({ length: 6 }, (_, r) => (
                <Skeleton key={r} className="h-2.5 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
