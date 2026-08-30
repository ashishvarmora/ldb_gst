import { Skeleton } from "@/components/Skeleton";

/**
 * Mirrors the real page: one header card, the alerts panel, then a short stack
 * of closed sections. A skeleton in a different shape makes the page visibly
 * rearrange itself as it loads, which reads as a glitch.
 */
export default function TruckDetailLoading() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-3 w-28" />

      <section className="panel p-4">
        <Skeleton className="h-6 w-44" />
        <Skeleton className="mt-2 h-2.5 w-56 max-w-full" />
        <Skeleton className="mt-3 h-24 w-full rounded-xl" />
        <div className="mt-3 flex gap-2">
          <Skeleton className="h-9 w-40 rounded-lg" />
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>
      </section>

      <section className="panel overflow-hidden">
        <div className="border-b border-line/70 px-5 py-3.5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-2 h-2.5 w-64 max-w-full" />
        </div>
        <div className="p-4">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="mt-3 h-14 w-full rounded-xl" />
        </div>
      </section>

      {Array.from({ length: 4 }, (_, i) => (
        <section key={i} className="panel flex items-center gap-3 px-4 py-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-2 h-2.5 w-48 max-w-full" />
          </div>
          <Skeleton className="size-4 shrink-0 rounded" />
        </section>
      ))}
    </div>
  );
}
