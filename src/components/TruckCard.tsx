import Link from "next/link";
import { MapPin } from "lucide-react";

import { TrackingToggle } from "@/components/TrackingToggle";
import { TruckMenu } from "@/components/TruckMenu";
import { Badge, Mono, cx, type BadgeTone } from "@/components/ui";
import type { Destination, TripProgress } from "@/lib/destination";
import { fmtAgo, fmtRelative, fmtWhen } from "@/lib/format";
import { pauseCopyFor, truckChip } from "@/lib/pause";
import type { TrackedTruck, TruckAlertWithTemplate, TruckStatus } from "@/lib/types";

/* Still used by the Groups page for its own status column. */
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

/** Will anything reach you about this truck? */
export function isWatching(alerts: Pick<TruckAlertWithTemplate, "is_enabled">[]): boolean {
  return alerts.some((alert) => alert.is_enabled);
}

/**
 * When this truck was last looked at, in a way that does not read as a fault.
 * A truck with no enabled alert is never checked, which is not a failure.
 */
export function lastCheckedLabel(
  truck: Pick<TrackedTruck, "is_active" | "last_polled_at" | "paused_reason">,
  alerts: Pick<TruckAlertWithTemplate, "is_enabled">[],
): string {
  const paused = pauseCopyFor(truck);
  if (paused) return paused.line;
  if (truck.last_polled_at) return `Last checked ${fmtRelative(truck.last_polled_at)}`;
  if (alerts.length === 0) return "Not checked — no alert set";
  if (!isWatching(alerts)) return "Not checked — every alert is off";
  return "Waiting for the first check";
}

/** Only what a row needs - the list page selects exactly these columns. */
export type TruckRowTruck = Pick<
  TrackedTruck,
  | "id"
  | "truck_number"
  | "label"
  | "is_active"
  | "paused_reason"
  | "last_event_at"
  | "last_location"
>;

export type TruckRowAlert = {
  tracked_truck_id: string;
  is_enabled: boolean;
  halt_active: boolean | null;
  template_kind: string | null;
};

/** The left rail, by chip tone, so a scan finds the halted or stopped one. */
const RAIL: Record<BadgeTone, string> = {
  good: "bg-good-500",
  warn: "bg-warn-500",
  bad: "bg-bad-500",
  brand: "bg-brand-500",
  neutral: "bg-line-strong",
};

/**
 * One truck on My trucks, as a compact row (owner, 20 Nov 2026) - about 64px
 * on a phone:
 *
 *   GJ02AT8546  [Paused · no movement]            [switch] [⋯]
 *   Last crossing: Mehsana Toll Plaza · 4 hr ago
 *
 * The chip comes from truckChip() in src/lib/pause.ts - the same function the
 * truck page uses, so the two always agree. The switch is one-tap Pause / Go
 * live; the ⋯ holds the same toggle and Delete. Tapping anywhere else opens
 * the truck. Every detail (alerts, why it paused, settings, route) is on the
 * truck page, one tap away.
 *
 * WHY THE LINK IS AN OVERLAY: a <form> inside an <a> is invalid and a button
 * in one navigates as well as submitting, so the link is an absolutely placed
 * layer under the content. The content takes no pointer events (taps fall
 * through to the link); the controls take them back.
 */
export function TruckCard({
  truck,
  alerts = [],
  trip = null,
}: {
  truck: TruckRowTruck;
  alerts?: Pick<TruckRowAlert, "is_enabled" | "halt_active" | "template_kind">[];
  /** Destination and distance left (24 Nov 2026); null = no third line. */
  trip?: { destination: Destination; progress: TripProgress | null } | null;
}) {
  const chip = truckChip(truck, alerts);
  const pausedCopy = pauseCopyFor(truck);

  return (
    <div className={cx("truck-row panel group", !truck.is_active && "is-paused")}>
      <span aria-hidden className={cx("truck-row-rail", RAIL[chip.tone])} />

      <Link href={`/portal/trucks/${truck.id}`} className="truck-row-link">
        <span className="sr-only">
          Open {truck.truck_number}, {chip.label}
        </span>
      </Link>

      <div className="truck-row-body">
        <div className="truck-row-text">
          <p className="truck-row-top">
            <Mono className="truck-row-plate">{truck.truck_number}</Mono>
            <Badge tone={chip.tone} className="truck-row-chip">
              {chip.label}
            </Badge>
            {truck.label ? <span className="truck-row-label">{truck.label}</span> : null}
          </p>
          <p className="truck-row-sub">
            {truck.last_event_at ? (
              <>
                <span className="truck-row-sub-key">Last crossing:</span>
                <span className="truck-row-place">{truck.last_location ?? "Unnamed plaza"}</span>
                <span className="truck-row-time" title={fmtWhen(truck.last_event_at)}>
                  · {fmtAgo(truck.last_event_at)}
                </span>
              </>
            ) : (
              <span className="truck-row-place">No crossing recorded yet</span>
            )}
          </p>
          {/* Only with a destination: "≈ 182 km to Mundra" plus a warning
              chip. Approximate - the (i) on the truck page explains. */}
          {trip ? (
            <p className="truck-row-trip" title="Approximate distance by road from the last toll crossing">
              <MapPin size={12} aria-hidden className="truck-trip-icon shrink-0" />
              <span className="truck-row-trip-text">
                {trip.progress
                  ? trip.progress.near
                    ? `Near ${trip.destination.name}`
                    : `≈ ${trip.progress.kmLeft.toLocaleString("en-IN")} km to ${trip.destination.name}`
                  : `Going to ${trip.destination.name}`}
              </span>
              {trip.progress?.movingAway ? (
                <Badge tone="warn" className="shrink-0">
                  Moving away
                </Badge>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="truck-row-controls">
          <TrackingToggle
            truckId={truck.id}
            active={truck.is_active}
            truckNumber={truck.truck_number}
            resumable={pausedCopy?.resumable ?? true}
          />
          <TruckMenu
            truckId={truck.id}
            truckNumber={truck.truck_number}
            active={truck.is_active}
            resumable={pausedCopy?.resumable ?? true}
            place="row"
          />
        </div>
      </div>
    </div>
  );
}
