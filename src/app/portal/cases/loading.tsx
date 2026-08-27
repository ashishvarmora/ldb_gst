import { Skeleton, SkeletonPageHeader } from "@/components/Skeleton";

export default function CasesLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="panel p-4">
            <div className="flex gap-2.5">
              <Skeleton className="size-8 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3 w-40" />
                <Skeleton className="mt-2 h-2.5 w-24" />
              </div>
            </div>
            <Skeleton className="mt-3 h-2.5 w-full" />
            <div className="mt-3 border-t border-divider pt-2.5">
              <Skeleton className="h-2.5 w-20" />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
