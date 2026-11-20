import {
  Bell,
  BellOff,
  BellRing,
  Coins,
  MapPin,
  Octagon,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Timer,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { Badge, cx } from "@/components/ui";
import type { DayEvent } from "@/lib/credit-history";
import { fmtTime } from "@/lib/format";

/**
 * One truck's (or the manual searches') events for one day on /portal/activity:
 * a summary line for the checks, then crossings found, alerts sent and what
 * happened to the truck, newest first. Same look as the truck page timeline
 * (truck-timeline-* in screens-polish.css).
 */

const ICON = 14;
const LIMIT = 40;

function iconFor(event: DayEvent): ReactNode {
  if (event.kind === "crossing") return <MapPin size={ICON} />;
  if (event.kind === "search") return <Search size={ICON} />;
  if (event.kind === "alert") {
    if (event.tone === "good") return <PlayCircle size={ICON} />;
    if (event.code === "halt") return <Octagon size={ICON} />;
    if (event.tone === "bad") return <TriangleAlert size={ICON} />;
    return <BellRing size={ICON} />;
  }
  switch (event.code) {
    case "added":
    case "readded":
      return <Plus size={ICON} />;
    case "alert_added":
    case "alert_on":
      return <Bell size={ICON} />;
    case "alert_off":
      return <BellOff size={ICON} />;
    case "alert_edited":
      return <Pencil size={ICON} />;
    case "alert_removed":
    case "deleted":
      return <Trash2 size={ICON} />;
    case "paused":
      return <PauseCircle size={ICON} />;
    case "live":
      return <PlayCircle size={ICON} />;
    case "auto_paused":
      return <Timer size={ICON} />;
    case "manual_check":
      return <RefreshCw size={ICON} />;
    default:
      return <Settings2 size={ICON} />;
  }
}

export function ActivityTimeline({
  summary,
  events,
}: {
  /** The checks of the day in one line ("96 auto checks · 97 credits"). */
  summary: { title: string; sub: string | null } | null;
  events: DayEvent[];
}) {
  const shown = events.slice(0, LIMIT);
  const hidden = events.length - shown.length;

  return (
    <div className="aday-events">
      <ol className="truck-timeline">
        {summary ? (
          <li className="truck-timeline-item">
            <span aria-hidden className="truck-timeline-icon">
              <Coins size={ICON} />
            </span>
            <div>
              <p className="truck-timeline-title">{summary.title}</p>
              {summary.sub ? <p className="truck-timeline-sub">{summary.sub}</p> : null}
            </div>
            <span />
          </li>
        ) : null}
        {shown.map((event) => (
          <li key={event.key} className="truck-timeline-item">
            <span aria-hidden className={cx("truck-timeline-icon", `is-${event.tone}`)}>
              {iconFor(event)}
            </span>
            <div>
              <p className="truck-timeline-title">
                {event.title} {event.notSent ? <Badge tone="warn">not sent</Badge> : null}
              </p>
              {event.sub ? <p className="truck-timeline-sub">{event.sub}</p> : null}
            </div>
            <time dateTime={event.at} className="truck-timeline-time">
              {fmtTime(event.at)}
            </time>
          </li>
        ))}
      </ol>
      {hidden > 0 ? <p className="aday-more">+{hidden} earlier that day</p> : null}
      {events.length === 0 && !summary ? <p className="aday-more">Nothing else recorded that day.</p> : null}
    </div>
  );
}
