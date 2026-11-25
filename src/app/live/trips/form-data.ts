import "server-only";

import { loadDriverBoard, loadLiveProfile, loadOpenTrips, loadPlaces } from "@/lib/live/server";
import { ACTIVE_STATUSES, OWN_SITE_KINDS, tripNo } from "@/lib/live/shared";

import type { FormDriver, FormPlace, FormVehicle } from "./TripForm";

/** Masters for the trip form: own drivers, trucks, warehouses (+ older saved places), with "on T-0007" busy marks. */
export async function tripFormData(ownerId: string, exceptTripId?: string) {
  const [{ rows, vehicles }, places, open, profile] = await Promise.all([
    loadDriverBoard(ownerId),
    loadPlaces(ownerId),
    loadOpenTrips(ownerId),
    loadLiveProfile(ownerId),
  ]);
  const activeOther = open.filter((t) => ACTIVE_STATUSES.includes(t.status) && t.id !== exceptTripId);
  const busyDriver = new Map(activeOther.filter((t) => t.driver_id).map((t) => [t.driver_id!, tripNo(t.trip_seq)]));
  const busyTruck = new Map(activeOther.filter((t) => t.vehicle_id).map((t) => [t.vehicle_id!, tripNo(t.trip_seq)]));
  const drivers: FormDriver[] = rows
    .filter((r) => r.driver.kind === "own")
    .map((r) => ({ id: r.driver.id, name: r.driver.name, phone: r.driver.phone, busy: busyDriver.get(r.driver.id) ?? null }));
  const trucks: FormVehicle[] = vehicles.map((v) => ({ id: v.id, number: v.number, busy: busyTruck.get(v.id) ?? null }));
  const toForm = (p: (typeof places)[number]): FormPlace => ({ id: p.id, name: p.name, lat: p.lat, lng: p.lng });
  return {
    drivers,
    vehicles: trucks,
    warehouses: places.filter((p) => OWN_SITE_KINDS.includes(p.kind)).map(toForm),
    otherPlaces: places.filter((p) => !OWN_SITE_KINDS.includes(p.kind)).map(toForm),
    defaultPlaceId: profile.default_place_id,
  };
}
