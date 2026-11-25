"use client";

import { useState } from "react";
import { AlertTriangle, Route, Truck, UserRound } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select } from "@/components/form";
import { cx } from "@/components/ui";
import { indianMobileDigits } from "@/lib/phone";
import { VEHICLE_OWNER_LABEL, prettyVehicle, type LivePlace, type VehicleOwnerType } from "@/lib/live/shared";

import { createTracking } from "../actions";
import { TripFields, type TripPrefill } from "../TripFields";

/**
 * One screen, three steps that open only when needed:
 *   1. Driver   - required (pick or add: name, mobile, own / one-time)
 *   2. Truck    - toggle, off by default (informational; 1 driver = 1 truck)
 *   3. Trip     - toggle, off by default (purpose + from/to required inside)
 * Saving makes (or reuses) the driver's link; the next page sends it on WhatsApp.
 */

export type DriverOption = {
  id: string;
  name: string;
  phone: string | null;
  kind: "own" | "one_time";
  company: string | null;
  truck: string | null;
  busyTrip: string | null;
};

export type VehicleOption = { id: string; number: string; owner_type: VehicleOwnerType | null; holderId: string | null; holderName: string | null };

function Toggle({ name, on, setOn, icon, title, hint }: { name: string; on: boolean; setOn: (v: boolean) => void; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <label className={cx("live-toggle", on && "is-on")}>
      <span className="live-toggle-icon">{icon}</span>
      <span className="min-w-0 flex-1">
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
      <input type="checkbox" name={name} checked={on} onChange={(e) => setOn(e.target.checked)} className="live-switch" role="switch" aria-checked={on} />
    </label>
  );
}

export function NewTrackingForm({
  drivers,
  vehicles,
  places,
  tripInitial,
  preselectDriverId,
  openTrip,
  expireHours,
}: {
  drivers: DriverOption[];
  vehicles: VehicleOption[];
  places: LivePlace[];
  tripInitial: TripPrefill;
  preselectDriverId: string | null;
  openTrip: boolean;
  expireHours: number;
}) {
  const [driverMode, setDriverMode] = useState<"existing" | "new">(preselectDriverId || drivers.length ? "existing" : "new");
  const [driverId, setDriverId] = useState(preselectDriverId ?? "");
  const [kind, setKind] = useState<"own" | "one_time">("own");
  const [truckOn, setTruckOn] = useState(false);
  const [truckMode, setTruckMode] = useState<"existing" | "new">(vehicles.length ? "existing" : "new");
  const [vehicleId, setVehicleId] = useState("");
  const [tripOn, setTripOn] = useState(openTrip);

  const driver = driverMode === "existing" ? drivers.find((d) => d.id === driverId) ?? null : null;
  const vehicle = truckMode === "existing" ? vehicles.find((v) => v.id === vehicleId) ?? null : null;
  const heldByOther = vehicle && vehicle.holderId && vehicle.holderId !== driverId ? vehicle.holderName : null;
  const busy = tripOn && driver?.busyTrip ? driver.busyTrip : null;

  return (
    <ActionForm action={createTracking} closeOnSuccess={false} className="space-y-3">
      {/* 1. DRIVER */}
      <section className="panel live-form-block">
        <h2 className="flex items-center gap-2">
          <UserRound size={17} /> Driver <span className="text-bad-500">*</span>
        </h2>
        <input type="hidden" name="driver_mode" value={driverMode} />
        {drivers.length ? (
          <div className="live-seg" role="group" aria-label="Driver">
            <button type="button" aria-pressed={driverMode === "existing"} onClick={() => setDriverMode("existing")}>
              Saved driver
            </button>
            <button type="button" aria-pressed={driverMode === "new"} onClick={() => setDriverMode("new")}>
              New driver
            </button>
          </div>
        ) : null}

        {driverMode === "existing" ? (
          <>
            <Select name="driver_id" value={driverId} onChange={(e) => setDriverId(e.target.value)} required aria-label="Driver">
              <option value="">Choose driver</option>
              {drivers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                  {d.phone ? ` · ${indianMobileDigits(d.phone)}` : ""}
                  {d.kind === "one_time" ? ` · one-time${d.company ? ` (${d.company})` : ""}` : ""}
                  {d.busyTrip ? ` · on ${d.busyTrip}` : ""}
                </option>
              ))}
            </Select>
            {driver?.truck ? <p className="field-hint">Has truck {prettyVehicle(driver.truck)}.</p> : null}
          </>
        ) : (
          <div className="live-form-grid">
            <Field label="Name" name="d_name" required>
              <Input name="d_name" required autoComplete="off" placeholder="Ramesh" />
            </Field>
            <Field label="Mobile" name="d_phone" required hint="The link goes to this number on WhatsApp.">
              <div className="live-phone">
                <span>+91</span>
                <Input name="d_phone" required inputMode="tel" autoComplete="off" placeholder="98765 43210" />
              </div>
            </Field>
            <div className="sm:col-span-2">
              <span className="field-label">Driver type</span>
              <div className="live-chips" role="radiogroup" aria-label="Driver type">
                <label className="live-chip-radio">
                  <input type="radio" name="d_kind" value="own" checked={kind === "own"} onChange={() => setKind("own")} />
                  <span>Own driver</span>
                </label>
                <label className="live-chip-radio">
                  <input type="radio" name="d_kind" value="one_time" checked={kind === "one_time"} onChange={() => setKind("one_time")} />
                  <span>One-time (dealer / supplier)</span>
                </label>
              </div>
              <p className="field-hint">
                {kind === "own"
                  ? "Tracked until the driver stops sharing."
                  : `Tracked for this trip only - sharing ends by itself ${expireHours} h after the trip is done.`}
              </p>
            </div>
            {kind === "one_time" ? (
              <Field label="Dealer / supplier name" name="d_company" className="sm:col-span-2">
                <Input name="d_company" autoComplete="off" placeholder="e.g. Shree Ceramics (optional)" />
              </Field>
            ) : null}
          </div>
        )}
      </section>

      {/* 2. TRUCK */}
      <section className="panel live-form-block">
        <Toggle name="truck_on" on={truckOn} setOn={setTruckOn} icon={<Truck size={17} />} title="Truck details" hint="Optional - which truck this driver drives" />
        {truckOn ? (
          <div className="mt-3 space-y-3">
            <input type="hidden" name="truck_mode" value={truckMode} />
            {vehicles.length ? (
              <div className="live-seg" role="group" aria-label="Truck">
                <button type="button" aria-pressed={truckMode === "existing"} onClick={() => setTruckMode("existing")}>
                  Saved truck
                </button>
                <button type="button" aria-pressed={truckMode === "new"} onClick={() => setTruckMode("new")}>
                  New truck
                </button>
              </div>
            ) : null}
            {truckMode === "existing" ? (
              <Select name="vehicle_id" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label="Truck">
                <option value="">Choose truck</option>
                {vehicles.map((v) => (
                  <option key={v.id} value={v.id}>
                    {prettyVehicle(v.number)}
                    {v.owner_type ? ` · ${VEHICLE_OWNER_LABEL[v.owner_type]}` : ""}
                    {v.holderName ? ` · with ${v.holderName}` : ""}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="live-form-grid">
                <Field label="Truck number" name="t_number" required>
                  <Input name="t_number" required autoCapitalize="characters" autoComplete="off" placeholder="GJ36X1234" className="font-mono uppercase" />
                </Field>
                <Field label="Type" name="t_vehicle_type">
                  <Input name="t_vehicle_type" list="live-vtypes" placeholder="e.g. 10-wheeler" />
                </Field>
                <datalist id="live-vtypes">
                  {["Pickup", "Tempo / LCV", "6-wheeler", "10-wheeler", "12-wheeler", "Trailer", "Container"].map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <Field label="Truck owner" name="t_owner_type">
                  <Select name="t_owner_type" defaultValue={kind === "one_time" ? "dealer" : "own"}>
                    <option value="">Not set</option>
                    {(Object.keys(VEHICLE_OWNER_LABEL) as VehicleOwnerType[]).map((o) => (
                      <option key={o} value={o}>
                        {VEHICLE_OWNER_LABEL[o]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Owner / transporter name" name="t_transporter">
                  <Input name="t_transporter" placeholder="optional" />
                </Field>
              </div>
            )}
            {heldByOther ? (
              <div className="live-warn">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <div>
                  <p>
                    {prettyVehicle(vehicle!.number)} is with <strong>{heldByOther}</strong>. A truck has one driver at a time.
                  </p>
                  <label className="mt-1 flex items-center gap-2">
                    <input type="checkbox" name="force" className="size-4" /> Move this truck to {driver?.name ?? "this driver"}
                  </label>
                </div>
              </div>
            ) : null}
            {driver?.truck && vehicle && driver.truck !== vehicle.number ? (
              <p className="field-hint">{driver.name} drives {prettyVehicle(driver.truck)} now; it will be replaced.</p>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 3. TRIP */}
      <section className="panel live-form-block">
        <Toggle name="trip_on" on={tripOn} setOn={setTripOn} icon={<Route size={17} />} title="Trip details" hint="Optional - why, what, when, where" />
        {busy ? (
          <p className="live-warn mt-3">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>
              {driver?.name} is already on {busy}. One trip per driver at a time - close it first, or turn trip details off to just track.
            </span>
          </p>
        ) : null}
        {tripOn ? (
          <div className="mt-3 space-y-3">
            <Field label="Trip name" name="trip_name" hint="Optional. With the trip number it never changes.">
              <Input name="trip_name" maxLength={80} placeholder="e.g. Rajkot order #448" />
            </Field>
            <TripFields places={places} initial={tripInitial} />
            <label className="flex items-start gap-3 text-sm text-ink">
              <input type="checkbox" name="start_now" className="mt-0.5 size-4" />
              <span>
                <strong className="block text-strong">Already on the way</strong>
                Start the trip now. Otherwise it starts when the truck leaves the From place or the driver taps Start.
              </span>
            </label>
          </div>
        ) : null}
      </section>

      <div className="live-form-actions">
        <SubmitButton className="w-full sm:w-auto" pendingLabel="Saving…">
          {tripOn ? "Create trip and get link" : "Start tracking"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
