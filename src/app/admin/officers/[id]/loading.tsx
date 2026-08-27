import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
} from "@/components/Skeleton";

export default function OfficerDetailLoading() {
  return (
    <>
      <Skeleton className="mb-4 h-3 w-28" />
      <SkeletonPageHeader actions={2} />
      <SkeletonStatCards />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SkeletonPanel rows={6} />
          <SkeletonPanel rows={3} />
        </div>
        <div className="space-y-5">
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={4} />
        </div>
      </div>
    </>
  );
}
