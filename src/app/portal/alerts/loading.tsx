import { SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

export default function AlertsLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatCards count={3} />
      <SkeletonPanel rows={8} />
    </>
  );
}
