import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
  SkeletonTimeline,
} from "@/components/Skeleton";

export default function SearchResultLoading() {
  return (
    <>
      <Skeleton className="mb-4 h-3 w-36" />
      <SkeletonPageHeader actions={2} />
      <SkeletonStatCards />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <section className="panel p-5">
            <Skeleton className="mb-4 h-3 w-24" />
            <SkeletonTimeline items={6} />
          </section>
        </div>
        <SkeletonPanel rows={3} />
      </div>
    </>
  );
}
