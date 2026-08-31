import { Skeleton, SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";

/**
 * Shown the instant Home is tapped, while the real page streams in behind it.
 * Without this the app looks frozen for the length of a database round trip,
 * which on a phone on mobile data is very noticeable.
 *
 * The shapes mirror the dashboard - credits panel, then plan and alerts side
 * by side - so nothing jumps when the data arrives.
 */
export default function PortalLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />

      <section className="panel mb-5 p-5">
        <Skeleton className="h-2.5 w-24" />
        <Skeleton className="mt-3 h-10 w-40" />
        <Skeleton className="mt-3 h-2.5 w-64 max-w-full" />
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-divider pt-4 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i}>
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="mt-2 h-5 w-14" />
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SkeletonPanel rows={3} />
        <SkeletonPanel rows={3} />
      </div>
    </>
  );
}
