import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

export default function AlertLogLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <SkeletonStatCards count={3} />
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-56 rounded-lg" />
        <Skeleton className="h-10 w-52 rounded-lg" />
        <Skeleton className="h-10 w-44 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
      <SkeletonPanel rows={6} title={false} />
    </>
  );
}
