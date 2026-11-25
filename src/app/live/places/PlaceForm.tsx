"use client";

import { useState, useTransition } from "react";
import { Crosshair, Loader2, Search } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select } from "@/components/form";
import { indianMobileDigits } from "@/lib/phone";
import { PLACE_KINDS, PLACE_KIND_LABEL, type LivePlace, type PlaceKind } from "@/lib/live/shared";

import { geocodeAddress, savePlace } from "../actions";

/** Add / edit a place. Location three ways: this phone's GPS, a pasted Maps link, or an address search. */
export function PlaceForm({ place, defaultKind }: { place: LivePlace | null; defaultKind: PlaceKind }) {
  const [location, setLocation] = useState(place?.lat != null && place?.lng != null ? `${place.lat}, ${place.lng}` : "");
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [searching, startSearch] = useTransition();
  const [kind, setKind] = useState<PlaceKind>(place?.kind ?? defaultKind);

  function useHere() {
    if (!("geolocation" in navigator)) {
      setMsg({ tone: "bad", text: "This browser cannot read location." });
      return;
    }
    setBusy(true);
    setMsg(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocation(`${p.coords.latitude.toFixed(6)}, ${p.coords.longitude.toFixed(6)}`);
        setMsg({ tone: "good", text: `Location set (± ${Math.round(p.coords.accuracy)} m). Stand at the gate for best results.` });
        setBusy(false);
      },
      () => {
        setMsg({ tone: "bad", text: "Could not get location. Allow Location for this site and try again." });
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  }

  function search(form: HTMLFormElement | null) {
    if (!form) return;
    const fd = new FormData(form);
    const q = ["name", "address", "city", "state", "pincode"]
      .map((k) => String(fd.get(k) ?? "").trim())
      .filter(Boolean)
      .slice(1)
      .join(", ");
    startSearch(async () => {
      const res = await geocodeAddress(q || String(fd.get("name") ?? ""));
      if (!res.ok) {
        setMsg({ tone: "bad", text: res.error });
        return;
      }
      setLocation(`${res.lat.toFixed(6)}, ${res.lng.toFixed(6)}`);
      setMsg({ tone: "good", text: `Found: ${res.label.slice(0, 120)}. Approximate - use GPS at the gate for exact.` });
    });
  }

  return (
    <ActionForm action={savePlace} closeOnSuccess={false} resetOnSuccess={!place} className="space-y-3">
      {place ? <input type="hidden" name="id" value={place.id} /> : null}
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

      <div>
        <Field
          label="Location"
          name="location"
          hint="Needed for automatic arrive/leave and ETA. Paste a Google Maps link (full link) or 'lat, lng'."
        >
          <Input name="location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="23.0012, 70.8345" />
        </Field>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" onClick={useHere} disabled={busy} className="live-chip-filter">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />} Use my current location
          </button>
          <button
            type="button"
            onClick={(e) => search(e.currentTarget.closest("form"))}
            disabled={searching}
            className="live-chip-filter"
          >
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find from address
          </button>
        </div>
        {msg ? <p className={msg.tone === "good" ? "mt-1 text-xs text-good-500" : "mt-1 text-xs text-bad-500"}>{msg.text}</p> : null}
      </div>

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
      <SubmitButton className="w-full sm:w-auto">{place ? "Save place" : "Add place"}</SubmitButton>
    </ActionForm>
  );
}
