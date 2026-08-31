import { Skeleton } from "@/components/Skeleton";

/**
 * Mirrors the price list's shape: a centred heading, a row of plan cards, then
 * the credit ladder as flat rows. The header and footer are part of the page
 * rather than a layout, so a bar stands in for the header here - without it the
 * placeholder sits against the top of the window and the real page appears to
 * jump down when it arrives.
 */
export default function PricingLoading() {
  return (
    <div className="theme-light flex min-h-screen flex-col">
      <div className="flex items-center justify-between border-b border-line/70 px-4 py-3">
        <Skeleton className="h-8 w-36 rounded-xl" />
        <Skeleton className="h-9 w-28 rounded-lg" />
      </div>

      <main className="flex-1 px-4 py-10">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col items-center">
            <Skeleton className="h-8 w-64 max-w-full" />
            <Skeleton className="mt-3 h-3 w-full max-w-xl" />
            <Skeleton className="mt-2 h-3 w-2/3 max-w-md" />
          </div>

          <Skeleton className="mt-10 h-5 w-32" />
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="panel p-5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-2 h-2.5 w-40 max-w-full" />
                <Skeleton className="mt-4 h-8 w-28" />
                <div className="mt-4 space-y-2 border-t border-divider pt-4">
                  <Skeleton className="h-2.5 w-3/4" />
                  <Skeleton className="h-2.5 w-1/2" />
                </div>
              </div>
            ))}
          </div>

          <Skeleton className="mt-12 h-5 w-40" />
          <div className="mt-5 space-y-2.5">
            {Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="panel flex items-center justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-3.5 w-56 max-w-full" />
                  <Skeleton className="mt-2 h-2.5 w-24" />
                </div>
                <Skeleton className="h-3 w-24 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
