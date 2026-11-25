import { notFound } from "next/navigation";

import { loadDrivers, loadPlaces, loadTrip, loadVehicles, requireLiveSession } from "@/lib/live/server";
import { tripNo } from "@/lib/live/shared";

import { updateTrip } from "../../../actions";
import { BackLink } from "../../../BackLink";
import { TripForm } from "../../TripForm";

export const metadata = { title: "Live tracking - Edit trip" };
export const dynamic = "force-dynamic";

export default async function EditTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ copied?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { ownerId } = await requireLiveSession();
  const [trip, places, vehicles, drivers] = await Promise.all([
    loadTrip(ownerId, id),
    loadPlaces(ownerId),
    loadVehicles(ownerId),
    loadDrivers(ownerId),
  ]);
  if (!trip) notFound();
  return (
    <div className="live-page mx-auto max-w-3xl space-y-4">
      <BackLink href={`/live/trips/${trip.id}`} label={tripNo(trip.trip_seq)} />
      <header className="live-page-head">
        <div>
          <h1>Edit {tripNo(trip.trip_seq)}</h1>
          {sp.copied ? <p>Copied from an earlier trip - add the vehicle, driver and documents.</p> : null}
        </div>
      </header>
      <TripForm action={updateTrip} trip={trip} places={places} vehicles={vehicles} drivers={drivers} />
    </div>
  );
}
