import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

/**
 * The usage report's shape while it loads: header, the date bar, six headline
 * figures, then a chart beside a breakdown and a stack of link cards.
 */
export default function UsageLoading() {
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
        <div className="xl:col-span-2">
          <SkeletonPanel rows={6} />
        </div>
        <div className="space-y-5">
          <SkeletonPanel rows={3} />
          <SkeletonPanel rows={2} title={false} />
        </div>
      </div>
    </>
  );
}
