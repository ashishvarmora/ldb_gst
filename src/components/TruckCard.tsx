import Link from "next/link";
import { Clock, MapPin, Star, Truck as TruckIcon } from "lucide-react";

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

const STATUS_DOT: Record<TruckStatus, string> = {
  moving: "bg-good-500",
  idle: "bg-warn-500",
  no_activity: "bg-bad-500",
  unknown: "bg-ink-500",
};

/**
 * The card an officer scans down a list of. Everything that matters — where it
 * was, when, which way, and whether tracking is actually running.
 */
export function TruckCard({ truck }: { truck: TrackedTruck }) {
  const status = truck.is_active ? truck.status : "unknown";

  return (
    <Link
      href={`/portal/trucks/${truck.id}`}
      className={cx(
        "panel group block p-4 transition hover:border-brand-500/40 hover:bg-ink-850/70",
        !truck.is_active && "opacity-70",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-ink-700 bg-ink-850 text-ink-400">
            <TruckIcon size={15} />
          </span>
          <div className="min-w-0">
            <Mono className="block text-sm font-semibold text-ink-100 group-hover:text-brand-400">
              {truck.truck_number}
            </Mono>
            {truck.label ? (
              <span className="block truncate text-xs text-ink-500">{truck.label}</span>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="flex items-center gap-1.5">
            <span className={cx("inline-block size-1.5 rounded-full", STATUS_DOT[status])} />
            <span className="text-xs text-ink-300">{TRUCK_STATUS_LABEL[status]}</span>
          </span>
          {truck.is_watchlist ? (
            <Badge tone="warn">
              <Star size={9} />
              watchlist
            </Badge>
          ) : null}
          {!truck.is_active ? <Badge>paused</Badge> : null}
        </div>
      </div>

      <dl className="mt-3 space-y-1.5 border-t border-ink-800 pt-3 text-xs">
        <div className="flex items-start gap-2">
          <MapPin size={12} className="mt-0.5 shrink-0 text-ink-500" />
          <dd className="min-w-0 text-ink-200">
            {truck.last_location ?? <span className="text-ink-500">No crossing recorded yet</span>}
            {directionLabel(truck.last_direction) ? (
              <span className="text-ink-500"> · {directionLabel(truck.last_direction)}</span>
            ) : null}
          </dd>
        </div>

        <div className="flex items-center gap-2">
          <Clock size={12} className="shrink-0 text-ink-500" />
          <dd className="text-ink-300">
            {truck.last_event_at ? (
              <>
                {fmtDateTime(truck.last_event_at)}
                <span className="text-ink-500"> · {fmtRelative(truck.last_event_at)}</span>
              </>
            ) : (
              <span className="text-ink-500">Waiting for the first check</span>
            )}
          </dd>
        </div>
      </dl>

      <div className="mt-3 flex items-center justify-between border-t border-ink-800 pt-2.5 text-[11px] text-ink-500">
        <span>
          {truck.is_active ? `Checked every ${truck.polling_interval_minutes} min` : "Not being checked"}
        </span>
        <span>
          {truck.consecutive_errors > 0
            ? `${truck.consecutive_errors} failed check${truck.consecutive_errors === 1 ? "" : "s"}`
            : `last check ${fmtRelative(truck.last_polled_at)}`}
        </span>
      </div>
    </Link>
  );
}
