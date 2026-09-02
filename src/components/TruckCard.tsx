import Link from "next/link";
import { BellOff, BellRing, ChevronRight, Clock, MapPin, Plus, Timer } from "lucide-react";

import { Badge, Mono, cx, type BadgeTone } from "@/components/ui";
import { describeAlert } from "@/lib/alerts";
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
 * The alert line, which is the reason the truck is on the list at all: what
 * will reach you, or why nothing will.
 */
function AlertStrip({
  truck,
  alerts,
}: {
  truck: TrackedTruck;
  alerts: TruckAlertWithTemplate[];
}) {
  const enabled = alerts.filter((alert) => alert.is_enabled);

  if (enabled.length === 0) {
    const nothingYet = alerts.length === 0;
    return (
      <div
        className={cx(
          "mt-3 flex items-center gap-2 rounded-lg border px-2.5 py-2",
          truck.is_active
            ? "border-warn-500/40 bg-warn-500/10 text-warn-500"
            : "border-line bg-raised text-muted",
        )}
      >
        <BellOff size={14} className="shrink-0" />
        <span className="min-w-0 flex-1 text-xs leading-snug">
          {nothingYet ? "No alert yet — nothing reaches you" : "All alerts off — nothing reaches you"}
        </span>
        {truck.is_active ? (
          /* The whole card is already a link to the truck, where the add-alert
             form is open when there is nothing on it - so this is the cue, not
             a second link. */
          <span className="flex shrink-0 items-center gap-1 rounded-md bg-warn-500/15 px-2 py-1 text-[11px] font-medium">
            <Plus size={11} />
            Add one
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-brand-500/30 bg-brand-500/8 px-2.5 py-2">
      <p className="flex items-center gap-2 text-xs font-medium text-brand-500">
        <BellRing size={14} className="shrink-0" />
        Watching
      </p>
      <ul className="mt-1 space-y-0.5">
        {enabled.slice(0, 2).map((alert) => (
          <li key={alert.id} className="truncate text-xs text-ink">
            {describeAlert(alert)}
          </li>
        ))}
        {enabled.length > 2 ? (
          <li className="text-xs text-muted">+ {enabled.length - 2} more</li>
        ) : null}
      </ul>
    </div>
  );
}

/**
 * One card per truck, holding only what a list is scanned for: the number,
 * what is watching it, whether it is moving, where it was last seen and when
 * it was last checked. Anything else belongs on the truck's own page.
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
              {pausedCopy ? <Badge tone={pausedCopy.tone}>{pausedCopy.badge}</Badge> : null}
              {/*
                A truck that is still running but has a stop time coming reads
                as an ordinary truck, which is how somebody forgets they set
                one. The countdown is small and beside the number so it is
                visible without competing with the movement status.
              */}
              {countdown ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-faint">
                  <Timer size={11} className="shrink-0" />
                  stops {countdown}
                </span>
              ) : null}
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

        <AlertStrip truck={truck} alerts={alerts} />

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
            <Clock size={13} className="mt-px shrink-0 text-faint" />
            <dd className="min-w-0 text-muted">{lastCheckedLabel(truck, alerts)}</dd>
          </div>
        </dl>
      </div>
    </Link>
  );
}
