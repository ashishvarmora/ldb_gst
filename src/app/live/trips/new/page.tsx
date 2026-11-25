import { loadTrip, requireLiveSession, UUID_RE } from "@/lib/live/server";
import { tripDirection, tripNo } from "@/lib/live/shared";

import { BackLink } from "../../BackLink";
import { tripPrefill } from "../../trip-prefill";
import { tripFormData } from "../form-data";
import { TripForm } from "../TripForm";

export const metadata = { title: "Live tracking - New trip" };
export const dynamic = "force-dynamic";

/**
 * /live/trips/new - the one New-trip screen (v4): direction, name, driver,
 * truck, from, to, more. Saved as Planned. ?copy=<tripId> = same route again,
 * ?dir=incoming preselects; ?picked_* come back from a master's "+ New".
 */
export default async function NewTripPage({
  searchParams,
}: {
  searchParams: Promise<{ copy?: string; dir?: string; picked_driver?: string; picked_vehicle?: string; picked_place?: string }>;
}) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const copy = sp.copy && UUID_RE.test(sp.copy) ? await loadTrip(ownerId, sp.copy) : null;
  const dir = copy ? tripDirection(copy) : sp.dir === "incoming" ? "incoming" : "outgoing";
  const data = await tripFormData(ownerId);
  const initial = tripPrefill(copy, { direction: dir, defaultPlaceId: data.defaultPlaceId, copy: true });
  const pick = (v?: string) => (v && UUID_RE.test(v) ? v : null);
  const pd = pick(sp.picked_driver);
  if (pd && data.drivers.some((d) => d.id === pd)) Object.assign(initial, { driver_mode: "master", driver_id: pd });
  const pv = pick(sp.picked_vehicle);
  if (pv && data.vehicles.some((x) => x.id === pv)) Object.assign(initial, { truck_mode: "master", vehicle_id: pv });
  const pp = pick(sp.picked_place);
  if (pp && data.warehouses.some((w) => w.id === pp)) {
    if (dir === "incoming") Object.assign(initial, { to_mode: "place", to_place_id: pp });
    else Object.assign(initial, { from_mode: "place", from_place_id: pp });
  }
  return (
    <div className="live-page mx-auto max-w-xl space-y-3">
      <BackLink href="/live/trips" label="Home" />
      <header className="live-page-head">
        <div>
          <h1>New trip</h1>
          <p>{copy ? `Same route as ${tripNo(copy.trip_seq)}.` : "Saved as Planned. Start it when the truck leaves."}</p>
        </div>
      </header>
      <TripForm
        mode="create"
        initial={initial}
        drivers={data.drivers}
        vehicles={data.vehicles}
        warehouses={data.warehouses}
        otherPlaces={data.otherPlaces}
        returnTo={`/live/trips/new${dir === "incoming" ? "?dir=incoming" : ""}`}
      />
    </div>
  );
}
