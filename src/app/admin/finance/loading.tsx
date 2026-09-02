import {
  Skeleton,
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
} from "@/components/Skeleton";

/**
 * The Finance report's shape while it loads: header, the section tabs, the date
 * bar, five headline figures, then the wide grouped table beside a stack of
 * breakdowns.
 *
 * The wide side is deliberately one tall panel rather than two short ones. It
 * now holds a grouped table with its own controls above it, and a skeleton that
 * suggested two small panels made the whole column visibly re-shuffle the
 * moment the queries landed - which is the jump these files exist to prevent.
 */
export default function FinanceLoading() {
  return (
    <>
      <SkeletonPageHeader actions={1} />

      {/* The section tabs, then the range presets. Two rows, because that is
          what the real screen has above the first figure. */}
      <div className="mb-5 flex flex-wrap gap-1.5 border-b border-divider pb-2">
        {["w-20", "w-28", "w-20"].map((width, i) => (
          <Skeleton key={i} className={`h-9 rounded-lg ${width}`} />
        ))}
      </div>

      <div className="mb-5 flex flex-wrap gap-1.5">
        {["w-16", "w-24", "w-28", "w-28", "w-24", "w-28", "w-20"].map((width, i) => (
          <Skeleton key={i} className={`h-9 rounded-lg ${width}`} />
        ))}
      </div>

      <SkeletonStatCards count={5} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <SkeletonPanel rows={8} />
          <SkeletonPanel rows={4} />
        </div>
        <div className="space-y-5">
          <SkeletonPanel rows={4} />
          <SkeletonPanel rows={3} />
        </div>
      </div>
    </>
  );
}
