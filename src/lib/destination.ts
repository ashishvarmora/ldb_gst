/**
 * Distance left to a truck's destination, worked out from toll crossings
 * (owner, 24 Nov 2026). Pure functions: used by the truck page, the My trucks
 * row and the public trip page alike, so all three always agree.
 *
 * HOW ROUGH IT IS, on purpose:
 *   - straight line (haversine) from the latest crossing that has a position
 *     to the destination, x 1.25 because roads are not straight, rounded;
 *   - the truck has moved since that crossing, so this is "as of the last
 *     toll plaza", not "now";
 *   - no routing service, no cost, nothing that can fail.
 */

/** Roads are longer than the straight line; 1.25 is the usual rule of thumb in India. */
export const ROAD_FACTOR = 1.25;
/** Inside this many (road) km the truck reads as "Near destination". */
export const NEAR_KM = 15;
/** Latest crossing this many km farther than the one before = "Moving away". */
export const AWAY_KM = 25;
/** Average truck speed for the rough drive time in the (i). */
export const AVERAGE_KMPH = 40;

export type Destination = { name: string; lat: number; lng: number };

type Point = { lat: number | null; lng: number | null };
type Crossing = Point & { event_time?: string | null; loc_name?: string | null };

/** The 0077 columns on tracked_trucks; optional, because before the migration they are absent. */
export type DestinationColumns = {
  destination_name?: string | null;
  destination_lat?: number | null;
  destination_lng?: number | null;
};

/** The destination stored on a tracked_trucks row, or null when none is set (or 0077 is not applied). */
export function destinationOf(row: DestinationColumns): Destination | null {
  const { destination_name: name, destination_lat: lat, destination_lng: lng } = row;
  if (!name || typeof lat !== "number" || typeof lng !== "number") return null;
  return { name, lat, lng };
}

/** Great-circle distance in km. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Approximate road km between two points. */
export function roadKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a, b) * ROAD_FACTOR;
}

function located<T extends Point>(crossing: T): crossing is T & { lat: number; lng: number } {
  return typeof crossing.lat === "number" && typeof crossing.lng === "number";
}

export type TripProgress = {
  destination: Destination;
  /** Rounded road km from the latest located crossing. */
  kmLeft: number;
  near: boolean;
  /** The latest crossing is more than AWAY_KM farther than the one before. */
  movingAway: boolean;
  /** How much farther, rounded, when movingAway. */
  awayByKm: number;
  /** Rough drive time left at AVERAGE_KMPH, e.g. "about 5 hr"; null when near. */
  driveTime: string | null;
  /** The crossing the distance is measured from. */
  from: Crossing & { lat: number; lng: number };
};

/**
 * Progress towards the destination. `crossings` newest first, as every page
 * already reads them; crossings without a position are skipped. null when
 * there is no destination or no located crossing yet.
 */
export function tripProgress(
  destination: Destination | null,
  crossings: Crossing[],
): TripProgress | null {
  if (!destination) return null;
  const withPosition = crossings.filter(located);
  const latest = withPosition[0];
  if (!latest) return null;

  const latestKm = roadKm(latest, destination);
  const kmLeft = Math.round(latestKm);
  const near = latestKm <= NEAR_KM;

  const previous = withPosition[1];
  const awayBy = previous ? latestKm - roadKm(previous, destination) : 0;
  const movingAway = !near && awayBy > AWAY_KM;

  return {
    destination,
    kmLeft,
    near,
    movingAway,
    awayByKm: Math.round(awayBy),
    driveTime: near ? null : driveTimeLabel(latestKm / AVERAGE_KMPH),
    from: latest,
  };
}

function driveTimeLabel(hours: number): string {
  if (hours < 1) return "under an hour";
  if (hours < 24) return `about ${Math.round(hours)} hr`;
  const days = hours / 24;
  return `about ${days < 1.75 ? "1" : Math.round(days)} day${days < 1.75 ? "" : "s"}`;
}

/** "≈ 182 km left to Mundra" / "Near Mundra". */
export function distanceLine(progress: TripProgress): string {
  if (progress.near) return `Near ${progress.destination.name}`;
  return `≈ ${progress.kmLeft.toLocaleString("en-IN")} km left to ${progress.destination.name}`;
}

/** The (i) text, shared by the truck page and the public page. */
export const DISTANCE_EXPLAINED = [
  `Approximate. Measured in a straight line from the last toll plaza crossed to the destination, then increased by ${Math.round((ROAD_FACTOR - 1) * 100)}% because roads are not straight. The truck has moved since that crossing, so the real distance is usually a little less.`,
  `"Near destination" shows within about ${NEAR_KM} km.`,
];

export const AWAY_EXPLAINED = `Shown when the latest toll crossing is more than ${AWAY_KM} km farther from the destination than the crossing before it. It can be a detour, a wrong destination, or a different trip - no message is sent, it is only a sign to check.`;

/** "GJ12AB4567" -> "GJ12 •• 4567": enough to recognise the truck at the gate. */
export function maskPlate(plate: string): string {
  if (plate.length <= 6) return plate;
  const head = plate.length >= 9 ? 4 : 2;
  return `${plate.slice(0, head)} •• ${plate.slice(-4)}`;
}
