import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

/**
 * A report's shape while it loads: header, the section tabs, the date bar, a
 * row of headline figures, then a chart beside a breakdown. Close enough to
 * the real layout that nothing jumps when the queries land.
 */
export default function ReportLoading() {
  return (
    <>
      <SkeletonPageHeader actions={1} />

      <div className="mb-5 flex flex-wrap gap-1.5">
        {["w-16", "w-24", "w-28", "w-28", "w-24", "w-28", "w-20"].map((width, i) => (
          <Skeleton key={i} className={`h-9 rounded-lg ${width}`} />
        ))}
      </div>

      <SkeletonStatCards count={6} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SkeletonPanel rows={5} />
          <SkeletonPanel rows={6} />
        </div>
        <div className="space-y-5">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={4} />
        </div>
      </div>
    </>
  );
}
