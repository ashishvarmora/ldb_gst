import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

export default function ExploreLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <div className="mb-6 flex flex-wrap gap-2">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-28 rounded-lg" />
      </div>
      <SkeletonStatCards />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SkeletonPanel rows={5} />
        <SkeletonPanel rows={5} />
      </div>
    </>
  );
}
