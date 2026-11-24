import { MapPin } from "lucide-react";

import { InfoTip } from "@/components/InfoTip";
import { Badge } from "@/components/ui";
import {
  AVERAGE_KMPH,
  AWAY_EXPLAINED,
  DISTANCE_EXPLAINED,
  distanceLine,
  type Destination,
  type TripProgress,
} from "@/lib/destination";
import { fmtWhen } from "@/lib/format";

/**
 * "📍 ≈ 182 km left to Mundra (i)  [Moving away from destination]" - one line
 * under the last crossing, on the truck page and on the public trip page.
 * The (i) says how rough the number is and why the warning shows.
 */
export function TripLine({
  destination,
  progress,
  className,
}: {
  destination: Destination | null;
  progress: TripProgress | null;
  className?: string;
}) {
  if (!destination) return null;

  if (!progress) {
    return (
      <p className={`truck-trip ${className ?? ""}`}>
        <MapPin size={13} aria-hidden className="truck-trip-icon" />
        <span className="truck-trip-text">
          Going to <strong>{destination.name}</strong>
          <span className="text-muted"> · distance shows after the next toll crossing</span>
        </span>
      </p>
    );
  }

  return (
    <InfoTip
      label="distance left"
      className={`truck-trip-wrap ${className ?? ""}`}
      rowClassName="truck-trip"
      info={
        <>
          {DISTANCE_EXPLAINED.map((line) => (
            <p key={line}>{line}</p>
          ))}
          <p>
            Measured from {progress.from.loc_name ?? "the last toll plaza"}
            {progress.from.event_time ? ` (${fmtWhen(progress.from.event_time)})` : ""}.
            {progress.driveTime
              ? ` At an average ${AVERAGE_KMPH} km/h that is ${progress.driveTime} of driving from there.`
              : ""}
          </p>
          {progress.movingAway ? (
            <p>
              <strong className="text-warn-500">Moving away:</strong> the latest crossing is about{" "}
              {progress.awayByKm} km farther from {progress.destination.name} than the one before.{" "}
              {AWAY_EXPLAINED}
            </p>
          ) : null}
        </>
      }
    >
      <MapPin size={13} aria-hidden className="truck-trip-icon" />
      <span className="truck-trip-text">{distanceLine(progress)}</span>
      {progress.movingAway ? (
        <Badge tone="warn">Moving away from destination</Badge>
      ) : progress.near ? (
        <Badge tone="good">Near destination</Badge>
      ) : null}
    </InfoTip>
  );
}
