import { Skeleton, SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";

export default function SearchLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <section className="panel mb-4 p-5">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="mt-2 h-2.5 w-72 max-w-full" />
      </section>
      <SkeletonPanel rows={6} />
    </>
  );
}
