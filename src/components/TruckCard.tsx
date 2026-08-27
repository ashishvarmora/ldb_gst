import Link from "next/link";
import { ChevronRight, Clock, MapPin, Star } from "lucide-react";

import { directionLabel } from "@/components/Timeline";
import { Badge, Mono, cx, type BadgeTone } from "@/components/ui";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import type { TrackedTruck, TruckStatus } from "@/lib/types";

export const TRUCK_STATUS_TONE: Record<TruckStatus, BadgeTone> = {
  moving: "good",
  idle: "warn",
  no_activity: "bad",
  unknown: "neutral",
};

export const TRUCK_STATUS_LABEL: Record<TruckStatus, string> = {
  moving: "Moving",
  idle: "Idle",
  no_activity: "No activity",
  unknown: "Not checked yet",
};

/**
 * A coloured rail down the left edge. Scanning twenty cards for the one that
 * has gone quiet should be a glance, not a read.
 */
const STATUS_RAIL: Record<TruckStatus, string> = {
  moving: "bg-good-500",
  idle: "bg-warn-500",
  no_activity: "bg-bad-500",
  unknown: "bg-line-strong",
};

const STATUS_TEXT: Record<TruckStatus, string> = {
  moving: "text-good-500",
  idle: "text-warn-500",
  no_activity: "text-bad-500",
  unknown: "text-muted",
};

/**
 * The card an officer scans down a list of: where it was, when, which way, and
 * whether tracking is actually running.
 */
export function TruckCard({ truck }: { truck: TrackedTruck }) {
  const status = truck.is_active ? truck.status : "unknown";

  return (
    <Link
      href={`/portal/trucks/${truck.id}`}
      className={cx(
        "panel group relative block overflow-hidden pl-5 transition",
        "hover:border-brand-500/45 hover:shadow-[var(--shadow-raised)]",
        "focus-visible:border-brand-500",
        !truck.is_active && "opacity-75",
      )}
    >
      <span
        aria-hidden
        className={cx("absolute inset-y-0 left-0 w-1.5", STATUS_RAIL[status])}
      />

      <div className="p-4 pl-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Mono className="text-[15px] font-semibold tracking-wide text-strong">
                {truck.truck_number}
              </Mono>
              {truck.is_watchlist ? (
                <Badge tone="warn">
                  <Star size={9} />
                  watchlist
                </Badge>
              ) : null}
              {!truck.is_active ? <Badge>paused</Badge> : null}
            </div>
            {truck.label ? (
              <span className="mt-0.5 block truncate text-xs text-muted">{truck.label}</span>
            ) : null}
          </div>

          <span className="flex shrink-0 items-center gap-1">
            <span className={cx("text-xs font-medium", STATUS_TEXT[status])}>
              {TRUCK_STATUS_LABEL[status]}
            </span>
            <ChevronRight
              size={15}
              className="text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-500"
            />
          </span>
        </div>

        <dl className="mt-3 space-y-2 border-t border-divider pt-3 text-xs">
          <div className="flex items-start gap-2">
            <MapPin size={13} className="mt-px shrink-0 text-faint" />
            <dd className="min-w-0 text-ink">
              {truck.last_location ?? (
                <span className="text-muted">No crossing recorded yet</span>
              )}
              {directionLabel(truck.last_direction) ? (
                <span className="text-muted"> · {directionLabel(truck.last_direction)}</span>
              ) : null}
            </dd>
          </div>

          <div className="flex items-start gap-2">
            <Clock size={13} className="mt-px shrink-0 text-faint" />
            <dd className="text-muted">
              {truck.last_event_at ? (
                <>
                  <span className="font-medium text-ink">{fmtRelative(truck.last_event_at)}</span>
                  <span className="text-muted"> · {fmtDateTime(truck.last_event_at)}</span>
                </>
              ) : (
                "Waiting for the first check"
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-divider pt-2.5 text-[11px] text-muted">
          <span>
            {truck.is_active
              ? `Checked every ${truck.polling_interval_minutes} min`
              : "Not being checked"}
          </span>
          <span className={truck.consecutive_errors > 0 ? "text-bad-500" : undefined}>
            {truck.consecutive_errors > 0
              ? `${truck.consecutive_errors} failed check${truck.consecutive_errors === 1 ? "" : "s"}`
              : `last check ${fmtRelative(truck.last_polled_at)}`}
          </span>
        </div>
      </div>
    </Link>
  );
}
