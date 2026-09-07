import Link from "next/link";
import { BellOff, ChevronRight, Timer } from "lucide-react";

import { TrackingToggle } from "@/components/TrackingToggle";
import { Badge, Mono, cx, type BadgeTone } from "@/components/ui";
import { fmtRelative } from "@/lib/format";
import { autoPauseCountdown, pauseCopyFor } from "@/lib/pause";
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

/** Will anything reach you about this truck? The list is sorted on this. */
export function isWatching(alerts: Pick<TruckAlertWithTemplate, "is_enabled">[]): boolean {
  return alerts.some((alert) => alert.is_enabled);
}

/**
 * When this truck was last looked at, in a way that does not read as a fault.
 *
 * A truck is only ever checked because one of its alerts came due, so a truck
 * with no alerts has genuinely never been checked and never will be. Saying
 * "never" there sends people hunting for a problem that is not one.
 */
export function lastCheckedLabel(
  truck: Pick<TrackedTruck, "is_active" | "last_polled_at" | "paused_reason">,
  alerts: Pick<TruckAlertWithTemplate, "is_enabled">[],
): string {
  /* A truck the worker paused looks exactly like one the officer paused, and
     the difference is the whole story: one was a decision, the others are
     something that needs fixing or a timer that ran out. The wording lives in
     one table so a new reason cannot show up on this line as a bare "paused"
     while the truck's own page explains it properly. */
  const paused = pauseCopyFor(truck);
  if (paused) return paused.line;
  if (truck.last_polled_at) return `Last checked ${fmtRelative(truck.last_polled_at)}`;
  if (alerts.length === 0) return "Never checked — it has no alert yet";
  if (!isWatching(alerts)) return "Every alert is off — nothing is checked";
  return "Waiting for the first check";
}

/**
 * One truck, as a row that can be scanned rather than read.
 *
 * This was a card the size of a small form: a status rail, the number, a
 * bordered alert panel listing up to two alerts by name, then a bordered
 * definition list carrying an icon, the last location, a relative time, a
 * second icon and the last-checked sentence. Six lines and three nested
 * borders per lorry, so four trucks filled a phone screen and finding the one
 * that had stopped meant scrolling.
 *
 * What survives is what the list is actually scanned for:
 *
 *   the number          the only thing anyone searches by
 *   where it is         one line, the answer to "where is my lorry"
 *   why it stopped      only when the platform stopped it, never for a pause
 *                       the officer made themselves
 *   a switch            so a truck can be turned off from here
 *
 * Everything else - the alert names, the failure budget, the auto-pause
 * settings, the crossing history - is on the truck's own page, one tap away
 * through the same card. A list is for choosing which truck to open; it is not
 * a place to configure one.
 *
 * WHY THE LINK IS AN OVERLAY
 *
 * The whole card used to be an <a>. It cannot be any more: a <form> nested in
 * an anchor is invalid HTML and a button inside one navigates as well as
 * submitting, so the switch could never live inside it. The anchor is now an
 * absolutely positioned overlay covering the card, with the switch stacked
 * above it - which keeps the entire card tappable while leaving a live control
 * in it.
 */
export function TruckCard({
  truck,
  alerts = [],
}: {
  truck: TrackedTruck;
  alerts?: TruckAlertWithTemplate[];
}) {
  const status = truck.is_active ? truck.status : "unknown";
  const pausedCopy = pauseCopyFor(truck);
  const countdown = autoPauseCountdown(truck);
  const silent = truck.is_active && !isWatching(alerts);

  return (
    <div
      className={cx(
        "panel group relative overflow-hidden transition",
        "hover:border-brand-500/45 hover:shadow-[var(--shadow-raised)]",
        "focus-within:border-brand-500",
        !truck.is_active && "opacity-80",
      )}
    >
      <span aria-hidden className={cx("absolute inset-y-0 left-0 w-1", STATUS_RAIL[status])} />

      {/*
        The tap target for the whole row, under everything else. Its accessible
        name is the registration number, so a screen reader moving through the
        list hears the truck rather than "link" twelve times.
      */}
      <Link
        href={`/portal/trucks/${truck.id}`}
        className="absolute inset-0 z-0 focus-visible:outline-none"
      >
        <span className="sr-only">Open {truck.truck_number}</span>
      </Link>

      <div className="relative z-10 flex items-center gap-3 py-2.5 pr-3 pl-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <Mono className="text-sm font-semibold tracking-wide text-strong">
              {truck.truck_number}
            </Mono>

            {/*
              Only an automatic stop earns a badge. A truck the officer paused
              themselves needs no explanation, and labelling it competes with
              the four that do mean something is wrong.
            */}
            {pausedCopy?.automatic ? (
              <Badge tone={pausedCopy.tone}>{pausedCopy.badge}</Badge>
            ) : null}

            {truck.label ? (
              <span className="truncate text-xs text-muted">{truck.label}</span>
            ) : null}
          </div>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {truck.is_active ? (
              <span className={cx("font-medium", STATUS_TEXT[status])}>
                {TRUCK_STATUS_LABEL[status]}
              </span>
            ) : (
              <span className="font-medium text-muted">
                {pausedCopy?.automatic ? "Stopped automatically" : "Paused by you"}
              </span>
            )}

            {truck.last_location ? (
              <span className="min-w-0 truncate text-muted">
                {truck.last_location}
                {truck.last_event_at ? ` · ${fmtRelative(truck.last_event_at)}` : ""}
              </span>
            ) : (
              <span className="text-faint">No crossing yet</span>
            )}

            {/* A stop time already set, so nobody is surprised by it later. */}
            {countdown ? (
              <span className="inline-flex items-center gap-1 text-faint">
                <Timer size={11} className="shrink-0" />
                stops {countdown}
              </span>
            ) : null}

            {/* The one thing worth interrupting a scan for: this truck is on,
                and nothing will ever reach the officer about it. */}
            {silent ? (
              <span className="inline-flex items-center gap-1 text-warn-500">
                <BellOff size={11} className="shrink-0" />
                no alert
              </span>
            ) : null}
          </div>
        </div>

        <TrackingToggle
          truckId={truck.id}
          active={truck.is_active}
          truckNumber={truck.truck_number}
          resumable={pausedCopy?.resumable ?? true}
        />

        <ChevronRight
          size={15}
          aria-hidden
          className="shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-500"
        />
      </div>
    </div>
  );
}
