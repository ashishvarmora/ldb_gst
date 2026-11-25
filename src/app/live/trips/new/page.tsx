import { loadDrivers, loadPlaces, loadVehicles, requireLiveSession } from "@/lib/live/server";

import { createTrip } from "../../actions";
import { BackLink } from "../../BackLink";
import { TripForm } from "../TripForm";

export const metadata = { title: "Live tracking - New trip" };
export const dynamic = "force-dynamic";

export default async function NewTripPage() {
  const { ownerId } = await requireLiveSession();
  const [places, vehicles, drivers] = await Promise.all([loadPlaces(ownerId), loadVehicles(ownerId), loadDrivers(ownerId)]);
  return (
    <div className="live-page mx-auto max-w-3xl space-y-4">
      <BackLink href="/live/trips" label="Trips" />
      <header className="live-page-head">
        <div>
          <h1>New trip</h1>
          <p>Vehicle and destination are enough to start. Add the rest any time.</p>
        </div>
      </header>
      <TripForm action={createTrip} trip={null} places={places} vehicles={vehicles} drivers={drivers} />
    </div>
  );
}
