import { Skeleton } from "@/components/Skeleton";

/**
 * The loading shape shared by Payments, Credits and Activity: title, one
 * summary line (or the three totals), the filters, then compact rows - the
 * same boxes the page draws, so nothing jumps when it arrives.
 */
export function HistorySkeleton({
  totals = false,
  segmented = true,
  toolbarRows = 1,
  rows = 6,
}: {
  totals?: boolean;
  /** The Added|Used or status segmented control (Credits, Payments). */
  segmented?: boolean;
  /** Rows of compact chips and selects under it (Activity has two). */
  toolbarRows?: number;
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
      {segmented ? <Skeleton className="h-[44px] w-full rounded-xl" /> : null}
      {Array.from({ length: toolbarRows }, (_, i) => (
        <div key={i} className="flex gap-2">
          <Skeleton className="h-9 w-36 rounded-full" />
          <Skeleton className="ml-auto h-9 w-32 rounded-[10px]" />
        </div>
      ))}
      <div className="hrow-list">
        {Array.from({ length: rows }, (_, i) => (
          <Skeleton key={i} className="h-[56px] w-full rounded-[14px]" />
        ))}
      </div>
    </div>
  );
}
