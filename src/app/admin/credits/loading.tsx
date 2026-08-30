import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

export default function CreditsLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatCards />
      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }, (_, i) => (
          <div key={i} className="panel overflow-hidden">
            <div className="border-b border-line/70 px-5 py-3.5">
              <Skeleton className="h-3 w-36" />
              <Skeleton className="mt-2 h-2.5 w-48" />
            </div>
            <div className="space-y-4 px-5 py-5">
              <Skeleton className="h-10 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          </div>
        ))}
      </div>
      <SkeletonPanel rows={5} />
    </>
  );
}
