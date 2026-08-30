import Link from "next/link";
import { BellOff, BellRing, ChevronRight, Clock, MapPin } from "lucide-react";

import { Badge, Mono, cx, type BadgeTone } from "@/components/ui";
import { describeAlert } from "@/lib/alerts";
import { fmtRelative } from "@/lib/format";
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

/** "Location changed · every 30 min" for the first alert, "+2 more" folded in. */
function alertSummary(alerts: TruckAlertWithTemplate[]): string {
  const enabled = alerts.filter((alert) => alert.is_enabled);
  if (enabled.length === 0) {
    if (alerts.length === 0) return "No alerts yet";
    return `${alerts.length} alert${alerts.length === 1 ? "" : "s"}, all switched off`;
  }
  const first = describeAlert(enabled[0]);
  return enabled.length === 1 ? first : `${first} + ${enabled.length - 1} more`;
}

/**
 * One card per truck, holding only what an officer scans a list for: the
 * number, whether it is moving, where it was last seen, when it was last
 * checked, and what is watching it. Anything else belongs on the truck's page.
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
              {truck.last_location ? (
                <>
                  <span className="block truncate">{truck.last_location}</span>
                  {truck.last_event_at ? (
                    <span className="text-muted">{fmtRelative(truck.last_event_at)}</span>
                  ) : null}
                </>
              ) : (
                <span className="text-muted">No crossing recorded yet</span>
              )}
            </dd>
          </div>

          <div className="flex items-start gap-2">
            {enabled.length > 0 ? (
              <BellRing size={13} className="mt-px shrink-0 text-brand-500" />
            ) : (
              <BellOff size={13} className="mt-px shrink-0 text-faint" />
            )}
            <dd className="min-w-0 truncate text-muted">{alertSummary(alerts)}</dd>
          </div>

          <div className="flex items-start gap-2">
            <Clock size={13} className="mt-px shrink-0 text-faint" />
            <dd className="min-w-0 text-muted">{lastCheckedLabel(truck, alerts)}</dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}
