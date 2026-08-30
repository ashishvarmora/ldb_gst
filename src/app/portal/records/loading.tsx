import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

export default function RecordsLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatCards />
      <div className="mb-4 flex flex-col gap-3">
        <Skeleton className="h-11 w-56 rounded-lg" />
        <div className="flex flex-wrap gap-2">
          <Skeleton className="h-10 w-full rounded-lg sm:w-48" />
          <Skeleton className="h-10 w-full rounded-lg sm:w-44" />
          <Skeleton className="h-10 w-full rounded-lg sm:w-40" />
          <Skeleton className="h-10 w-full rounded-lg sm:flex-1" />
        </div>
      </div>
      <SkeletonPanel rows={8} title={false} />
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SkeletonPanel rows={4} />
        <SkeletonPanel rows={2} />
      </div>
    </>
  );
}
