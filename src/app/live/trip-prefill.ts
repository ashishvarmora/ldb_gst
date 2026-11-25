/**
 * Server-safe: a trip row -> the trip form's initial values (v4 TripForm).
 * Kept outside the client component because the new/edit pages call it on
 * the server.
 */
import type { LiveTrip } from "@/lib/live/shared";
import { toLocalInput } from "@/lib/live/shared";
import { indianMobileDigits } from "@/lib/phone";

export type TripPrefill = Record<
  | "direction"
  | "driver_mode"
  | "driver_id"
  | "tmp_driver_name"
  | "tmp_driver_phone"
  | "truck_mode"
  | "vehicle_id"
  | "tmp_truck_no"
  | "from_mode"
  | "from_place_id"
  | "from_name"
  | "from_address"
  | "from_location"
  | "to_mode"
  | "to_place_id"
  | "to_name"
  | "to_address"
  | "to_location"
  | "to_city"
  | "purpose"
  | "party_type"
  | "party_name"
  | "consignee_name"
  | "consignee_phone"
  | "transporter"
  | "material"
  | "quantity"
  | "quantity_unit"
  | "weight_kg"
  | "invoice_no"
  | "invoice_value_inr"
  | "eway_bill_no"
  | "eway_valid_until"
  | "lr_no"
  | "freight_inr"
  | "planned_dispatch_at"
  | "promised_delivery_at"
  | "journey_hours"
  | "notes",
  string
>;

const s = (v: unknown) => (v == null ? "" : String(v));

function journeyText(trip: Partial<LiveTrip> | null | undefined): string {
  if (!trip) return "";
  const j = trip.journey_hours != null ? Number(trip.journey_hours) : NaN;
  if (Number.isFinite(j) && j > 0) return String(Math.round(j * 4) / 4);
  if (trip.planned_dispatch_at && trip.promised_delivery_at) {
    const h = (Date.parse(trip.promised_delivery_at) - Date.parse(trip.planned_dispatch_at)) / 3_600_000;
    if (Number.isFinite(h) && h > 0) return String(Math.round(h * 4) / 4);
  }
  return "";
}

function loc(lat: number | null | undefined, lng: number | null | undefined, url: string | null | undefined): string {
  if (lat != null && lng != null) return `${lat}, ${lng}`;
  return s(url);
}

/** `copy` = "same route again": route, goods and parties, not documents or people. */
export function tripPrefill(
  trip: Partial<LiveTrip> | null,
  opts: { direction?: "outgoing" | "incoming"; defaultPlaceId?: string | null; copy?: boolean } = {},
): TripPrefill {
  const dir = (trip?.direction as string) || opts.direction || "outgoing";
  const home = opts.defaultPlaceId ?? "";
  const fromCustom = Boolean(trip && !trip.from_place_id && (trip.from_name || trip.from_lat != null));
  const toCustom = Boolean(trip && !trip.to_place_id && (trip.to_name || trip.to_lat != null));
  const people = trip && !opts.copy;
  const tempDriver = Boolean(people && trip?.inline_driver);
  const tempTruck = Boolean(people && trip?.vehicle_no && !trip?.vehicle_id);
  return {
    direction: dir,
    driver_mode: tempDriver ? "custom" : "master",
    driver_id: people && !tempDriver ? s(trip?.driver_id) : "",
    tmp_driver_name: tempDriver ? s(trip?.driver_name) : "",
    tmp_driver_phone: tempDriver ? (indianMobileDigits(trip?.driver_phone) ?? "") : "",
    truck_mode: tempTruck ? "custom" : people && !trip?.vehicle_no ? "none" : "master",
    vehicle_id: people ? s(trip?.vehicle_id) : "",
    tmp_truck_no: tempTruck ? s(trip?.vehicle_no) : "",
    from_mode: fromCustom || (!trip && dir === "incoming") ? "custom" : "place",
    from_place_id: trip ? s(trip.from_place_id) : dir === "outgoing" ? home : "",
    from_name: fromCustom ? s(trip?.from_name) : "",
    from_address: s(trip?.from_address),
    from_location: fromCustom ? loc(trip?.from_lat, trip?.from_lng, trip?.from_maps_url) : "",
    to_mode: toCustom || (!trip && dir === "outgoing") ? "custom" : "place",
    to_place_id: trip ? s(trip.to_place_id) : dir === "incoming" ? home : "",
    to_name: toCustom ? s(trip?.to_name) : "",
    to_address: toCustom ? s(trip?.to_address) : "",
    to_location: toCustom ? loc(trip?.to_lat, trip?.to_lng, trip?.to_maps_url) : "",
    to_city: s(trip?.to_city),
    purpose: s(trip?.purpose) || (dir === "incoming" ? "pickup" : "dispatch"),
    party_type: s(trip?.party_type) || (dir === "incoming" ? "supplier" : "customer"),
    party_name: s(trip?.party_name),
    consignee_name: s(trip?.consignee_name),
    consignee_phone: indianMobileDigits(trip?.consignee_phone) ?? "",
    transporter: s(trip?.transporter),
    material: s(trip?.material),
    quantity: people ? s(trip?.quantity) : "",
    quantity_unit: s(trip?.quantity_unit) || "boxes",
    weight_kg: people ? s(trip?.weight_kg) : "",
    invoice_no: people ? s(trip?.invoice_no) : "",
    invoice_value_inr: people ? s(trip?.invoice_value_inr) : "",
    eway_bill_no: people ? s(trip?.eway_bill_no) : "",
    eway_valid_until: people ? toLocalInput(trip?.eway_valid_until) : "",
    lr_no: people ? s(trip?.lr_no) : "",
    freight_inr: people ? s(trip?.freight_inr) : "",
    planned_dispatch_at: people ? toLocalInput(trip?.planned_dispatch_at) : "",
    promised_delivery_at: people ? toLocalInput(trip?.promised_delivery_at) : "",
    // v6: journey hours (0085), else what the old planned arrival implied. Copied with the route ("same route again").
    journey_hours: journeyText(trip),
    notes: people ? s(trip?.notes) : "",
  };
}
