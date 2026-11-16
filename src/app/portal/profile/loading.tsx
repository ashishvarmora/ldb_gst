import { Skeleton, SkeletonPanel } from "@/components/Skeleton";

/**
 * Profile is one of the four tabs, and until now it borrowed the dashboard's
 * placeholder: a wide figure panel and two lists. The real screen is a title,
 * a centred avatar and a credit card, so the page visibly rearranged itself the
 * moment it arrived. This one has the screen's own shape, and the title is
 * real text because it never changes.
 */
export default function ProfileLoading() {
  return (
    <div className="app-profile" aria-busy="true">
      <header className="app-profile-heading">
        <div>
          <p>Account</p>
          <h1>Profile</h1>
        </div>
      </header>

      <div className="flex flex-col items-center pt-2 pb-6">
        <Skeleton className="size-20 rounded-[26px]" />
        <Skeleton className="mt-4 h-5 w-36" />
        <Skeleton className="mt-2.5 h-3 w-48" />
        <Skeleton className="mt-4 h-8 w-20 rounded-full" />
      </div>

      <Skeleton className="mb-6 h-36 w-full rounded-[24px]" />

      <SkeletonPanel rows={4} title={false} />
    </div>
  );
}
