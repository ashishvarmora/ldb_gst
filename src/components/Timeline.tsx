import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ExternalLink, MapPin } from "lucide-react";

import { Badge, EmptyState, cx } from "@/components/ui";
import { fmtDate, fmtDateTime, fmtRelative, fmtTime } from "@/lib/format";
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
 * Toll crossings as a route, newest first, grouped by day. This is the view
 * people actually read - a flat table of latitudes is not it.
 */
export function Timeline({
  events,
  showRecorded = false,
}: {
  events: TruckEvent[];
  /** Adds "recorded ..." to each entry - when the platform captured it. */
  showRecorded?: boolean;
}) {
  if (events.length === 0) {
    return (
      <EmptyState
        title="No toll crossings on record"
        description="The toll network only reports crossings from roughly the last week. If the truck has not passed a plaza recently there is nothing to show."
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
            <h3 className="text-xs font-semibold tracking-wider text-muted uppercase">
              {group.date === "unknown" ? "Undated" : fmtDate(group.events[0].event_time)}
            </h3>
            <span className="h-px flex-1 bg-sunken" />
            <span className="text-xs text-faint">
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
                          : "border-line bg-raised text-faint",
                      )}
                    >
                      <MapPin size={12} />
                    </span>
                    {!isLast ? <span className="mt-1 w-px flex-1 bg-sunken" /> : null}
                  </div>

                  <div className="min-w-0 flex-1 pb-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="text-sm font-medium text-ink">
                        {event.loc_name ?? "Unnamed plaza"}
                      </p>
                      {state ? <Badge>{state}</Badge> : null}
                      {index === 0 ? <Badge tone="brand">latest</Badge> : null}
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                      <span className="tabular-nums">{fmtTime(event.event_time)}</span>
                      <span className="text-faint">·</span>
                      <span>{fmtRelative(event.event_time)}</span>
                      {directionLabel(event.direction) ? (
                        <>
                          <span className="text-faint">·</span>
                          <span>{directionLabel(event.direction)}</span>
                        </>
                      ) : null}
                      {event.lat !== null && event.lng !== null ? (
                        <>
                          <span className="text-faint">·</span>
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

                    {showRecorded ? (
                      <p className="mt-0.5 text-[11px] text-faint">
                        Recorded {fmtDateTime(event.fetched_at)}
                      </p>
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

/**
 * The handful of facts read straight after the route itself, so it sits
 * directly under the timeline rather than in a sidebar.
 *
 * Only the state is inferred. A district cannot be read off a free-text plaza
 * name honestly, and a guessed district on a record is worse than none.
 *
 * `events` may be only the page on screen, so the totals that describe the
 * whole history are passed in rather than counted from it.
 */
export function RouteSummary({
  events,
  total,
  oldest: oldestStored,
}: {
  events: TruckEvent[];
  /** Crossings stored for this truck, which may exceed what was loaded. */
  total?: number;
  /** The first crossing ever recorded, when it is off the loaded page. */
  oldest?: TruckEvent | null;
}) {
  if (events.length === 0) return null;

  const latest = events[0];
  const oldest = oldestStored ?? events[events.length - 1];
  const stored = total ?? events.length;
  const partial = stored > events.length;
  const state = stateFromLocation(latest.loc_name);
  const plazas = new Set(events.map((event) => event.loc_name).filter(Boolean)).size;

  return (
    <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCell label="Last seen at">
        <span className="block truncate text-sm font-medium text-strong">
          {latest.loc_name ?? "Unnamed plaza"}
        </span>
        <span className="mt-0.5 block text-xs text-muted">
          {state ?? "State not recognised from the plaza name"}
        </span>
      </SummaryCell>

      <SummaryCell label="Last crossing">
        <span className="block text-sm font-medium text-strong">{fmtTime(latest.event_time)}</span>
        <span className="mt-0.5 block text-xs text-muted">
          {fmtDate(latest.event_time)} · {fmtRelative(latest.event_time)}
        </span>
      </SummaryCell>

      <SummaryCell label="Crossings on record">
        <span className="block text-sm font-medium tabular-nums text-strong">{stored}</span>
        <span className="mt-0.5 block text-xs text-muted">
          across {plazas} plaza{plazas === 1 ? "" : "s"}
          {partial ? " on this page" : ""}
        </span>
      </SummaryCell>

      <SummaryCell label="Oldest crossing">
        <span className="block text-sm font-medium text-strong">{fmtDate(oldest.event_time)}</span>
        <span className="mt-0.5 block truncate text-xs text-muted">
          {oldest.loc_name ?? "Unnamed plaza"}
        </span>
      </SummaryCell>
    </dl>
  );
}

function SummaryCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-panel px-4 py-3">
      <dt className="text-[11px] font-semibold tracking-wider text-muted uppercase">{label}</dt>
      <dd className="mt-1 min-w-0">{children}</dd>
    </div>
  );
}

/**
 * The whole stored history for one truck: the recent stretch open, everything
 * older folded away behind one tap.
 *
 * Every crossing matters when you are piecing a journey together, but the last
 * few days are read first. Printing all of them straight out would bury that
 * under weeks of scrolling on a phone, so the older ones stay one tap away.
 */
export function RouteHistory({
  events,
  total,
  recent = 25,
  showRecorded = true,
}: {
  events: TruckEvent[];
  /** Crossings stored for this truck, which may exceed what was loaded. */
  total?: number;
  recent?: number;
  showRecorded?: boolean;
}) {
  if (events.length === 0) return <Timeline events={events} />;

  const head = events.slice(0, recent);
  const rest = events.slice(recent);
  const stored = total ?? events.length;

  return (
    <div className="space-y-4">
      <Timeline events={head} showRecorded={showRecorded} />

      {rest.length > 0 ? (
        <details className="group rounded-lg border border-line bg-raised/50">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3 text-sm text-brand-500 [&::-webkit-details-marker]:hidden">
            Show {rest.length} earlier crossing{rest.length === 1 ? "" : "s"}
            <ChevronDown size={15} aria-hidden className="transition group-open:rotate-180" />
          </summary>
          <div className="border-t border-divider bg-panel px-3 py-4">
            <Timeline events={rest} showRecorded={showRecorded} />
          </div>
        </details>
      ) : null}

      {/* Said, and made reachable. This pointed at "the Records page", which
          has been withdrawn - so a reader was being told the rest of their
          history existed somewhere they could no longer get to. The truck's
          own search result is where it lives now: the same rows, paged
          properly, with the exact count. The number comes off a crossing
          rather than a prop because events is non-empty by the guard above and
          every crossing in it belongs to one truck. */}
      {stored > events.length ? (
        <p className="text-xs leading-relaxed text-muted">
          The {events.length} newest of {stored} crossings on record are shown here.{" "}
          <Link href={`/portal/search/${events[0].truck_number}`} className="link">
            See all of them
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}

/**
 * Where the truck is now, as the first thing on the page. This is the question
 * a truck is opened to answer, so it is answered before anything else.
 */
export function LatestPosition({ event }: { event: TruckEvent | null }) {
  if (!event) {
    return (
      <div className="rounded-xl border border-line bg-raised p-4">
        <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Last seen at</p>
        <p className="mt-1 text-sm text-muted">
          No toll crossing on record yet. One appears here after the truck passes a plaza.
        </p>
      </div>
    );
  }

  const state = stateFromLocation(event.loc_name);

  return (
    <div className="rounded-xl border border-brand-500/25 bg-brand-500/[0.07] p-4">
      <p className="text-[11px] font-semibold tracking-wider text-brand-400 uppercase">
        Last seen at
      </p>
      <p className="mt-1 text-lg font-semibold text-strong">{event.loc_name ?? "Unnamed plaza"}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span>
          {fmtDate(event.event_time)}, {fmtTime(event.event_time)}
        </span>
        <span className="text-faint">·</span>
        <span>{fmtRelative(event.event_time)}</span>
        {directionLabel(event.direction) ? (
          <>
            <span className="text-faint">·</span>
            <span>{directionLabel(event.direction)}</span>
          </>
        ) : null}
        {state ? (
          <>
            <span className="text-faint">·</span>
            <span>{state}</span>
          </>
        ) : null}
      </div>
    </div>
  );
}
