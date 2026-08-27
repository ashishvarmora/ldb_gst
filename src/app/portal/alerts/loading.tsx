import { SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

export default function AlertsLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatCards />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <SkeletonPanel rows={4} />
        <SkeletonPanel rows={5} />
      </div>
    </>
  );
}
