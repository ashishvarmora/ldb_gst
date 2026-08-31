import { Skeleton, SkeletonPageHeader } from "@/components/Skeleton";
import { TABS } from "./TabStrip";

/**
 * One skeleton for four tabs. Which tab is opening is in the query string,
 * which a loading file does not get, so this draws what every tab has in
 * common - the header, the strip, and a block of panels - rather than guessing
 * at a shape and flashing the wrong one.
 */
export default function PlansAndCreditsLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />

      <div className="mb-5 flex gap-1 border-b border-divider pb-px">
        {TABS.map((tab) => (
          <Skeleton key={tab.key} className="h-9 w-32 rounded-t-lg" />
        ))}
      </div>

      <div className="space-y-4">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="panel overflow-hidden">
            <div className="border-b border-line/70 px-5 py-3.5">
              <Skeleton className="h-3 w-44" />
              <Skeleton className="mt-2 h-2.5 w-72" />
            </div>
            <div className="space-y-3 px-5 py-5">
              {Array.from({ length: 4 }, (_, r) => (
                <Skeleton key={r} className="h-2.5 w-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
