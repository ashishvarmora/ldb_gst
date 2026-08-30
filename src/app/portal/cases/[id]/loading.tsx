import { Skeleton, SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";

export default function CaseDetailLoading() {
  return (
    <>
      <Skeleton className="mb-4 h-3 w-24" />
      <SkeletonPageHeader actions={3} />
      <Skeleton className="mb-4 h-2.5 w-64 max-w-full" />
      <div className="space-y-4">
        <SkeletonPanel rows={4} />
        <section className="panel flex items-center gap-3 px-4 py-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-40" />
            <Skeleton className="mt-2 h-2.5 w-56 max-w-full" />
          </div>
          <Skeleton className="size-4 shrink-0 rounded" />
        </section>
      </div>
    </>
  );
}
