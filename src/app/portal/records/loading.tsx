import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

export default function RecordsLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatCards />
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-10 w-44 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 flex-1 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        <div className="xl:col-span-3">
          <SkeletonPanel rows={8} title={false} />
        </div>
        <div className="space-y-5">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={2} />
        </div>
      </div>
    </>
  );
}
