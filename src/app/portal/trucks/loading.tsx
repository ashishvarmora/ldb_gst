import { Skeleton, SkeletonPageHeader, SkeletonTruckCards } from "@/components/Skeleton";

export default function TrucksLoading() {
  return (
    <>
      <SkeletonPageHeader />
      {/* The filter row is part of the real page, so it is part of the
          placeholder too - otherwise the cards jump down as it appears. */}
      <div className="mb-4 flex gap-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-24 rounded-full" />
        ))}
      </div>
      <SkeletonTruckCards count={6} />
    </>
  );
}
