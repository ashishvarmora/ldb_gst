/**
 * Server-safe: turns a trip row into the trip form's initial values. Lives
 * outside TripFields.tsx (a client file) because the create and edit pages
 * call it on the server.
 */
import type { LiveTrip } from "@/lib/live/shared";
import { toLocalInput } from "@/lib/live/shared";
import { indianMobileDigits } from "@/lib/phone";

export type TripPrefill = Record<
  | "purpose"
  | "from_place_id"
  | "from_name"
  | "to_place_id"
  | "to_name"
  | "to_city"
  | "to_location"
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
  | "notes",
  string
>;

const s = (v: unknown) => (v == null ? "" : String(v));

export function tripPrefill(trip: Partial<LiveTrip> | null, defaultFromId?: string | null): TripPrefill {
  return {
    purpose: s(trip?.purpose),
    from_place_id: trip ? s(trip.from_place_id) : s(defaultFromId),
    from_name: s(trip?.from_name),
    to_place_id: s(trip?.to_place_id),
    to_name: trip?.to_place_id ? "" : s(trip?.to_name),
    to_city: s(trip?.to_city),
    to_location: trip?.to_lat != null && trip?.to_lng != null ? `${trip.to_lat}, ${trip.to_lng}` : "",
    consignee_name: s(trip?.consignee_name),
    consignee_phone: indianMobileDigits(trip?.consignee_phone) ?? "",
    transporter: s(trip?.transporter),
    material: s(trip?.material),
    quantity: s(trip?.quantity),
    quantity_unit: s(trip?.quantity_unit) || "boxes",
    weight_kg: s(trip?.weight_kg),
    invoice_no: s(trip?.invoice_no),
    invoice_value_inr: s(trip?.invoice_value_inr),
    eway_bill_no: s(trip?.eway_bill_no),
    eway_valid_until: toLocalInput(trip?.eway_valid_until),
    lr_no: s(trip?.lr_no),
    freight_inr: s(trip?.freight_inr),
    planned_dispatch_at: toLocalInput(trip?.planned_dispatch_at),
    promised_delivery_at: toLocalInput(trip?.promised_delivery_at),
    notes: s(trip?.notes),
  };
}

