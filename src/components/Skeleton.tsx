import { cx } from "@/components/ui";

/**
 * Placeholders shown while a page streams in. They mirror the real layout
 * closely enough that nothing jumps when the data arrives - a skeleton whose
 * shape is wrong is worse than a spinner, because the page visibly rearranges
 * itself the moment it loads.
 */

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cx("block animate-pulse rounded-md bg-sunken", className)}
    />
  );
}

export function SkeletonText({
  lines = 3,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <span aria-hidden className={cx("block space-y-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={cx("h-3", i === lines - 1 ? "w-2/3" : "w-full")}
        />
      ))}
    </span>
  );
}

export function SkeletonStatCards({ count = 4 }: { count?: number }) {
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel px-4 py-3.5">
          <Skeleton className="h-2.5 w-24" />
          <Skeleton className="mt-3 h-7 w-16" />
          <Skeleton className="mt-2.5 h-2 w-full" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonPanel({
  rows = 4,
  title = true,
}: {
  rows?: number;
  title?: boolean;
}) {
  return (
    <section className="panel overflow-hidden">
      {title ? (
        <div className="border-b border-line/70 px-5 py-3.5">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="mt-2 h-2.5 w-64" />
        </div>
      ) : null}
      <div className="divide-y divide-divider">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3.5">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="mt-2 h-2.5 w-1/2" />
            </div>
            <Skeleton className="h-3 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </section>
  );
}

export function SkeletonTruckCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="panel relative overflow-hidden pl-5">
          <span aria-hidden className="absolute inset-y-0 left-0 w-1.5 bg-sunken" />
          <div className="p-4 pl-3">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-16" />
            </div>
            <div className="mt-3 space-y-2 border-t border-divider pt-3">
              <Skeleton className="h-2.5 w-3/4" />
              <Skeleton className="h-2.5 w-1/2" />
            </div>
            <div className="mt-3 border-t border-divider pt-2.5">
              <Skeleton className="h-2 w-2/3" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ bars = 30 }: { bars?: number }) {
  // A fixed pseudo-random shape: real random would change on every render and
  // make the placeholder flicker between server and client.
  const heights = Array.from({ length: bars }, (_, i) => 25 + ((i * 37) % 70));
  return (
    <div aria-hidden>
      <div className="mb-3 flex gap-4">
        <Skeleton className="h-2.5 w-32" />
        <Skeleton className="h-2.5 w-32" />
      </div>
      <div className="flex h-32 items-end gap-1">
        {heights.map((h, i) => (
          <span
            key={i}
            className="flex-1 animate-pulse rounded-sm bg-sunken"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export function SkeletonTimeline({ items = 5 }: { items?: number }) {
  return (
    <div aria-hidden className="space-y-4">
      {Array.from({ length: items }, (_, i) => (
        <div key={i} className="flex gap-3">
          <div className="flex flex-col items-center">
            <Skeleton className="size-6 shrink-0 rounded-full" />
            {i < items - 1 ? <span className="mt-1 w-px flex-1 bg-divider" /> : null}
          </div>
          <div className="min-w-0 flex-1 pb-2">
            <Skeleton className="h-3 w-48" />
            <Skeleton className="mt-2 h-2.5 w-64" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Header block: title, subtitle, and a placeholder for the action buttons. */
export function SkeletonPageHeader({ actions = 1 }: { actions?: number }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2.5 h-3 w-80 max-w-full" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: actions }, (_, i) => (
          <Skeleton key={i} className="h-10 w-28 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
