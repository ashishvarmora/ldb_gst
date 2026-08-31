import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
} from "@/components/Skeleton";

export default function AccountDetailLoading() {
  return (
    <>
      <Skeleton className="mb-4 h-3 w-28" />
      <SkeletonPageHeader actions={2} />

      {/* the badge row */}
      <div className="mb-5 flex flex-wrap gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-24 rounded-full" />
        ))}
      </div>

      <SkeletonStatCards />

      {/* the tab strip */}
      <div className="mb-5 flex gap-1 border-b border-divider pb-2">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-lg" />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SkeletonPanel rows={5} />
          <SkeletonPanel rows={3} />
        </div>
        <div className="space-y-5">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={3} />
        </div>
      </div>
    </>
  );
}
