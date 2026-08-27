import { ArrowDown, ExternalLink, MapPin } from "lucide-react";

import { Badge, EmptyState, Mono, cx } from "@/components/ui";
import { fmtDate, fmtRelative, fmtTime } from "@/lib/format";
import { stateFromLocation } from "@/lib/geo";
import type { TruckEvent } from "@/lib/types";

/** Compass letter -> words, because "N" alone reads as noise on a report. */
const DIRECTION_LABEL: Record<string, string> = {
  N: "North bound",
  S: "South bound",
  E: "East bound",
  W: "West bound",
  NE: "North-east bound",
  NW: "North-west bound",
  SE: "South-east bound",
  SW: "South-west bound",
};

export function directionLabel(direction: string | null | undefined): string | null {
  if (!direction) return null;
  const key = direction.trim().toUpperCase();
  return DIRECTION_LABEL[key] ?? direction;
}

function istDateKey(iso: string | null): string {
  if (!iso) return "unknown";
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * Toll crossings as a route, newest first, grouped by day. This is the view GST
 * officers actually read — a flat table of latitudes is not it.
 */
export function Timeline({ events }: { events: TruckEvent[] }) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No toll crossings on record"
        description="The portal only reports crossings from roughly the last week. If the truck has not passed a plaza recently there is nothing to show."
      />
    );
  }

  const groups: { date: string; events: TruckEvent[] }[] = [];
  for (const event of events) {
    const key = istDateKey(event.event_time);
    const last = groups[groups.length - 1];
    if (last && last.date === key) last.events.push(event);
    else groups.push({ date: key, events: [event] });
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div key={group.date}>
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-xs font-semibold tracking-wider text-ink-400 uppercase">
              {group.date === "unknown" ? "Undated" : fmtDate(group.events[0].event_time)}
            </h3>
            <span className="h-px flex-1 bg-ink-800" />
            <span className="text-xs text-ink-500">
              {group.events.length} crossing{group.events.length === 1 ? "" : "s"}
            </span>
          </div>

          <ol className="relative">
            {group.events.map((event, index) => {
              const state = stateFromLocation(event.loc_name);
              const isLast = index === group.events.length - 1;

              return (
                <li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
                  {/* Rail */}
                  <div className="flex flex-col items-center">
                    <span
                      className={cx(
                        "mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border",
                        index === 0
                          ? "border-brand-500/50 bg-brand-500/15 text-brand-400"
                          : "border-ink-700 bg-ink-850 text-ink-500",
                      )}
                    >
                      <MapPin size={12} />
                    </span>
                    {!isLast ? <span className="mt-1 w-px flex-1 bg-ink-800" /> : null}
                  </div>

                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="text-sm font-medium text-ink-100">
                        {event.loc_name ?? "Unnamed plaza"}
                      </p>
                      {state ? <Badge>{state}</Badge> : null}
                      {index === 0 ? <Badge tone="brand">latest</Badge> : null}
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-400">
                      <span className="tabular-nums">{fmtTime(event.event_time)}</span>
                      <span className="text-ink-600">·</span>
                      <span>{fmtRelative(event.event_time)}</span>
                      {directionLabel(event.direction) ? (
                        <>
                          <span className="text-ink-600">·</span>
                          <span>{directionLabel(event.direction)}</span>
                        </>
                      ) : null}
                      {event.lat !== null && event.lng !== null ? (
                        <>
                          <span className="text-ink-600">·</span>
                          <a
                            href={`https://www.google.com/maps?q=${event.lat},${event.lng}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-brand-400 hover:underline"
                          >
                            map
                            <ExternalLink size={10} />
                          </a>
                        </>
                      ) : null}
                    </div>

                    {event.event_name && event.event_name !== "TOLL PLAZA CROSSED" ? (
                      <p className="mt-1 text-xs text-ink-500">{event.event_name}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

/** Compact "A → B → C" route strip for cards and case folders. */
export function RouteStrip({ events, max = 4 }: { events: TruckEvent[]; max?: number }) {
  if (events.length === 0) return <span className="text-xs text-ink-500">No crossings yet</span>;

  const shown = events.slice(0, max);

  return (
    <div className="flex flex-col gap-1">
      {shown.map((event, index) => (
        <div key={event.id} className="flex items-center gap-2 text-xs">
          {index > 0 ? (
            <ArrowDown size={11} className="shrink-0 text-ink-600" />
          ) : (
            <MapPin size={11} className="shrink-0 text-brand-400" />
          )}
          <span className="truncate text-ink-200">{event.loc_name ?? "Unnamed plaza"}</span>
          <span className="ml-auto shrink-0 tabular-nums text-ink-500">
            {fmtTime(event.event_time)}
          </span>
        </div>
      ))}
      {events.length > max ? (
        <span className="mt-0.5 text-[11px] text-ink-500">
          + {events.length - max} earlier crossing{events.length - max === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

/** Header block shown above a timeline: where it is now, in one glance. */
export function LatestPosition({ event }: { event: TruckEvent | null }) {
  if (!event) return null;
  const state = stateFromLocation(event.loc_name);

  return (
    <div className="rounded-xl border border-brand-500/25 bg-brand-500/[0.07] p-4">
      <p className="text-[11px] font-semibold tracking-wider text-brand-400 uppercase">
        Last seen at
      </p>
      <p className="mt-1 text-lg font-semibold text-white">{event.loc_name ?? "Unnamed plaza"}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-300">
        <span>
          {fmtDate(event.event_time)}, {fmtTime(event.event_time)}
        </span>
        <span className="text-ink-600">·</span>
        <span>{fmtRelative(event.event_time)}</span>
        {directionLabel(event.direction) ? (
          <>
            <span className="text-ink-600">·</span>
            <span>{directionLabel(event.direction)}</span>
          </>
        ) : null}
        {state ? (
          <>
            <span className="text-ink-600">·</span>
            <span>{state}</span>
          </>
        ) : null}
      </div>
      <p className="mt-2 text-[11px] text-ink-500">
        Crossing id <Mono>{event.seq_no}</Mono>
      </p>
    </div>
  );
}
