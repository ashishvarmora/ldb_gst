import { SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";

export default function PortalSettingsLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Left: where alerts go, then where the history is kept. */}
        <div className="space-y-4">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={4} />
        </div>
        <div className="space-y-4">
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={4} />
        </div>
      </div>
    </>
  );
}
