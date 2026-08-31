import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

/**
 * Mirrors the page: four totals, the control group, then the feed. The rows are
 * two lines with a square on the left, which is what SkeletonPanel already
 * draws, so nothing jumps when the real entries arrive.
 */
export default function ActivityLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatCards />

      <div className="panel mb-4 overflow-hidden">
        <div className="flex items-center gap-2 border-b border-divider p-2">
          <Skeleton className="h-9 flex-1 rounded-lg" />
        </div>
        <div className="flex items-center gap-2 px-3 py-3.5">
          <Skeleton className="h-3 w-56 max-w-full" />
        </div>
      </div>

      <SkeletonPanel rows={8} />
    </>
  );
}
