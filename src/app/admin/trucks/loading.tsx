import { Skeleton, SkeletonPageHeader, SkeletonPanel, SkeletonStatCards } from "@/components/Skeleton";

export default function AdminSectionLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <SkeletonStatCards />
      <div className="mb-4 flex flex-wrap gap-2">
        <Skeleton className="h-10 w-56 rounded-lg" />
        <Skeleton className="h-10 w-40 rounded-lg" />
        <Skeleton className="h-10 w-24 rounded-lg" />
      </div>
      <SkeletonPanel rows={6} title={false} />
    </>
  );
}
