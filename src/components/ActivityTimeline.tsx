import {
  Bell,
  BellOff,
  Pencil,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Timer,
  Trash2,
  Hand,
} from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "@/components/ui";
import type { ActivityEntry } from "@/lib/credit-history";
import { formatCredits } from "@/lib/credits";
import { fmtDayTime, fmtTime } from "@/lib/format";

/**
 * The individual entries on /portal/activity: one row per check or search
 * (time, truck, auto or manual, credits, crossings found) and the truck's own
 * events (added, paused, alert changed...). Same look as the truck page
 * timeline (truck-timeline-* in screens-polish.css).
 */

const ICON = 14;

function iconFor(entry: ActivityEntry): ReactNode {
  if (entry.kind === "check") {
    if (entry.check === "auto") return <RefreshCw size={ICON} />;
    if (entry.check === "manual") return <Hand size={ICON} />;
    return <Search size={ICON} />;
  }
  switch (entry.code) {
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
    default:
      return <Settings2 size={ICON} />;
  }
}

const CHECK_LABEL = {
  auto: "Auto check",
  manual: "Manual check",
  search: "Manual search",
} as const;

function checkSub(entry: ActivityEntry): string {
  const parts: string[] = [];
  if (entry.found !== null) {
    parts.push(`${entry.found} crossing${entry.found === 1 ? "" : "s"} found, ${entry.fresh ?? 0} new`);
  } else if (entry.check === "auto") {
    parts.push("No new crossings");
  }
  parts.push(`${formatCredits(entry.credits)} credit${entry.credits === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

export function ActivityTimeline({
  entries,
  showTruck,
  showDate,
  note,
}: {
  entries: ActivityEntry[];
  /** Name the truck on each row (not needed inside a truck's group). */
  showTruck: boolean;
  /** Date with the time (not needed inside a day's group). */
  showDate: boolean;
  /** One muted line under the list. */
  note?: ReactNode;
}) {
  return (
    <div className="aday-events">
      {entries.length === 0 ? (
        <p className="aday-more">Nothing recorded here.</p>
      ) : (
        <ol className="truck-timeline">
          {entries.map((entry) => {
            const what = entry.kind === "check" ? CHECK_LABEL[entry.check ?? "auto"] : entry.title;
            return (
              <li key={entry.key} className="truck-timeline-item">
                <span aria-hidden className={cx("truck-timeline-icon", entry.kind === "event" && `is-${entry.tone}`)}>
                  {iconFor(entry)}
                </span>
                <div className="aentry-text">
                  <p className="truck-timeline-title">
                    {showTruck && entry.truck ? <span className="aentry-plate">{entry.truck}</span> : null}
                    <span>{what}</span>
                  </p>
                  {entry.kind === "check" ? (
                    <p className="truck-timeline-sub">{checkSub(entry)}</p>
                  ) : entry.sub ? (
                    <p className="truck-timeline-sub">{entry.sub}</p>
                  ) : null}
                </div>
                <time dateTime={entry.at} className="truck-timeline-time">
                  {showDate ? fmtDayTime(entry.at) : fmtTime(entry.at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      {note ? <p className="aday-more">{note}</p> : null}
    </div>
  );
}
