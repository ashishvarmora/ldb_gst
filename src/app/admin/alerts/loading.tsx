import { Skeleton, SkeletonPageHeader, SkeletonStatCards } from "@/components/Skeleton";

export default function AlertRulesLoading() {
  return (
    <>
      <SkeletonPageHeader actions={2} />
      <SkeletonStatCards />
      <div className="space-y-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="panel overflow-hidden">
            <div className="px-5 py-4">
              <Skeleton className="h-4 w-52" />
              <Skeleton className="mt-2.5 h-2.5 w-full max-w-xl" />
            </div>
            <div className="flex gap-2 border-t border-line/70 px-5 py-3">
              <Skeleton className="h-9 w-20 rounded-lg" />
              <Skeleton className="h-9 w-16 rounded-lg" />
              <Skeleton className="h-9 w-16 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
