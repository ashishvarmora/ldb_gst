"use client";

import { useState } from "react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input } from "@/components/form";
import { OWN_SITE_KINDS, PLACE_KIND_LABEL, customFieldsOf, type LivePlace, type PlaceKind } from "@/lib/live/shared";

import { savePlace } from "../actions";
import { LocationField } from "../MapPicker";
import { CustomFieldsEditor, Seg } from "../ui";

/**
 * Warehouse master (v4): name, type, address, exact location, geofence and
 * your own fields. Older places (customers) keep their type when edited.
 */
export function PlaceForm({ place, defaultKind, back }: { place: LivePlace | null; defaultKind: PlaceKind; back?: string | null }) {
  const start = place?.kind ?? (OWN_SITE_KINDS.includes(defaultKind) ? defaultKind : "warehouse");
  const [kind, setKind] = useState<PlaceKind>(start);
  const kinds: PlaceKind[] = OWN_SITE_KINDS.includes(start) ? OWN_SITE_KINDS : [...OWN_SITE_KINDS, start];

  return (
    <ActionForm action={savePlace} closeOnSuccess={false} resetOnSuccess={!place} className="space-y-3">
      {place ? <input type="hidden" name="id" value={place.id} /> : null}
      {!place && back ? <input type="hidden" name="return" value={back} /> : null}
      <Field label="Name" name="name" required>
        <Input name="name" required maxLength={120} defaultValue={place?.name} placeholder="e.g. Main godown, Morbi" />
      </Field>
      <div>
        <span className="field-label">Type</span>
        <Seg
          name="kind"
          label="Type"
          value={kind}
          onChange={setKind}
          options={kinds.map((k) => ({ v: k, label: PLACE_KIND_LABEL[k].split(" /")[0] }))}
        />
      </div>
      <LocationField
        name="location"
        addressName="address"
        defaultAddress={place?.address ?? ""}
        defaultLocation={place?.lat != null && place?.lng != null ? `${place.lat}, ${place.lng}` : ""}
        label="Exact location (Google Maps link or pick on map)"
        hint="Needed for automatic arrive / leave and ETA."
      />
      <Field label="Geofence radius (m)" name="radius_m" hint="Inside this distance counts as 'at the place'. 300-800 m suits most sites.">
        <Input name="radius_m" inputMode="numeric" defaultValue={String(place?.radius_m ?? 500)} />
      </Field>
      <div>
        <span className="field-label">Your fields</span>
        <CustomFieldsEditor initial={customFieldsOf(place?.custom_fields)} />
      </div>
      <SubmitButton className="w-full sm:w-auto">{place ? "Save" : back ? "Save and go back" : "Add warehouse"}</SubmitButton>
    </ActionForm>
  );
}
