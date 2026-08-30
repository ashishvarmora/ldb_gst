import { SkeletonPageHeader, SkeletonTruckCards } from "@/components/Skeleton";

export default function TrucksLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonTruckCards count={6} />
    </>
  );
}
