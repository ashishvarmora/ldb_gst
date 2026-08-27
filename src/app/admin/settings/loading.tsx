import { SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";

export default function AdminSettingsLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SkeletonPanel rows={5} />
          <SkeletonPanel rows={2} />
        </div>
        <div className="space-y-5">
          <SkeletonPanel rows={5} />
          <SkeletonPanel rows={4} />
        </div>
      </div>
    </>
  );
}
