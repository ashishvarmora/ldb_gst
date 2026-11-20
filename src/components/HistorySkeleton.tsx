import { Skeleton } from "@/components/Skeleton";

/**
 * The loading shape shared by Payments, Credits and Activity: title, one
 * summary line (or the three totals), the filters, then compact rows - the
 * same boxes the page draws, so nothing jumps when it arrives.
 */
export function HistorySkeleton({
  totals = false,
  toolbar = true,
  rows = 6,
}: {
  totals?: boolean;
  toolbar?: boolean;
  rows?: number;
}) {
  return (
    <div className="ledger-page" aria-busy>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Skeleton className="size-[38px] rounded-xl" />
          <Skeleton className="h-6 w-32" />
        </div>
        <Skeleton className="h-10 w-20 rounded-lg" />
      </div>
      {totals ? <Skeleton className="h-[68px] w-full rounded-[14px]" /> : <Skeleton className="h-4 w-64 max-w-full" />}
      <Skeleton className="h-[50px] w-full rounded-[14px]" />
      {toolbar ? (
        <div className="flex gap-2">
          <Skeleton className="h-10 w-40 rounded-xl" />
          <Skeleton className="ml-auto h-10 w-28 rounded-xl" />
        </div>
      ) : null}
      <div className="hrow-list">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-[60px] w-full rounded-[14px]" />
        ))}
      </div>
    </div>
  );
}
