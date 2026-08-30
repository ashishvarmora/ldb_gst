import Link from "next/link";
import { BellOff, BellRing, ChevronRight, Clock, MapPin } from "lucide-react";

import { directionLabel } from "@/components/Timeline";
import { Badge, Mono, cx, type BadgeTone } from "@/components/ui";
import { describeAlert } from "@/lib/alerts";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import type { TrackedTruck, TruckAlertWithTemplate, TruckStatus } from "@/lib/types";

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
 * When this truck was last looked at, in a way that does not read as a fault.
 *
 * A truck is only ever checked because one of its alerts came due, so a truck
 * with no alerts has genuinely never been checked and never will be. Saying
 * "never" there sends officers hunting for a problem that is not one.
 */
export function lastCheckedLabel(
  truck: Pick<TrackedTruck, "is_active" | "last_polled_at">,
  alerts: Pick<TruckAlertWithTemplate, "is_enabled">[],
): string {
  if (!truck.is_active) return "Paused — not being checked";
  if (truck.last_polled_at) return `Last checked ${fmtRelative(truck.last_polled_at)}`;
  if (alerts.length === 0) return "No alerts yet — nothing is checked until you add one";
  if (!alerts.some((alert) => alert.is_enabled)) return "Every alert is off — nothing is checked";
  return "Waiting for the first check";
}

/**
 * The card an officer scans down a list of: where it was, when, which way, and
 * which alerts are watching it.
 */
export function TruckCard({
  truck,
  alerts = [],
}: {
  truck: TrackedTruck;
  alerts?: TruckAlertWithTemplate[];
}) {
  const status = truck.is_active ? truck.status : "unknown";
  const enabled = alerts.filter((alert) => alert.is_enabled);

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
                "No crossing seen yet"
              )}
            </dd>
          </div>

          <div className="flex items-start gap-2">
            {enabled.length > 0 ? (
              <BellRing size={13} className="mt-px shrink-0 text-brand-500" />
            ) : (
              <BellOff size={13} className="mt-px shrink-0 text-faint" />
            )}
            <dd className="min-w-0 text-muted">
              {enabled.length === 0 ? (
                alerts.length === 0 ? (
                  "No alerts yet"
                ) : (
                  `${alerts.length} alert${alerts.length === 1 ? "" : "s"}, all switched off`
                )
              ) : (
                <>
                  <span className="block truncate text-ink">{describeAlert(enabled[0])}</span>
                  {enabled.length > 1 ? (
                    <span className="block">
                      + {enabled.length - 1} more alert{enabled.length - 1 === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-divider pt-2.5 text-[11px] text-muted">
          <span>{lastCheckedLabel(truck, alerts)}</span>
          {truck.consecutive_errors > 0 ? (
            <span className="text-bad-500">
              {truck.consecutive_errors} failed check{truck.consecutive_errors === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
