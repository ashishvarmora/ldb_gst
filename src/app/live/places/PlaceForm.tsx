"use client";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { SITE_TYPES, customFieldsOf, siteTypeLabel, type LivePlace } from "@/lib/live/shared";
import { indianMobileDigits } from "@/lib/phone";

import { savePlace } from "../actions";
import { LocationField } from "../MapPicker";
import { CustomFieldsEditor, PresetOrOther } from "../ui";

/**
 * Warehouse master (v5): Warehouse name, Contact person, Contact phone,
 * Location (map pin / Maps link / address), Type (preset or Other...),
 * geofence and your own fields. Compact, for a sheet.
 */
export function PlaceForm({ place, back, after }: { place: LivePlace | null; back?: string | null; after: string }) {
  const typeValue = place ? siteTypeLabel(place) : "Warehouse";
  const loc = place?.lat != null && place?.lng != null ? `${place.lat}, ${place.lng}` : (place?.maps_url ?? "");
  return (
    <ActionForm action={savePlace} closeOnSuccess={false} refresh={false} className="live-form">
      {place ? <input type="hidden" name="id" value={place.id} /> : null}
      {!place && back ? <input type="hidden" name="return" value={back} /> : <input type="hidden" name="after" value={after} />}
      <div className="live-f">
        <label className="live-mini-label" htmlFor="p-name">
          Warehouse name
        </label>
        <input id="p-name" name="name" required maxLength={120} defaultValue={place?.name} placeholder="e.g. Main godown, Morbi" className="field live-field-sm w-full" />
      </div>
      <PresetOrOther
        name="site_type"
        customName="site_type_custom"
        presets={SITE_TYPES.map((t) => t.label)}
        value={typeValue}
        label="Type"
        placeholder="e.g. Cold store"
      />
      <div className="live-form-2">
        <div className="live-f">
          <label className="live-mini-label" htmlFor="p-cn">
            Contact person
          </label>
          <input id="p-cn" name="contact_name" maxLength={80} defaultValue={place?.contact_name ?? ""} className="field live-field-sm w-full" />
        </div>
        <div className="live-f">
          <label className="live-mini-label" htmlFor="p-cp">
            Contact phone
          </label>
          <input id="p-cp" name="contact_phone" inputMode="tel" defaultValue={indianMobileDigits(place?.contact_phone) ?? ""} className="field live-field-sm w-full" />
        </div>
      </div>
      <div className="live-f live-f-loc">
        <LocationField
          name="location"
          addressName="address"
          defaultAddress={place?.address ?? ""}
          defaultLocation={loc}
          label="Location"
          hint="Pin it on the map or paste a Google Maps link. A pin is needed for automatic arrive / leave and ETA."
        />
      </div>
      <details className="live-more">
        <summary>More: geofence, your fields</summary>
        <div className="live-form mt-2">
          <div className="live-f">
            <label className="live-mini-label" htmlFor="p-r">
              Geofence radius (m)
            </label>
            <input id="p-r" name="radius_m" inputMode="numeric" defaultValue={String(place?.radius_m ?? 500)} className="field live-field-sm w-28" />
            <p className="live-mini-hint">Inside this distance counts as &quot;at the place&quot;. 300-800 m suits most sites.</p>
          </div>
          <div className="live-f">
            <span className="live-mini-label">Your fields</span>
            <CustomFieldsEditor initial={customFieldsOf(place?.custom_fields)} />
          </div>
        </div>
      </details>
      <SubmitButton size="sm" className="w-full">
        {place ? "Save" : back ? "Save and go back" : "Add warehouse"}
      </SubmitButton>
    </ActionForm>
  );
}
