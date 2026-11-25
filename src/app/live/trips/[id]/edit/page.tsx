import { notFound, redirect } from "next/navigation";

import { loadTrip, requireLiveSession, UUID_RE } from "@/lib/live/server";
import { DIRECTION_LABEL, STATE_LABEL, tripDirection, tripNo, tripState, tripTitle } from "@/lib/live/shared";

import { BackLink } from "../../../BackLink";
import { tripPrefill } from "../../../trip-prefill";
import { tripFormData } from "../../form-data";
import { TripForm } from "../../TripForm";

export const metadata = { title: "Live tracking - Edit trip" };
export const dynamic = "force-dynamic";

/**
 * /live/trips/[id]/edit (v4). Planned: everything. Active: driver, truck,
 * destination with a reason, plus arrival / e-way bill / contact / notes.
 * Done or Cancelled: back to the trip (reopen first).
 */
export default async function EditTripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ picked_driver?: string; picked_vehicle?: string; picked_place?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const { ownerId } = await requireLiveSession();
  const trip = await loadTrip(ownerId, id);
  if (!trip) notFound();
  const state = tripState(trip);
  if (state === "done" || state === "cancelled") redirect(`/live/trips/${trip.id}`);
  const data = await tripFormData(ownerId, trip.id);
  const initial = tripPrefill(trip);
  const pick = (v?: string) => (v && UUID_RE.test(v) ? v : null);
  const pd = pick(sp.picked_driver);
  if (pd && data.drivers.some((d) => d.id === pd)) Object.assign(initial, { driver_mode: "master", driver_id: pd });
  const pv = pick(sp.picked_vehicle);
  if (pv && data.vehicles.some((x) => x.id === pv)) Object.assign(initial, { truck_mode: "master", vehicle_id: pv });
  const pp = pick(sp.picked_place);
  if (pp && data.warehouses.some((w) => w.id === pp)) {
    if (tripDirection(trip) === "incoming" || state === "active") Object.assign(initial, { to_mode: "place", to_place_id: pp });
    else Object.assign(initial, { from_mode: "place", from_place_id: pp });
  }
  const direction = tripDirection(trip);
  return (
    <div className="live-page mx-auto max-w-xl space-y-3">
      <BackLink href={`/live/trips/${trip.id}`} label={tripNo(trip.trip_seq)} />
      <header className="live-page-head">
        <div>
          <h1>Edit {tripTitle(trip)}</h1>
          <p className="flex flex-wrap items-center gap-1">
            <span className={`live-dir live-dir-${direction}`}>{DIRECTION_LABEL[direction]}</span>
            <span>{STATE_LABEL[state]}{state === "active" ? " - driver, truck and destination need a reason." : " - everything can change."}</span>
          </p>
        </div>
      </header>
      <TripForm
        mode={state === "active" ? "active" : "planned"}
        tripId={trip.id}
        tripLabel={tripNo(trip.trip_seq)}
        initial={initial}
        drivers={data.drivers}
        vehicles={data.vehicles}
        warehouses={data.warehouses}
        otherPlaces={data.otherPlaces}
        returnTo={`/live/trips/${trip.id}/edit`}
      />
    </div>
  );
}
