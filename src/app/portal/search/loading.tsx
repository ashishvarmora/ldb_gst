import { SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";
import { Skeleton } from "@/components/Skeleton";

export default function SearchLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <section className="panel mb-5 p-5">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="mt-2 h-2.5 w-72 max-w-full" />
      </section>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SkeletonPanel rows={6} />
        </div>
        <SkeletonPanel rows={4} />
      </div>
    </>
  );
}
