import {
  SkeletonChart,
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
} from "@/components/Skeleton";

/** The admin overview pulls six aggregates; show its shape while they land. */
export default function AdminLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <SkeletonStatCards count={6} />
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <section className="panel p-5">
            <SkeletonChart />
          </section>
          <SkeletonPanel rows={5} />
        </div>
        <div className="space-y-5">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={3} />
        </div>
      </div>
    </>
  );
}
