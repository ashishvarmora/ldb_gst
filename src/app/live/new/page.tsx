import { loadDriverBoard, loadLiveProfile, loadPlaces, loadTrip, requireLiveSession, UUID_RE } from "@/lib/live/server";
import { tripNo } from "@/lib/live/shared";

import { BackLink } from "../BackLink";
import { tripPrefill } from "../trip-prefill";
import { NewTrackingForm, type DriverOption, type VehicleOption } from "./NewTrackingForm";

export const metadata = { title: "Live tracking - Track a driver" };
export const dynamic = "force-dynamic";

/**
 * /live/new - the one create screen. ?driver=<id> preselects a driver,
 * ?trip=1 opens trip details, ?copy=<tripId> fills the trip from an earlier one.
 */
export default async function NewTrackingPage({
  searchParams,
}: {
  searchParams: Promise<{ driver?: string; trip?: string; copy?: string }>;
}) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const [{ rows, vehicles }, places, profile, copy] = await Promise.all([
    loadDriverBoard(ownerId),
    loadPlaces(ownerId),
    loadLiveProfile(ownerId),
    sp.copy && UUID_RE.test(sp.copy) ? loadTrip(ownerId, sp.copy) : Promise.resolve(null),
  ]);

  const drivers: DriverOption[] = rows.map(({ driver, vehicle, trip }) => ({
    id: driver.id,
    name: driver.name,
    phone: driver.phone,
    kind: driver.kind,
    company: driver.company,
    truck: vehicle?.number ?? null,
    busyTrip: trip ? tripNo(trip.trip_seq) : null,
  }));
  const holder = new Map(rows.filter((r) => r.vehicle).map((r) => [r.vehicle!.id, r.driver]));
  const vehicleOptions: VehicleOption[] = vehicles.map((v) => ({
    id: v.id,
    number: v.number,
    owner_type: v.owner_type ?? null,
    holderId: holder.get(v.id)?.id ?? null,
    holderName: holder.get(v.id)?.name ?? null,
  }));

  // "Same route again": route, purpose and goods description, not documents.
  const initial = tripPrefill(
    copy
      ? {
          purpose: copy.purpose,
          from_place_id: copy.from_place_id,
          from_name: copy.from_name,
          to_place_id: copy.to_place_id,
          to_name: copy.to_name,
          to_city: copy.to_city,
          to_lat: copy.to_lat,
          to_lng: copy.to_lng,
          consignee_name: copy.consignee_name,
          consignee_phone: copy.consignee_phone,
          transporter: copy.transporter,
          material: copy.material,
          quantity_unit: copy.quantity_unit,
        }
      : null,
    profile.default_place_id,
  );

  const preselect = sp.driver && drivers.some((d) => d.id === sp.driver) ? sp.driver : null;

  return (
    <div className="live-page mx-auto max-w-2xl space-y-4">
      <BackLink href="/live" label="Drivers" />
      <header className="live-page-head">
        <div>
          <h1>Track a driver</h1>
          <p>Driver is enough. Add a truck or a trip only if you need it.</p>
        </div>
      </header>
      <NewTrackingForm
        drivers={drivers}
        vehicles={vehicleOptions}
        places={places}
        tripInitial={initial}
        preselectDriverId={preselect}
        openTrip={sp.trip === "1" || Boolean(copy)}
        expireHours={profile.one_time_expire_hours}
      />
    </div>
  );
}
