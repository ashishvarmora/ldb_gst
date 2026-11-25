import { notFound, redirect } from "next/navigation";
import { Lock } from "lucide-react";

import { loadDriverBoard, loadPlaces, loadTrip, requireLiveSession } from "@/lib/live/server";
import { tripNo, tripPhase, tripTitle } from "@/lib/live/shared";

import { BackLink } from "../../../BackLink";
import { tripPrefill } from "../../../trip-prefill";
import { TripEditForm } from "./TripEditForm";

export const metadata = { title: "Live tracking - Edit trip" };
export const dynamic = "force-dynamic";

export default async function EditTripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { ownerId } = await requireLiveSession();
  const [trip, places, { rows, vehicles }] = await Promise.all([loadTrip(ownerId, id), loadPlaces(ownerId, { includeArchived: true }), loadDriverBoard(ownerId)]);
  if (!trip) notFound();
  const phase = tripPhase(trip.status);
  if (phase === "closed") redirect(`/live/trips/${trip.id}`);

  const holder = new Map(rows.filter((r) => r.vehicle).map((r) => [r.vehicle!.id, r.driver]));
  return (
    <div className="live-page mx-auto max-w-2xl space-y-4">
      <BackLink href={`/live/trips/${trip.id}`} label={tripNo(trip.trip_seq)} />
      <header className="live-page-head">
        <div>
          <h1>Edit {tripTitle(trip)}</h1>
          <p className="flex items-center gap-1">
            {phase === "started" ? (
              <>
                <Lock size={13} /> Trip has started: driver, truck, destination, arrival time, e-way bill and contact can still change.
              </>
            ) : (
              "Not started yet: everything except the trip number and name can change."
            )}
          </p>
        </div>
      </header>
      <TripEditForm
        tripId={trip.id}
        status={trip.status}
        driverId={trip.driver_id}
        vehicleId={trip.vehicle_id}
        drivers={rows.map((r) => ({ id: r.driver.id, name: r.driver.name, busyTrip: r.trip && r.trip.id !== trip.id ? tripNo(r.trip.trip_seq) : null }))}
        vehicles={vehicles.map((v) => ({ id: v.id, number: v.number, holderId: holder.get(v.id)?.id ?? null, holderName: holder.get(v.id)?.name ?? null }))}
        places={places}
        initial={tripPrefill(trip)}
      />
    </div>
  );
}
