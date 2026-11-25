import { Truck } from "lucide-react";

import { cx } from "@/components/ui";
import { ensureRoutePlan } from "@/lib/live/route";
import { loadTripTrack } from "@/lib/live/server";
import { dayLabel, durationShort, istDayKey, tripState, type LiveTrip } from "@/lib/live/shared";
import { buildTimeline, delayBadge, type StopRow } from "@/lib/live/timeline";

import { InfoTip } from "./parts";

/**
 * v6 "Where is my truck" (like IRCTC "Where is my train"): one row per main stop with
 * km, Scheduled and Actual / Expected time and a Delay / Before / On time badge; a truck
 * marker between the last passed and the next stop; a day line when the date changes.
 * Used on the trip page and (read-only, no internal data) on the customer page.
 */

const hm = (ms: number | null) =>
  ms == null ? "--:--" : new Date(ms).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

function Badge({ row }: { row: StopRow }) {
  const b = delayBadge(row.delayMin);
  if (!b) return null;
  return <span className={cx("rt-badge", `rt-badge-${b.tone}`)}>{b.text}</span>;
}

export async function RouteTimeline({
  trip,
  from,
  to,
  customer = false,
  footer,
}: {
  trip: LiveTrip;
  from: { name: string; lat: number; lng: number } | null;
  to: { name: string; lat: number; lng: number } | null;
  customer?: boolean;
  footer?: React.ReactNode;
}) {
  if (!from || !to) {
    return customer ? null : (
      <section className="panel rt">
        <p className="rt-empty">Pin both From and To on the map to see the route with stop times.</p>
        {footer}
      </section>
    );
  }
  const now = Date.now();
  const [plan, track] = await Promise.all([
    ensureRoutePlan(trip, from, to),
    tripState(trip) === "planned" || tripState(trip) === "cancelled" ? Promise.resolve([]) : loadTripTrack(trip.id, trip.started_at ?? trip.created_at),
  ]);
  const tl = buildTimeline(trip, plan, track, now);
  let lastDay = "";
  let firstDay = "";

  return (
    <section className="panel rt" aria-label="Route and stop times">
      <header className="rt-head">
        <strong>Route</strong>
        <span className="rt-sub">
          ~{tl.totalKm} km · {durationShort(tl.journeyH * 60)} journey{tl.journeyKind === "estimated" ? " (est.)" : ""}
        </span>
        <InfoTip label="How stop times are worked out">
          <span className="block">
            Stops: main cities and junctions between From and To, {tl.source === "ai" ? "worked out by AI" : "from a list of highway hubs"} once for this route. km are
            approximate road km.
          </span>
          <span className="block">
            Scheduled = {tl.baseKind === "actual" ? "actual start" : "planned start"} + journey hours, shared out by distance.
          </span>
          {!customer ? (
            <span className="block">
              Actual = first GPS position within 5 km of the stop (or when the truck went past it on the route, marked ≈). Expected ={" "}
              {tl.speedBasis === "eta" ? "paced to the live ETA" : tl.speedBasis === "recent" ? "recent average speed" : "the schedule pace"}
              {tl.speedKmph ? ` (~${tl.speedKmph} km/h)` : ""}.
            </span>
          ) : null}
        </InfoTip>
      </header>
      <div className="rt-cols" aria-hidden>
        <span />
        <span>Stop</span>
        <span>Sch.</span>
        <span>{tripState(trip) === "active" ? "Act./Exp." : "Actual"}</span>
      </div>
      <ol className="rt-list">
        {tl.rows.map((r, i) => {
          const at = r.scheduled ?? r.time;
          const day = at != null ? istDayKey(new Date(at).toISOString()) : "";
          const showDay = Boolean(day) && day !== lastDay && i > 0;
          if (day && !firstDay) firstDay = day;
          if (day) lastDay = day;
          const dayNo = day && firstDay ? Math.round((Date.parse(day) - Date.parse(firstDay)) / 86_400_000) + 1 : 1;
          const marker = tl.truck && tl.truck.after === i;
          return (
            <li key={r.key} className="rt-item">
              {showDay ? <p className="rt-day">
                  Day {dayNo} · {dayLabel(day)}
                </p> : null}
              <div className={cx("rt-row", r.passed && "is-passed", r.kind !== "stop" && "is-end")}>
                <span className="rt-dot" aria-hidden />
                <span className="rt-name">
                  <span className="truncate">{r.name}</span>
                  <small>{r.km} km</small>
                </span>
                <span className="rt-t">{hm(r.scheduled)}</span>
                <span className="rt-t rt-act">
                  <span className={cx(r.timeKind === "expected" && "is-exp")}>
                    {r.timeKind === "projected" ? "≈" : ""}
                    {r.time != null ? hm(r.time) : r.passed ? "passed" : "--:--"}
                  </span>
                  <Badge row={r} />
                </span>
              </div>
              {marker ? (
                <div className="rt-truck" role="status">
                  <span className="rt-truck-ic">
                    <Truck size={11} />
                  </span>
                  <span>
                    {tl.truck!.kmToNext} km to {tl.rows[i + 1].name}
                  </span>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {footer}
    </section>
  );
}
