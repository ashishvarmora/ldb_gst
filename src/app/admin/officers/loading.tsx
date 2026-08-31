import { Skeleton, SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";

export default function AccountsLoading() {
  return (
    <>
      <SkeletonPageHeader />
      {/* search, status, plan, sort, apply */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-10 flex-1 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-48 rounded-lg" />
        <Skeleton className="h-10 w-52 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
      <SkeletonPanel rows={8} title={false} />
      <div className="mt-3 flex items-center justify-between gap-3">
        <Skeleton className="h-2.5 w-40" />
        <Skeleton className="h-9 w-48 rounded-lg" />
      </div>
    </>
  );
}
