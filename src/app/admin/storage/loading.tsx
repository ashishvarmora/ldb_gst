import {
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
} from "@/components/Skeleton";

export default function AdminStorageLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatCards />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          {/* The retention editor, then the per-account sheet table. */}
          <SkeletonPanel rows={8} />
          <SkeletonPanel rows={6} />
        </div>
        <div className="space-y-5">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={4} />
        </div>
      </div>
    </>
  );
}
