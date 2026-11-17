import { ChevronDown, ExternalLink, MapPin } from "lucide-react";

import { directionLabel } from "@/components/Timeline";
import { cx } from "@/components/ui";
import { fmtDate, fmtTime } from "@/lib/format";
import type { TruckEvent } from "@/lib/types";

import { fmtSpan, istDayKey, mapUrl, msBetween, plazaName } from "./result-utils";

/** Crossings shown open; the rest of the page folds behind one tap. */
const OPEN_ROWS = 25;

type Row = { event: TruckEvent; gap: string | null; prevPlaza: string | null };

/**
 * The route, newest first, grouped by IST day. Each crossing says how long
 * after the previous (older) one it came, which is what tells a stop from a
 * straight run. `olderNeighbour` is the crossing just past the end of this
 * page, so the last row still gets its gap.
 */
export function RouteTimeline({
  events,
  olderNeighbour,
  isFirstPage,
}: {
  events: TruckEvent[];
  olderNeighbour: TruckEvent | null;
  isFirstPage: boolean;
}) {
  const rows: Row[] = events.map((event, i) => {
    const older = events[i + 1] ?? olderNeighbour;
    const span = older ? msBetween(event.event_time, older.event_time) : null;
    return {
      event,
      gap: span === null ? null : fmtSpan(span),
      prevPlaza: older ? plazaName(older) : null,
    };
  });

  const head = rows.slice(0, OPEN_ROWS);
  const rest = rows.slice(OPEN_ROWS);

  return (
    <div className="space-y-4">
      <DayGroups rows={head} highlightFirst={isFirstPage} />
      {rest.length > 0 ? (
        <details className="group rounded-lg border border-line bg-raised/50">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm text-brand-500 [&::-webkit-details-marker]:hidden">
            Show {rest.length} earlier crossing{rest.length === 1 ? "" : "s"}
            <ChevronDown size={15} aria-hidden className="transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-divider bg-panel px-3 py-4">
            <DayGroups rows={rest} highlightFirst={false} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

function DayGroups({ rows, highlightFirst }: { rows: Row[]; highlightFirst: boolean }) {
  const groups: { key: string; rows: Row[] }[] = [];
  for (const row of rows) {
    const key = istDayKey(row.event.event_time);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(row);
    else groups.push({ key, rows: [row] });
  }

  const today = istDayKey(new Date().toISOString());
  const yesterday = istDayKey(new Date(Date.now() - 86_400_000).toISOString());

  return (
    <div className="space-y-5">
      {groups.map((group, g) => (
        <section key={`${group.key}-${g}`}>
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-xs font-semibold text-muted">
              {group.key === "unknown"
                ? "Undated"
                : group.key === today
                  ? `Today · ${fmtDate(group.rows[0].event.event_time)}`
                  : group.key === yesterday
                    ? `Yesterday · ${fmtDate(group.rows[0].event.event_time)}`
                    : fmtDate(group.rows[0].event.event_time)}
            </h3>
            <span className="h-px flex-1 bg-sunken" />
            <span className="text-xs text-faint">
              {group.rows.length} crossing{group.rows.length === 1 ? "" : "s"}
            </span>
          </div>

          <ol>
            {group.rows.map((row, index) => {
              const { event } = row;
              const isNewest = highlightFirst && g === 0 && index === 0;
              const isLast = index === group.rows.length - 1;
              const direction = directionLabel(event.direction);
              const map = mapUrl(event);

              return (
                <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                  <div className="flex flex-col items-center">
                    <span
                      className={cx(
                        "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
                        isNewest
                          ? "border-brand-500/50 bg-brand-500/15 text-brand-400"
                          : "border-line bg-raised text-faint",
                      )}
                    >
                      <MapPin size={12} />
                    </span>
                    {!isLast ? <span className="mt-1 w-px flex-1 bg-sunken" /> : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 text-sm font-medium break-words text-ink">
                        {plazaName(event)}
                      </p>
                      <span className="shrink-0 text-sm tabular-nums text-strong">
                        {fmtTime(event.event_time)}
                      </span>
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted">
                      {direction ? <span>{direction}</span> : null}
                      {direction && row.gap ? <span className="text-faint">·</span> : null}
                      {row.gap ? (
                        <span>
                          {row.gap} after {row.prevPlaza}
                        </span>
                      ) : null}
                      {map ? (
                        <>
                          {direction || row.gap ? <span className="text-faint">·</span> : null}
                          <a
                            href={map}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex min-h-6 items-center gap-1 text-brand-500 hover:underline"
                          >
                            Map
                            <ExternalLink size={10} />
                          </a>
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
