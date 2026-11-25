"use client";

import { useState } from "react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select } from "@/components/form";
import { indianMobileDigits } from "@/lib/phone";
import { PLACE_KINDS, PLACE_KIND_LABEL, type LivePlace, type PlaceKind } from "@/lib/live/shared";

import { savePlace } from "../actions";
import { LocationField } from "../MapPicker";

/** Add / edit a place. Location: address search, map pick, this phone's GPS, or a pasted Maps link. */
export function PlaceForm({ place, defaultKind, back }: { place: LivePlace | null; defaultKind: PlaceKind; back?: string | null }) {
  const [kind, setKind] = useState<PlaceKind>(place?.kind ?? defaultKind);

  return (
    <ActionForm action={savePlace} closeOnSuccess={false} resetOnSuccess={!place} className="space-y-3">
      {place ? <input type="hidden" name="id" value={place.id} /> : null}
      {!place && back ? <input type="hidden" name="return" value={back} /> : null}
      <div className="live-form-grid">
        <Field label="Name" name="name" required>
          <Input name="name" required maxLength={120} defaultValue={place?.name} placeholder={kind === "factory" ? "Our factory, Morbi" : "Dealer name"} />
        </Field>
        <Field label="Type" name="kind">
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value as PlaceKind)}>
            {PLACE_KINDS.map((k) => (
              <option key={k} value={k}>
                {PLACE_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Address" name="address" className="sm:col-span-2">
          <Input name="address" maxLength={300} defaultValue={place?.address ?? ""} />
        </Field>
        <Field label="City" name="city">
          <Input name="city" maxLength={80} defaultValue={place?.city ?? ""} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="State" name="state">
            <Input name="state" maxLength={60} defaultValue={place?.state ?? ""} />
          </Field>
          <Field label="Pincode" name="pincode">
            <Input name="pincode" inputMode="numeric" maxLength={6} defaultValue={place?.pincode ?? ""} />
          </Field>
        </div>
      </div>

      <LocationField
        name="location"
        defaultLocation={place?.lat != null && place?.lng != null ? `${place.lat}, ${place.lng}` : ""}
        searchExtra={() =>
          ["address", "city", "state", "pincode"]
            .map((n) => (document.querySelector(`#place-form [name="${n}"]`) as HTMLInputElement | null)?.value?.trim() ?? "")
            .filter(Boolean)
            .join(", ")
        }
        label="Exact location"
        hint="Needed for automatic arrive / leave and ETA. Pick on the map, use your location at the gate, or paste a Google Maps link."
      />

      <div className="live-form-grid">
        <Field label="Geofence radius (m)" name="radius_m" hint="Inside this distance counts as 'at the place'. 300-800 m suits most factories.">
          <Input name="radius_m" inputMode="numeric" defaultValue={String(place?.radius_m ?? (kind === "factory" ? 400 : 500))} />
        </Field>
        <Field label="Contact person" name="contact_name">
          <Input name="contact_name" maxLength={80} defaultValue={place?.contact_name ?? ""} />
        </Field>
        <Field label="Contact mobile" name="contact_phone">
          <Input name="contact_phone" inputMode="tel" defaultValue={indianMobileDigits(place?.contact_phone) ?? ""} />
        </Field>
        <Field label="GSTIN" name="gstin">
          <Input name="gstin" maxLength={15} defaultValue={place?.gstin ?? ""} className="uppercase" />
        </Field>
      </div>
      <SubmitButton className="w-full sm:w-auto">{place ? "Save place" : back ? "Save and go back" : "Add place"}</SubmitButton>
    </ActionForm>
  );
}
