import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

export default function RecordsLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <SkeletonStatCards />

      {/* The control group: view switch and export, then the collapsed filter line. */}
      <div className="panel mb-4 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-divider p-2">
          <Skeleton className="h-9 w-48 rounded-lg" />
          <Skeleton className="ml-auto h-9 w-16 rounded-lg" />
        </div>
        <div className="flex items-center gap-2 px-3 py-3.5">
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
      </div>

      <SkeletonPanel rows={6} title={false} />

      <div className="mt-5 space-y-3">
        <SkeletonPanel rows={2} />
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={3} />
        </div>
      </div>
    </>
  );
}
