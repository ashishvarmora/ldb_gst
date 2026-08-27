import { Skeleton, SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";

export default function OfficersLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
      <SkeletonPanel rows={6} title={false} />
    </>
  );
}
