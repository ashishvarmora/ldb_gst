import { SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";

export default function PortalSettingsLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SkeletonPanel rows={3} />
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
