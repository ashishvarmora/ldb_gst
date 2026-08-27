import { SkeletonPageHeader, SkeletonStatCards, SkeletonTruckCards } from "@/components/Skeleton";

export default function TrucksLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatCards count={3} />
      <SkeletonTruckCards count={6} />
    </>
  );
}
