import { cx } from "@/components/ui";
import { fmtNumber } from "@/lib/format";

export type UsageDay = { date: string; manual: number; tracking: number };

/**
 * One day of calls. The daily tally table this used to read is gone - the
 * credit ledger already records every chargeable call with its timestamp - so
 * callers fold the ledger into this shape and the row type lives here.
 */
export type UsageDayRow = {
  usage_date: string;
  manual_searches: number;
  tracking_queries: number;
};

/**
 * Fill in the days with no usage row so the chart shows real gaps instead of
 * silently compressing quiet days together.
 */
export function buildUsageSeries(rows: UsageDayRow[], days: number): UsageDay[] {
  const byDate = new Map(rows.map((row) => [row.usage_date, row]));
  const series: UsageDay[] = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(Date.now() - i * 86_400_000).toLocaleDateString("en-CA", {
      timeZone: "Asia/Kolkata",
    });
    const row = byDate.get(date);
    series.push({
      date,
      manual: row?.manual_searches ?? 0,
      tracking: row?.tracking_queries ?? 0,
    });
  }
  return series;
}

/** Stacked daily bars: tracking queries under manual searches. No JS needed. */
export function UsageChart({ series }: { series: UsageDay[] }) {
  const peak = Math.max(1, ...series.map((day) => day.manual + day.tracking));
  const totalManual = series.reduce((sum, day) => sum + day.manual, 0);
  const totalTracking = series.reduce((sum, day) => sum + day.tracking, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs">
        <span className="flex items-center gap-1.5 text-muted">
          <span className="inline-block size-2 rounded-sm bg-brand-500" />
          Manual searches
          <span className="font-medium tabular-nums text-ink">{fmtNumber(totalManual)}</span>
        </span>
        <span className="flex items-center gap-1.5 text-muted">
          <span className="inline-block size-2 rounded-sm bg-good-500" />
          Tracking queries
          <span className="font-medium tabular-nums text-ink">{fmtNumber(totalTracking)}</span>
        </span>
      </div>

      <div className="flex h-32 items-end gap-1">
        {series.map((day) => {
          const total = day.manual + day.tracking;
          const height = total === 0 ? 2 : Math.max((total / peak) * 100, 4);
          const manualShare = total === 0 ? 0 : (day.manual / total) * 100;

          return (
            <div
              key={day.date}
              className="group relative flex flex-1 flex-col justify-end"
              title={`${day.date}\n${day.manual} manual, ${day.tracking} tracking`}
            >
              <div
                className={cx(
                  "flex w-full flex-col overflow-hidden rounded-sm transition",
                  total === 0 && "bg-sunken",
                )}
                style={{ height: `${height}%` }}
              >
                {total > 0 ? (
                  <>
                    <div className="w-full bg-brand-500" style={{ height: `${manualShare}%` }} />
                    <div className="w-full flex-1 bg-good-500/80" />
                  </>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 flex justify-between text-[11px] text-faint">
        <span>{series[0]?.date.slice(5)}</span>
        <span>{series[series.length - 1]?.date.slice(5)}</span>
      </div>
    </div>
  );
}
