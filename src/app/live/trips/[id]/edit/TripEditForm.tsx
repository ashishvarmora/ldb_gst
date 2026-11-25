"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Select } from "@/components/form";
import { prettyVehicle, tripFieldEditable, type LivePlace, type TripStatus } from "@/lib/live/shared";

import { updateTrip } from "../../../actions";
import { TripFields, type TripPrefill } from "../../../TripFields";

export type EditDriver = { id: string; name: string; busyTrip: string | null };
export type EditVehicle = { id: string; number: string; holderId: string | null; holderName: string | null };

/** Trip edit. Locked fields follow the trip's phase (shared.ts tripFieldEditable). */
export function TripEditForm({
  tripId,
  status,
  driverId,
  vehicleId,
  drivers,
  vehicles,
  places,
  initial,
}: {
  tripId: string;
  status: TripStatus;
  driverId: string | null;
  vehicleId: string | null;
  drivers: EditDriver[];
  vehicles: EditVehicle[];
  places: LivePlace[];
  initial: TripPrefill;
}) {
  const [dId, setDId] = useState(driverId ?? "");
  const [vId, setVId] = useState(vehicleId ?? "none");
  const v = vehicles.find((x) => x.id === vId);
  const held = v && v.holderId && v.holderId !== dId ? v.holderName : null;
  const d = drivers.find((x) => x.id === dId);

  return (
    <ActionForm action={updateTrip} closeOnSuccess={false} className="space-y-3">
      <input type="hidden" name="id" value={tripId} />
      <section className="panel live-form-block">
        <h2>Driver and truck</h2>
        <div className="live-form-grid">
          <Field label="Driver" name="driver_id" hint="Changing it is recorded in the trip log.">
            <Select name="driver_id" value={dId} onChange={(e) => setDId(e.target.value)}>
              {driverId ? null : <option value="">Not set</option>}
              {drivers.map((x) => (
                <option key={x.id} value={x.id} disabled={Boolean(x.busyTrip) && x.id !== driverId}>
                  {x.name}
                  {x.busyTrip && x.id !== driverId ? ` · on ${x.busyTrip}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Truck" name="vehicle_id">
            <Select name="vehicle_id" value={vId} onChange={(e) => setVId(e.target.value)}>
              <option value="none">No truck</option>
              {vehicles.map((x) => (
                <option key={x.id} value={x.id}>
                  {prettyVehicle(x.number)}
                  {x.holderName && x.holderId !== dId ? ` · with ${x.holderName}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {held ? (
          <div className="live-warn mt-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <div>
              <p>
                {prettyVehicle(v!.number)} is with <strong>{held}</strong>.
              </p>
              <label className="mt-1 flex items-center gap-2">
                <input type="checkbox" name="force" className="size-4" /> Move this truck to {d?.name ?? "this driver"}
              </label>
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel live-form-block">
        <h2>Trip details</h2>
        <TripFields places={places} initial={initial} locked={(f) => !tripFieldEditable(status, f)} showPaste={tripFieldEditable(status, "material")} isNew={false} />
      </section>

      <div className="live-form-actions">
        <SubmitButton className="w-full sm:w-auto" pendingLabel="Saving…">
          Save changes
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
