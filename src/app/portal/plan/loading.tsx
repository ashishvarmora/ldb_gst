import { Skeleton, SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";

export default function PlanLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <SkeletonPanel rows={3} />
      <div className="my-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="panel p-4">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-3 h-6 w-24" />
            <Skeleton className="mt-3 h-2 w-full" />
          </div>
        ))}
      </div>
      <SkeletonPanel rows={5} />
    </>
  );
}
