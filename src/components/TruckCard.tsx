import Link from "next/link";
import { BellOff, ChevronRight, Timer } from "lucide-react";

import { InfoTip } from "@/components/InfoTip";
import { TrackingToggle } from "@/components/TrackingToggle";
import { Badge, Mono, cx, type BadgeTone } from "@/components/ui";
import { fmtRelative } from "@/lib/format";
import { PAUSE_HELP_LINE, autoPauseCountdown, pauseCopyFor, pauseWhy } from "@/lib/pause";
import type {
  AppSettings,
  TrackedTruck,
  TruckAlertWithTemplate,
  TruckStatus,
} from "@/lib/types";

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
 * absolutely positioned overlay covering the card, with the content stacked
 * above it and taking no pointer events of its own - see the comment on that
 * div, because the pointer-events half was missing and the card opened nothing.
 */
export function TruckCard({
  truck,
  alerts = [],
  settings,
}: {
  truck: TrackedTruck;
  alerts?: TruckAlertWithTemplate[];
  /** Only for the pause (i), which quotes the window this truck was judged on. */
  settings: Pick<AppSettings, "inactivePauseHours">;
}) {
  const status = truck.is_active ? truck.status : "unknown";
  const pausedCopy = pauseCopyFor(truck);
  const countdown = autoPauseCountdown(truck);
  const silent = truck.is_active && !isWatching(alerts);

  /*
   * Why this particular truck stopped, one tap away but not on the row.
   *
   * The badge names the reason and that is all a scan needs; the question it
   * leaves - "no movement for how long?", "how many failures?" - has an answer
   * on the row already, and putting it in words would cost every paused lorry
   * a third line. So it goes behind the (i) at the end of the second line,
   * which is the only place on the card where an icon can sit without forcing
   * the registration number and its badge onto separate lines.
   */
  const why = pauseWhy(truck, settings);

  /*
   * The second line, as a fragment, because it is rendered either inside an
   * InfoTip or in a plain div and the two must not drift apart.
   *
   * The words "Stopped automatically" used to lead it. They are gone for an
   * automatic pause: the badge above says "No movement detected" in a warning
   * colour, so repeating "stopped automatically" underneath it filled the line
   * that the location needed and pushed a two-line card to three. A pause the
   * officer made themselves has no badge, so there the words stay - they are
   * the only thing saying the truck is off.
   */
  const secondLine = (
    <>
      {truck.is_active ? (
        <span className={cx("font-medium", STATUS_TEXT[status])}>{TRUCK_STATUS_LABEL[status]}</span>
      ) : pausedCopy?.automatic ? null : (
        <span className="font-medium text-muted">Paused by you</span>
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
    </>
  );

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

      {/*
        pointer-events-none, and it is the whole reason the overlay above works.

        This div is painted ON TOP of that anchor - it has to be, or the switch
        inside it could not be pressed - so every pixel of the card was landing
        on a plain div and the anchor underneath was never hit. The card looked
        like a link, was announced as a link, and opened nothing: the only way
        into a truck was the browser's own focus ring and Enter. Made worse on
        exactly the rows that needed opening most, where "Open to fix" sat here
        swallowing the tap that was following its instruction.

        So the wrapper takes no clicks and hands them down to the anchor, and
        the two controls that need them - the switch and the pause (i) - take
        them back explicitly. Selecting the registration number with a drag is
        the price, and a list row that opens when tapped is worth more than
        copying a number from it.
      */}
      {/* items-start, not items-center: the switch belongs beside the
          registration number, and centring it against the whole row left it
          floating in the middle of the card whenever the pause (i) was open or
          the text ran to three lines. */}
      <div className="pointer-events-none relative z-10 flex items-start gap-3 py-2.5 pr-3 pl-4">
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

          {pausedCopy?.automatic && why ? (
            <InfoTip
              label={`why ${truck.truck_number} is paused`}
              /* The panel takes clicks back (it is a div following a div - when
                 the tip is shut there is only one, so this matches nothing),
                 or reading it would navigate away mid-sentence. */
              className="mt-0.5 [&>div+div]:pointer-events-auto"
              /* -my-1 keeps the 28px icon from setting the height of a 16px
                 line: the row stays 20px and the circle overlaps the padding
                 above and below it. Its invisible 36px tap pad is unaffected. */
              rowClassName="gap-x-2 gap-y-0.5 text-xs [&>button]:pointer-events-auto [&>button]:-my-1"
              info={
                <>
                  <p>{why}</p>
                  <p>{PAUSE_HELP_LINE} Open the truck to change when it stops by itself.</p>
                </>
              }
            >
              {secondLine}
            </InfoTip>
          ) : (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
              {secondLine}
            </div>
          )}
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
          /* mt-1 centres a 15px chevron on the 20px line the number sits on. */
          className="mt-1 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-500"
        />
      </div>
    </div>
  );
}
