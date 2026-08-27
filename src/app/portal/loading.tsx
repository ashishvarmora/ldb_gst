import {
  SkeletonPageHeader,
  SkeletonPanel,
  SkeletonStatCards,
} from "@/components/Skeleton";

/**
 * Shown the instant an officer taps a nav item, while the real page streams in
 * behind it. Without this the app looks frozen for the length of a database
 * round trip, which on a phone on mobile data is very noticeable.
 */
export default function PortalLoading() {
  return (
    <>
      <SkeletonPageHeader />
      <SkeletonStatCards />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
          <SkeletonPanel rows={4} />
        </div>
        <SkeletonPanel rows={3} />
      </div>
    </>
  );
}
