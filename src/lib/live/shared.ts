/**
 * Live tracking module (0079) - shapes and pure helpers that both the browser
 * and the server use. No database access, so Client Components may import it.
 */

export type TripStatus = "planned" | "loading" | "in_transit" | "arrived" | "delivered" | "cancelled";
export type ShareStatus = "invited" | "active" | "stopped" | "revoked";
/** Driver-level link state (0081). "expired" = one-time driver, trip done + N h. */
export type DriverShareStatus = ShareStatus | "expired";
export type DriverKind = "own" | "one_time";
export type VehicleOwnerType = "own" | "dealer" | "supplier" | "transporter";
export type TripPurpose = "dispatch" | "pickup" | "transfer" | "return" | "other";
export type BusinessType = "manufacturer" | "trader" | "distributor" | "transporter" | "other";
/** 0082: outgoing = we send; incoming = a supplier sends to us (trip-only driver/truck/from). */
export type TripDirection = "outgoing" | "incoming";
export type PartyType = "dealer" | "customer" | "internal" | "supplier" | "other";
export type PlaceKind = "factory" | "warehouse" | "branch" | "customer" | "other";

export const TRIP_STATUSES: TripStatus[] = ["planned", "loading", "in_transit", "arrived", "delivered", "cancelled"];
export const OPEN_STATUSES: TripStatus[] = ["planned", "loading", "in_transit", "arrived"];
export const PLACE_KINDS: PlaceKind[] = ["factory", "warehouse", "branch", "customer", "other"];

export const STATUS_LABEL: Record<TripStatus, string> = {
  planned: "Planned",
  loading: "Loading",
  in_transit: "In transit",
  arrived: "Arrived",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

export const STATUS_TONE: Record<TripStatus, "neutral" | "brand" | "good" | "warn" | "bad"> = {
  planned: "neutral",
  loading: "warn",
  in_transit: "brand",
  arrived: "good",
  delivered: "good",
  cancelled: "bad",
};

export const PLACE_KIND_LABEL: Record<PlaceKind, string> = {
  factory: "Factory",
  warehouse: "Warehouse / godown",
  branch: "Branch / office",
  customer: "Customer / dealer",
  other: "Other",
};

/** Which status moves the owner can make from each status (buttons on the trip page). */
export const NEXT_STATUSES: Record<TripStatus, TripStatus[]> = {
  planned: ["loading", "in_transit", "cancelled"],
  loading: ["in_transit", "planned", "cancelled"],
  in_transit: ["arrived", "delivered", "cancelled"],
  arrived: ["delivered", "in_transit", "cancelled"],
  delivered: ["arrived"],
  cancelled: ["planned"],
};

export type LiveTrip = {
  id: string;
  owner_id: string;
  trip_seq: number;
  from_place_id: string | null;
  to_place_id: string | null;
  to_name: string | null;
  to_city: string | null;
  to_lat: number | null;
  to_lng: number | null;
  consignee_name: string | null;
  consignee_phone: string | null;
  vehicle_id: string | null;
  vehicle_no: string | null;
  driver_id: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  transporter: string | null;
  material: string | null;
  quantity: number | null;
  quantity_unit: string | null;
  weight_kg: number | null;
  invoice_no: string | null;
  invoice_value_inr: number | null;
  eway_bill_no: string | null;
  eway_valid_until: string | null;
  lr_no: string | null;
  freight_inr: number | null;
  planned_dispatch_at: string | null;
  promised_delivery_at: string | null;
  status: TripStatus;
  status_at: string;
  started_at: string | null;
  arrived_at: string | null;
  delivered_at: string | null;
  cancelled_at: string | null;
  pod_note: string | null;
  notes: string | null;
  driver_token: string | null;
  share_status: ShareStatus;
  share_consent_at: string | null;
  share_last_seen_at: string | null;
  track_token: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_speed_kmh: number | null;
  last_point_at: string | null;
  distance_left_km: number | null;
  eta_at: string | null;
  seen_at_origin_at: string | null;
  legacy_driver_id: string | null;
  /* 0081 */
  purpose?: TripPurpose | null;
  trip_name?: string | null;
  from_name?: string | null;
  from_lat?: number | null;
  from_lng?: number | null;
  /* 0082 */
  direction?: TripDirection | null;
  party_type?: PartyType | null;
  party_name?: string | null;
  from_address?: string | null;
  to_address?: string | null;
  inline_driver?: boolean | null;
  /* 0083 */
  temp_truck?: boolean | null;
  from_maps_url?: string | null;
  to_maps_url?: string | null;
  archived_at?: string | null;
  route_waypoints?: RouteWaypoint[] | null;
  route_at?: string | null;
  route_lat?: number | null;
  route_lng?: number | null;
  route_source?: "ai" | "rules" | null;
  created_at: string;
  updated_at: string;
};

/** 0083: one city on the approximate road ahead. */
export type RouteWaypoint = { name: string; lat: number; lng: number; km: number };

/** 0083: user-defined master fields, key -> value. */
export type CustomFields = Record<string, string>;

export type LivePlace = {
  id: string;
  owner_id: string;
  kind: PlaceKind;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  gstin: string | null;
  lat: number | null;
  lng: number | null;
  radius_m: number;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  custom_fields?: CustomFields | null;
};

export type LiveVehicle = {
  id: string;
  owner_id: string;
  number: string;
  vehicle_type: string | null;
  ownership: "own" | "market";
  transporter: string | null;
  capacity_kg: number | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  /* 0081 */
  owner_type?: VehicleOwnerType | null;
  custom_fields?: CustomFields | null;
};

export type LiveDriver = {
  id: string;
  owner_id: string;
  name: string;
  phone: string | null;
  license_no: string | null;
  consent_at: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  /* 0081: the driver is the tracked thing */
  kind: DriverKind;
  company: string | null;
  share_token: string | null;
  share_status: DriverShareStatus;
  share_consent_at: string | null;
  share_last_seen_at: string | null;
  share_expires_at: string | null;
  last_lat: number | null;
  last_lng: number | null;
  last_speed_kmh: number | null;
  last_accuracy_m: number | null;
  last_point_at: string | null;
  custom_fields?: CustomFields | null;
};

export type LiveAssignment = {
  id: string;
  owner_id: string;
  driver_id: string;
  vehicle_id: string;
  trip_id: string | null;
  started_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  actor: "owner" | "driver" | "system";
};

export type LiveProfile = {
  owner_id: string;
  business_name: string | null;
  gstin: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  business_type: BusinessType | null;
  default_place_id: string | null;
  one_time_expire_hours: number;
  notify_status: boolean;
  notify_alerts: boolean;
};

export type TripEvent = {
  id: number;
  trip_id: string | null;
  driver_id?: string | null;
  vehicle_id?: string | null;
  field?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  kind: string;
  title: string;
  detail: string | null;
  actor: "owner" | "driver" | "system";
  lat: number | null;
  lng: number | null;
  created_at: string;
  /* 0083 */
  reason?: string | null;
  phase?: TripState | null;
};

export type Point = {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_kmh: number | null;
  heading: number | null;
  recorded_at: string;
};

/* -------------------------------------------------------------------------- */
/* numbers and names                                                           */
/* -------------------------------------------------------------------------- */

export function tripNo(seq: number): string {
  return `T-${String(seq).padStart(4, "0")}`;
}

/** GJ36X1234 -> "GJ 36 X 1234" for reading. */
export function prettyVehicle(no: string | null | undefined): string {
  if (!no) return "";
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(no);
  if (!m) return no;
  return [m[1], m[2], m[3], m[4]].filter(Boolean).join(" ");
}

export function normalizeVehicleNo(raw: string | null | undefined): string {
  return (raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** "1234 5678 9012" -> "123456789012", or null when not 12 digits. */
export function normalizeEway(raw: string | null | undefined): string | null {
  const d = (raw ?? "").replace(/\D/g, "");
  return d.length === 12 ? d : null;
}

export function prettyEway(no: string | null | undefined): string {
  if (!no) return "";
  return no.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/* -------------------------------------------------------------------------- */
/* geo                                                                         */
/* -------------------------------------------------------------------------- */

export const ROAD_FACTOR = 1.25;
export const FALLBACK_KMPH = 40;
/** A position this recent counts as Live. */
export const LIVE_WINDOW_MS = 2.5 * 60 * 1000;
/** No position for this long while in transit = "no signal". */
export const NO_SIGNAL_MS = 30 * 60 * 1000;
/** Standing still this long outside a known place = stoppage. */
export const STOPPAGE_MS = 30 * 60 * 1000;
export const STOPPAGE_RADIUS_M = 300;
/** E-way bill expiring within this window while the truck is moving = warning. */
export const EWAY_WARN_MS = 6 * 60 * 60 * 1000;
/** Dashboard "expiring soon" list. */
export const EWAY_DASH_MS = 12 * 60 * 60 * 1000;
/** ETA later than the promise by this much = delay risk. */
export const DELAY_GRACE_MS = 30 * 60 * 1000;

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function metersBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a, b) * 1000;
}

export function roadKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a, b) * ROAD_FACTOR;
}

/**
 * Average speed from the recent trail (newest first), for the ETA. Path length
 * over elapsed time for the last ~2 hours, clamped to a believable truck range,
 * falling back to 40 km/h when there is too little to go on.
 */
export function recentAvgKmph(points: Point[], now: number = Date.now()): number {
  const recent = points.filter((p) => now - new Date(p.recorded_at).getTime() <= 2 * 60 * 60 * 1000);
  if (recent.length < 4) return FALLBACK_KMPH;
  let km = 0;
  for (let i = 1; i < recent.length; i++) km += haversineKm(recent[i - 1], recent[i]);
  const hours =
    (new Date(recent[0].recorded_at).getTime() - new Date(recent[recent.length - 1].recorded_at).getTime()) / 3_600_000;
  if (hours < 0.25 || km < 2) return FALLBACK_KMPH;
  return Math.min(55, Math.max(25, km / hours));
}

export function etaFrom(distanceKm: number, kmph: number, from: number = Date.now()): Date {
  return new Date(from + (distanceKm / Math.max(kmph, 1)) * 3_600_000);
}

/** "https://www.google.com/maps?q=23.02,72.57" */
export function mapsHref(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

export function directionsHref(lat: number, lng: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/**
 * OpenStreetMap embed with a marker at `at`, framed to include `also` (e.g. the
 * destination) when given and not absurdly far.
 */
export function osmEmbed(at: { lat: number; lng: number }, also?: { lat: number; lng: number } | null): string {
  let minLat = at.lat - 0.02;
  let maxLat = at.lat + 0.02;
  let minLng = at.lng - 0.03;
  let maxLng = at.lng + 0.03;
  if (also) {
    minLat = Math.min(minLat, also.lat);
    maxLat = Math.max(maxLat, also.lat);
    minLng = Math.min(minLng, also.lng);
    maxLng = Math.max(maxLng, also.lng);
    const padLat = (maxLat - minLat) * 0.12;
    const padLng = (maxLng - minLng) * 0.12;
    minLat -= padLat;
    maxLat += padLat;
    minLng -= padLng;
    maxLng += padLng;
  }
  const bbox = [minLng, minLat, maxLng, maxLat].map((n) => n.toFixed(5)).join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${at.lat.toFixed(6)},${at.lng.toFixed(6)}`;
}

/**
 * A lat/lng out of whatever the owner pasted: "23.02, 72.57", a Google Maps
 * link (…@23.02,72.57,15z or ?q=23.02,72.57 or !3d23.02!4d72.57), an OSM link.
 * Short links (maps.app.goo.gl) cannot be read without following them.
 */
export function parseLatLng(raw: string | null | undefined): { lat: number; lng: number } | null {
  if (!raw) return null;
  const s = decodeURIComponent(raw.trim());
  const patterns = [
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,
    /@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /[?&](?:q|query|ll|destination|mlat)=(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/,
    /mlat=(-?\d{1,2}\.\d+)&mlon=(-?\d{1,3}\.\d+)/,
    /^(-?\d{1,2}\.\d+)\s*[, ]\s*(-?\d{1,3}\.\d+)$/,
  ];
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) {
      const lat = Number(m[1]);
      const lng = Number(m[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        return { lat, lng };
      }
    }
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* time                                                                        */
/* -------------------------------------------------------------------------- */

export function agoShort(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "never";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60 ? `${m % 60} min ` : ""}ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** "in 3 h 20 min" / "40 min ago" */
export function untilShort(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - now;
  const abs = Math.abs(ms);
  const m = Math.round(abs / 60000);
  const text = m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
  return ms >= 0 ? `in ${text}` : `${text} ago`;
}

const IST = "Asia/Kolkata";

export function fmtIst(iso: string | null | undefined, withDate = true): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN", {
    timeZone: IST,
    ...(withDate ? { day: "numeric", month: "short" } : {}),
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/** For <input type="datetime-local"> defaultValue, in IST. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const ist = new Date(d.getTime() + 5.5 * 3_600_000);
  return ist.toISOString().slice(0, 16);
}

/** IST "2026-11-24T14:30" from a datetime-local input -> ISO (UTC). */
export function fromLocalInput(value: string | null | undefined): string | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const utc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 5.5 * 3_600_000;
  return new Date(utc).toISOString();
}

/** Start of today in IST, as ISO. */
export function istDayStart(now: number = Date.now()): string {
  const ist = new Date(now + 5.5 * 3_600_000);
  const utcMidnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 5.5 * 3_600_000;
  return new Date(utcMidnight).toISOString();
}

export function inr(v: number | null | undefined): string {
  if (v == null) return "-";
  return `₹${Math.round(v).toLocaleString("en-IN")}`;
}

/** Destination text for a trip row. */
export function destinationText(trip: Pick<LiveTrip, "to_name" | "to_city" | "consignee_name">, placeName?: string | null): string {
  const name = placeName || trip.to_name || trip.consignee_name;
  if (name && trip.to_city && !name.toLowerCase().includes(trip.to_city.toLowerCase())) return `${name}, ${trip.to_city}`;
  return name || trip.to_city || "Destination not set";
}

/** Tracking-state label for the driver's phone link. */
export function signalState(trip: Pick<LiveTrip, "share_status" | "last_point_at" | "share_last_seen_at">, now = Date.now()):
  | "live"
  | "recent"
  | "waiting"
  | "stopped"
  | "off" {
  if (trip.share_status === "revoked") return "off";
  if (trip.share_status === "stopped") return "stopped";
  if (trip.share_status === "invited") return "waiting";
  const seen = new Date(trip.share_last_seen_at ?? trip.last_point_at ?? 0).getTime();
  return now - seen <= LIVE_WINDOW_MS ? "live" : "recent";
}

/* -------------------------------------------------------------------------- */
/* 0081: driver-first                                                          */
/* -------------------------------------------------------------------------- */

export const DRIVER_KIND_LABEL: Record<DriverKind, string> = {
  own: "Own",
  one_time: "Trip-only",
};

export const VEHICLE_OWNER_LABEL: Record<VehicleOwnerType, string> = {
  own: "Own",
  dealer: "Dealer",
  supplier: "Supplier",
  transporter: "Transporter",
};

export const PURPOSE_LABEL: Record<TripPurpose, string> = {
  dispatch: "Dispatch (we send)",
  pickup: "Pickup (we collect)",
  transfer: "Transfer (own sites)",
  return: "Return",
  other: "Other",
};
export const PURPOSES = Object.keys(PURPOSE_LABEL) as TripPurpose[];

export const DIRECTION_LABEL: Record<TripDirection, string> = {
  outgoing: "Sending",
  incoming: "Receiving",
};

export const OUT_PARTY_TYPES: PartyType[] = ["customer", "dealer", "internal", "other"];
export const IN_PARTY_TYPES: PartyType[] = ["supplier", "dealer", "other"];
export const PARTY_TYPE_LABEL: Record<PartyType, string> = {
  customer: "Customer",
  dealer: "Dealer",
  internal: "Own site",
  supplier: "Supplier",
  other: "Other",
};

export function tripDirection(trip: Pick<LiveTrip, "direction">): TripDirection {
  return trip.direction === "incoming" ? "incoming" : "outgoing";
}

export const BUSINESS_TYPE_LABEL: Record<BusinessType, string> = {
  manufacturer: "Manufacturer",
  trader: "Trader",
  distributor: "Distributor / dealer",
  transporter: "Transporter",
  other: "Other",
};

/** Own sites (Warehouses master) vs customer/other places. */
export const OWN_SITE_KINDS: PlaceKind[] = ["factory", "warehouse", "branch"];

/** "No signal" = sharing switched on but no position for this long. */
export const IDLE_MS = 30 * 60 * 1000;

export type DriverSignal = "live" | "recent" | "idle" | "waiting" | "stopped" | "expired" | "off";

/**
 * What the Drivers home shows for a driver:
 *   live    - position in the last 2.5 min
 *   recent  - sharing, last position < 30 min ago
 *   idle    - sharing on but nothing for 30+ min (phone off, no network, page closed)
 *   waiting - link sent, never opened / never shared
 *   stopped - the driver tapped Stop
 *   expired - one-time driver, trip done + N h
 *   off     - you switched his link off
 */
export function driverSignal(
  d: Pick<LiveDriver, "share_status" | "share_last_seen_at" | "last_point_at" | "share_expires_at">,
  now = Date.now(),
): DriverSignal {
  if (d.share_status === "revoked") return "off";
  if (d.share_status === "expired" || (d.share_expires_at && new Date(d.share_expires_at).getTime() <= now)) return "expired";
  if (d.share_status === "stopped") return "stopped";
  if (d.share_status === "invited") return "waiting";
  const seen = new Date(d.share_last_seen_at ?? d.last_point_at ?? 0).getTime();
  if (now - seen <= LIVE_WINDOW_MS) return "live";
  return now - seen <= IDLE_MS ? "recent" : "idle";
}

export const SIGNAL_LABEL: Record<DriverSignal, string> = {
  live: "Live",
  recent: "Last seen",
  idle: "No signal",
  waiting: "Link not opened",
  stopped: "Stopped sharing",
  expired: "Sharing ended",
  off: "Link off",
};

/** Home grouping: Live / Last seen / Idle (everything not reporting now). */
export function signalGroup(s: DriverSignal): "live" | "seen" | "idle" {
  if (s === "live") return "live";
  if (s === "recent") return "seen";
  return "idle";
}

/* ---- trip edit rules ----------------------------------------------------- */

/**
 * Which trip fields can change, by phase. Enforced in src/app/live/actions.ts
 * (updateTrip); the edit form shows locked fields read-only.
 *
 *   LOCKED always: trip number, trip name, created time, actual timestamps.
 *   BEFORE START (planned, loading): everything below.
 *   AFTER START (in transit, arrived): only the DYNAMIC fields - who drives,
 *     which truck, where it is going, when it should arrive, e-way bill
 *     (Part-B changes with the truck), customer contact, notes.
 *   CLOSED (delivered, cancelled): nothing; add a note, or reopen first.
 */
export const TRIP_FIELDS_DYNAMIC = [
  "driver_id",
  "vehicle_id",
  "to",
  "promised_delivery_at",
  "eway_bill_no",
  "eway_valid_until",
  "consignee_name",
  "consignee_phone",
  "notes",
] as const;

export const TRIP_FIELDS_BEFORE_START = [
  ...TRIP_FIELDS_DYNAMIC,
  "purpose",
  "from",
  "material",
  "quantity",
  "quantity_unit",
  "weight_kg",
  "invoice_no",
  "invoice_value_inr",
  "lr_no",
  "transporter",
  "freight_inr",
  "planned_dispatch_at",
  "party_name",
  "party_type",
] as const;

export type TripPhase = "before_start" | "started" | "closed";

export function tripPhase(status: TripStatus): TripPhase {
  if (status === "planned" || status === "loading") return "before_start";
  if (status === "in_transit" || status === "arrived") return "started";
  return "closed";
}

export function tripFieldEditable(status: TripStatus, field: string): boolean {
  const phase = tripPhase(status);
  if (phase === "closed") return false;
  if (phase === "started") return (TRIP_FIELDS_DYNAMIC as readonly string[]).includes(field);
  return (TRIP_FIELDS_BEFORE_START as readonly string[]).includes(field);
}

export function tripTitle(trip: Pick<LiveTrip, "trip_seq" | "trip_name">): string {
  return trip.trip_name ? `${tripNo(trip.trip_seq)} · ${trip.trip_name}` : tripNo(trip.trip_seq);
}

export function originText(trip: Pick<LiveTrip, "from_name">, placeName?: string | null): string | null {
  return placeName || trip.from_name || null;
}

/* -------------------------------------------------------------------------- */
/* 0083 (v4): four user-facing states over the six stored statuses             */
/* -------------------------------------------------------------------------- */

export type TripState = "planned" | "active" | "done" | "cancelled";
export const TRIP_STATES: TripState[] = ["planned", "active", "done", "cancelled"];

export const STATE_OF: Record<TripStatus, TripState> = {
  planned: "planned",
  loading: "planned",
  in_transit: "active",
  arrived: "active",
  delivered: "done",
  cancelled: "cancelled",
};

export const STATE_LABEL: Record<TripState, string> = {
  planned: "Planned",
  active: "Active",
  done: "Done",
  cancelled: "Cancelled",
};

export const STATE_TONE: Record<TripState, "neutral" | "brand" | "good" | "bad"> = {
  planned: "neutral",
  active: "brand",
  done: "good",
  cancelled: "bad",
};

/** Stored statuses behind each state (filters, queries). */
export const STATE_STATUSES: Record<TripState, TripStatus[]> = {
  planned: ["planned", "loading"],
  active: ["in_transit", "arrived"],
  done: ["delivered"],
  cancelled: ["cancelled"],
};

export const ACTIVE_STATUSES: TripStatus[] = STATE_STATUSES.active;

export function tripState(trip: Pick<LiveTrip, "status">): TripState {
  return STATE_OF[trip.status] ?? "planned";
}

/** The stored status a state change writes. Active keeps "arrived" when the truck had arrived. */
export function statusForState(to: TripState, trip: Pick<LiveTrip, "status" | "arrived_at">): TripStatus {
  if (to === "active") return trip.status === "arrived" || (trip.status === "delivered" && trip.arrived_at) ? "arrived" : "in_transit";
  if (to === "done") return "delivered";
  return to;
}

/** Changes on an Active trip that need a reason (logged in the trip activity). */
export const REASON_FIELDS = ["driver", "truck", "to"] as const;

/** Phase an activity row belongs to: stored (0083) or worked out from the trip's times. */
export function eventPhase(
  e: Pick<TripEvent, "phase" | "created_at">,
  trip: Pick<LiveTrip, "started_at" | "delivered_at" | "cancelled_at"> | null,
): TripState {
  if (e.phase) return e.phase;
  if (!trip) return "planned";
  const t = new Date(e.created_at).getTime();
  if (trip.cancelled_at && t >= new Date(trip.cancelled_at).getTime()) return "cancelled";
  if (trip.delivered_at && t >= new Date(trip.delivered_at).getTime()) return "done";
  if (trip.started_at && t >= new Date(trip.started_at).getTime()) return "active";
  return "planned";
}

/** IST calendar day "2026-11-25" of an instant. */
export function istDayKey(iso: string): string {
  return new Date(new Date(iso).getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
}

/** "Wed, 25 Nov" for a day key. */
export function dayLabel(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  return d.toLocaleDateString("en-IN", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" });
}

/** Start of an IST day key, as ISO (UTC). */
export function istDayStartOf(key: string): string {
  return new Date(Date.parse(`${key}T00:00:00Z`) - 5.5 * 3_600_000).toISOString();
}

/** Clean user-defined fields from a stored value. */
export function customFieldsOf(v: unknown): [string, string][] {
  if (!v || typeof v !== "object" || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>)
    .filter(([k, x]) => k && typeof x === "string")
    .map(([k, x]) => [k, x as string]);
}

/** The ETA factors shown behind the (i) on a trip. */
export function etaBasis(points: Point[], distanceLeftKm: number | null, now = Date.now()) {
  const kmph = recentAvgKmph(points, now);
  const recent = points.filter((p) => now - new Date(p.recorded_at).getTime() <= 2 * 60 * 60 * 1000).length;
  return {
    roadFactor: ROAD_FACTOR,
    kmph: Math.round(kmph),
    fallback: recent < 4,
    points2h: recent,
    distanceLeftKm,
    hoursLeft: distanceLeftKm != null ? distanceLeftKm / Math.max(kmph, 1) : null,
  };
}
