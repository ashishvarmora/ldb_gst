import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
  SkeletonTimeline,
} from "@/components/Skeleton";

export default function CaseDetailLoading() {
  return (
    <>
      <Skeleton className="mb-4 h-3 w-24" />
      <SkeletonPageHeader actions={3} />
      <SkeletonStatCards />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <SkeletonPanel rows={3} />
        <div className="xl:col-span-2">
          <section className="panel p-5">
            <Skeleton className="mb-4 h-3 w-40" />
            <SkeletonTimeline items={5} />
          </section>
        </div>
      </div>
    </>
  );
}
