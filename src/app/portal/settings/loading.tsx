import { SkeletonPageHeader, SkeletonPanel } from "@/components/Skeleton";

/**
 * Mirrors the shape of page.tsx, which it had stopped doing: this drew four
 * panels in two even columns for a page that has two panels and a shut
 * dropdown. A skeleton that promises more blocks than arrive is a page that
 * visibly rearranges itself the moment it loads.
 *
 * Alerts left, profile right, the folded backup row spanning underneath - and
 * the backup row is `rows={0}`, which renders the panel's header and nothing
 * else, because a Disclosure that starts shut is one row tall.
 */
export default function PortalSettingsLoading() {
  return (
    <>
      <SkeletonPageHeader actions={0} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start">
        <SkeletonPanel rows={4} />
        <SkeletonPanel rows={3} />
        <div className="lg:col-span-2">
          <SkeletonPanel rows={0} />
        </div>
      </div>
    </>
  );
}
