import { notFound, redirect } from "next/navigation";
import { Lock } from "lucide-react";

import { loadDriverBoard, loadPlaces, loadTrip, requireLiveSession, UUID_RE } from "@/lib/live/server";
import { DIRECTION_LABEL, OWN_SITE_KINDS, tripDirection, tripNo, tripPhase, tripTitle } from "@/lib/live/shared";
import { indianMobileDigits } from "@/lib/phone";

import { BackLink } from "../../../BackLink";
import { tripPrefill } from "../../../trip-prefill";
import { TripSetupForm, type SetupPlace } from "./TripSetupForm";

export const metadata = { title: "Live tracking - Trip setup" };
export const dynamic = "force-dynamic";

/**
 * /live/trips/[id]/edit - set up (after "New trip") and later change a trip.
 * ?setup=1 right after creation. ?picked_driver / picked_vehicle / picked_place
 * come back from a master's "Add new" and are preselected.
 */
export default async function EditTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ setup?: string; picked_driver?: string; picked_vehicle?: string; picked_place?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { ownerId } = await requireLiveSession();
  const [trip, places, { rows, vehicles }] = await Promise.all([loadTrip(ownerId, id), loadPlaces(ownerId), loadDriverBoard(ownerId)]);
  if (!trip) notFound();
  const phase = tripPhase(trip.status);
  if (phase === "closed") redirect(`/live/trips/${trip.id}`);
  const direction = tripDirection(trip);
  const setup = sp.setup === "1";
  const pick = (v: string | undefined) => (v && UUID_RE.test(v) ? v : null);

  const toSetup = (p: (typeof places)[number]): SetupPlace => ({ id: p.id, name: p.name, city: p.city, lat: p.lat, lng: p.lng });
  const warehouses = places.filter((p) => OWN_SITE_KINDS.includes(p.kind)).map(toSetup);
  const customers = places.filter((p) => !OWN_SITE_KINDS.includes(p.kind)).map(toSetup);

  // Masters: own drivers only (trip-only drivers of receiving trips are not listed).
  const ownRows = rows.filter((r) => r.driver.kind === "own");
  const holder = new Map(rows.filter((r) => r.vehicle).map((r) => [r.vehicle!.id, r.driver]));

  const initial = tripPrefill(trip);
  const pickedPlace = pick(sp.picked_place);
  if (pickedPlace && warehouses.some((w) => w.id === pickedPlace)) {
    if (direction === "incoming") initial.to_place_id = pickedPlace;
    else initial.from_place_id = pickedPlace;
  }
  const pickedDriver = pick(sp.picked_driver);
  const pickedVehicle = pick(sp.picked_vehicle);
  const hasDetails = Boolean(trip.purpose || trip.from_place_id || trip.to_place_id || trip.to_name || trip.party_name || trip.from_name);

  return (
    <div className="live-page mx-auto max-w-2xl space-y-3">
      <BackLink href={`/live/trips/${trip.id}`} label={tripNo(trip.trip_seq)} />
      <header className="live-page-head">
        <div>
          <h1>
            {setup ? "Set up" : "Edit"} {tripTitle(trip)}
          </h1>
          <p className="flex items-center gap-1">
            <span className={`live-dir live-dir-${direction}`}>{DIRECTION_LABEL[direction]}</span>
            {phase === "started" ? (
              <>
                <Lock size={12} /> Started: driver, truck, destination, arrival, e-way bill and contact can still change.
              </>
            ) : setup ? (
              "Add the driver to start tracking. The rest is optional."
            ) : (
              "Trip number and name are fixed."
            )}
          </p>
        </div>
      </header>
      <TripSetupForm
        tripId={trip.id}
        direction={direction}
        status={trip.status}
        setup={setup}
        driverId={pickedDriver && ownRows.some((r) => r.driver.id === pickedDriver) ? pickedDriver : trip.driver_id}
        vehicleId={pickedVehicle && vehicles.some((v) => v.id === pickedVehicle) ? pickedVehicle : trip.vehicle_id}
        inline={{ driverName: trip.driver_name ?? "", driverPhone: indianMobileDigits(trip.driver_phone) ?? "", truckNo: trip.vehicle_no ?? "" }}
        drivers={ownRows.map((r) => ({
          id: r.driver.id,
          name: r.driver.name,
          phone: r.driver.phone,
          busyTrip: r.trip && r.trip.id !== trip.id ? tripNo(r.trip.trip_seq) : null,
          truckId: r.vehicle?.id ?? null,
        }))}
        vehicles={vehicles.map((v) => ({ id: v.id, number: v.number, holderId: holder.get(v.id)?.id ?? null, holderName: holder.get(v.id)?.name ?? null }))}
        warehouses={warehouses}
        customers={customers}
        initial={initial}
        detailsOn={setup || hasDetails || Boolean(pickedPlace)}
        returnTo={`/live/trips/${trip.id}/edit${setup ? "?setup=1" : ""}`}
      />
    </div>
  );
}
