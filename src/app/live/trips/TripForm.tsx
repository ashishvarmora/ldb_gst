"use client";

import { useMemo, useState, useTransition } from "react";
import { ClipboardPaste, Loader2, Sparkles } from "lucide-react";

import { ActionForm, SubmitButton, type FormAction } from "@/components/ActionForm";
import { Field, Input, Select, Textarea } from "@/components/form";
import { indianMobileDigits } from "@/lib/phone";
import {
  PLACE_KIND_LABEL,
  prettyVehicle,
  toLocalInput,
  type LiveDriver,
  type LivePlace,
  type LiveTrip,
  type LiveVehicle,
} from "@/lib/live/shared";

import { parseDispatchText } from "../actions";

/**
 * New / edit trip. Fast by design: vehicle + destination are the only musts;
 * documents are the second block; everything else sits under "More details".
 * The paste box fills the form from e-way bill / invoice / LR text (AI when a
 * key is set, rules otherwise) - the owner checks and saves.
 */

type Prefill = {
  vehicle_no: string;
  from_place_id: string;
  to_place_id: string;
  to_name: string;
  to_city: string;
  to_location: string;
  consignee_name: string;
  consignee_phone: string;
  driver_name: string;
  driver_phone: string;
  transporter: string;
  vehicle_ownership: string;
  material: string;
  quantity: string;
  quantity_unit: string;
  weight_kg: string;
  invoice_no: string;
  invoice_value_inr: string;
  eway_bill_no: string;
  eway_valid_until: string;
  lr_no: string;
  freight_inr: string;
  planned_dispatch_at: string;
  promised_delivery_at: string;
  notes: string;
};

const s = (v: unknown) => (v == null ? "" : String(v));

function fromTrip(trip: LiveTrip | null, places: LivePlace[], vehicles: LiveVehicle[]): Prefill {
  const origin = places.find((p) => p.kind === "factory") ?? places.find((p) => p.kind === "warehouse" || p.kind === "branch");
  const veh = trip?.vehicle_id ? vehicles.find((v) => v.id === trip.vehicle_id) : null;
  return {
    vehicle_no: s(trip?.vehicle_no),
    from_place_id: trip ? s(trip.from_place_id) : s(origin?.id),
    to_place_id: s(trip?.to_place_id),
    to_name: trip?.to_place_id ? "" : s(trip?.to_name),
    to_city: s(trip?.to_city),
    to_location: trip?.to_lat != null && trip?.to_lng != null ? `${trip.to_lat}, ${trip.to_lng}` : "",
    consignee_name: s(trip?.consignee_name),
    consignee_phone: indianMobileDigits(trip?.consignee_phone) ?? "",
    driver_name: s(trip?.driver_name),
    driver_phone: indianMobileDigits(trip?.driver_phone) ?? "",
    transporter: s(trip?.transporter),
    vehicle_ownership: veh?.ownership ?? "market",
    material: s(trip?.material),
    quantity: s(trip?.quantity),
    quantity_unit: s(trip?.quantity_unit) || "boxes",
    weight_kg: s(trip?.weight_kg),
    invoice_no: s(trip?.invoice_no),
    invoice_value_inr: s(trip?.invoice_value_inr),
    eway_bill_no: s(trip?.eway_bill_no),
    eway_valid_until: toLocalInput(trip?.eway_valid_until),
    lr_no: s(trip?.lr_no),
    freight_inr: s(trip?.freight_inr),
    planned_dispatch_at: toLocalInput(trip?.planned_dispatch_at),
    promised_delivery_at: toLocalInput(trip?.promised_delivery_at),
    notes: s(trip?.notes),
  };
}

function matchPlace(name: string | undefined, places: LivePlace[]): LivePlace | null {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  return places.find((p) => p.name.toLowerCase() === n) ?? places.find((p) => n.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(n)) ?? null;
}

export function TripForm({
  action,
  trip,
  places,
  vehicles,
  drivers,
}: {
  action: FormAction;
  trip: LiveTrip | null;
  places: LivePlace[];
  vehicles: LiveVehicle[];
  drivers: LiveDriver[];
}) {
  const [values, setValues] = useState<Prefill>(() => fromTrip(trip, places, vehicles));
  const [version, setVersion] = useState(0);
  const [toMode, setToMode] = useState<"place" | "other">(trip && !trip.to_place_id ? "other" : places.some((p) => p.kind === "customer") ? "place" : "other");
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [parsing, startParse] = useTransition();

  const origins = useMemo(() => places.filter((p) => p.kind !== "customer"), [places]);
  const customers = useMemo(() => places.filter((p) => p.kind === "customer" || p.kind === "other"), [places]);

  const set = (patch: Partial<Prefill>) => setValues((v) => ({ ...v, ...patch }));

  function runParse() {
    setPasteMsg(null);
    startParse(async () => {
      const res = await parseDispatchText(paste);
      if (!res.ok) {
        setPasteMsg({ tone: "bad", text: res.error });
        return;
      }
      const d = res.data;
      const patch: Partial<Prefill> = {};
      let filled = 0;
      const put = (k: keyof Prefill, v: string | number | undefined | null) => {
        if (v == null || v === "") return;
        patch[k] = String(v);
        filled++;
      };
      put("vehicle_no", d.vehicleNo);
      put("eway_bill_no", d.ewayBillNo);
      if (d.ewayValidUntil) put("eway_valid_until", toLocalInput(d.ewayValidUntil));
      put("invoice_no", d.invoiceNo);
      put("invoice_value_inr", d.invoiceValueInr);
      put("lr_no", d.lrNo);
      put("consignee_name", d.consigneeName);
      put("material", d.material);
      put("weight_kg", d.weightKg);
      put("transporter", d.transporter);
      if (d.quantity) {
        const m = /([\d,.]+)\s*(.*)/.exec(d.quantity);
        if (m) {
          put("quantity", m[1].replace(/,/g, ""));
          if (m[2]) put("quantity_unit", m[2].trim().slice(0, 20));
        }
      }
      const from = matchPlace(d.fromPlace, origins);
      if (from) put("from_place_id", from.id);
      const to = matchPlace(d.toPlace, customers) ?? matchPlace(d.consigneeName, customers);
      if (to) {
        put("to_place_id", to.id);
        setToMode("place");
      } else if (d.toPlace) {
        put("to_name", d.consigneeName || d.toPlace);
        put("to_city", d.toPlace);
        setToMode("other");
      }
      setValues((v) => ({ ...v, ...patch }));
      setVersion((x) => x + 1);
      setPasteMsg(
        filled
          ? { tone: "good", text: `Filled ${filled} field${filled === 1 ? "" : "s"}${res.source === "ai" ? " (AI)" : ""}. Please check before saving.` }
          : { tone: "bad", text: "Could not find any details in that text." },
      );
    });
  }

  function onDriverName(name: string) {
    const d = drivers.find((x) => x.name.toLowerCase() === name.trim().toLowerCase());
    set({ driver_name: name, ...(d?.phone && !values.driver_phone ? { driver_phone: indianMobileDigits(d.phone) ?? "" } : {}) });
  }

  function onVehicle(no: string) {
    const v = vehicles.find((x) => x.number === no.toUpperCase().replace(/[^A-Z0-9]/g, ""));
    set({
      vehicle_no: no,
      ...(v ? { vehicle_ownership: v.ownership, ...(v.transporter && !values.transporter ? { transporter: v.transporter } : {}) } : {}),
    });
  }

  const k = (name: string) => `${name}-${version}`;

  return (
    <div className="space-y-4">
      {!trip ? (
        <details className="live-paste" open>
          <summary>
            <ClipboardPaste size={17} /> Paste e-way bill / invoice text <small>fills the form</small>
          </summary>
          <Textarea
            name="paste"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={4}
            placeholder="Copy the text from the e-way bill PDF, invoice or the transporter's WhatsApp message and paste it here."
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={runParse} disabled={parsing || paste.trim().length < 8} className="live-cta live-cta-sm">
              {parsing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Fill the form
            </button>
            {pasteMsg ? <span className={pasteMsg.tone === "good" ? "text-sm text-good-500" : "text-sm text-bad-500"}>{pasteMsg.text}</span> : null}
          </div>
        </details>
      ) : null}

      <ActionForm action={action} closeOnSuccess={false} className="space-y-4">
        {trip ? <input type="hidden" name="id" value={trip.id} /> : null}

        <section className="panel live-form-block">
          <h2>Truck and route</h2>
          <div className="live-form-grid">
            <Field label="Vehicle number" name="vehicle_no" required>
              <Input
                key={k("vehicle_no")}
                name="vehicle_no"
                required
                list="live-vehicles"
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="GJ36X1234"
                defaultValue={values.vehicle_no}
                onChange={(e) => onVehicle(e.target.value)}
                className="font-mono uppercase"
              />
            </Field>
            <datalist id="live-vehicles">
              {vehicles.map((v) => (
                <option key={v.id} value={v.number}>
                  {prettyVehicle(v.number)}
                  {v.transporter ? ` - ${v.transporter}` : ""}
                </option>
              ))}
            </datalist>
            <Field label="From" name="from_place_id" hint={origins.length ? undefined : "Add your factory under Places to mark departure automatically."}>
              <Select key={k("from")} name="from_place_id" defaultValue={values.from_place_id}>
                <option value="">Not set</option>
                {origins.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({PLACE_KIND_LABEL[p.kind].split(" ")[0]})
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="mt-3">
            <span className="field-label">
              To<span className="ml-0.5 text-bad-500">*</span>
            </span>
            {customers.length ? (
              <div className="live-seg" role="group" aria-label="Destination type">
                <button type="button" aria-pressed={toMode === "place"} onClick={() => setToMode("place")}>
                  Saved customer
                </button>
                <button type="button" aria-pressed={toMode === "other"} onClick={() => setToMode("other")}>
                  Type it
                </button>
              </div>
            ) : null}
            {toMode === "place" && customers.length ? (
              <Select key={k("to")} name="to_place_id" defaultValue={values.to_place_id} required aria-label="Customer">
                <option value="">Choose customer / dealer</option>
                {customers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.city ? `, ${p.city}` : ""}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="live-form-grid">
                <Input key={k("to_name")} name="to_name" placeholder="Customer / dealer name" defaultValue={values.to_name} aria-label="Destination name" />
                <Input key={k("to_city")} name="to_city" placeholder="City" defaultValue={values.to_city} aria-label="Destination city" />
                <Input
                  key={k("to_location")}
                  name="to_location"
                  placeholder="Location: paste Google Maps link or lat, lng (for ETA)"
                  defaultValue={values.to_location}
                  aria-label="Destination location"
                  className="sm:col-span-2"
                />
                {!trip ? (
                  <label className="flex items-center gap-2 text-sm text-ink sm:col-span-2">
                    <input type="checkbox" name="save_to_place" defaultChecked className="size-4" /> Save as a customer for next time
                  </label>
                ) : null}
              </div>
            )}
          </div>

          <div className="live-form-grid mt-3">
            <Field label="Driver name" name="driver_name">
              <Input
                key={k("driver_name")}
                name="driver_name"
                list="live-drivers"
                autoComplete="off"
                defaultValue={values.driver_name}
                onChange={(e) => onDriverName(e.target.value)}
              />
            </Field>
            <datalist id="live-drivers">
              {drivers.map((d) => (
                <option key={d.id} value={d.name} />
              ))}
            </datalist>
            <Field label="Driver mobile" name="driver_phone" hint="The tracking link goes to this number on WhatsApp.">
              <Input
                key={`driver_phone-${version}-${values.driver_phone}`}
                name="driver_phone"
                inputMode="tel"
                autoComplete="off"
                placeholder="98765 43210"
                defaultValue={values.driver_phone}
              />
            </Field>
          </div>
        </section>

        <section className="panel live-form-block">
          <h2>Documents and promise</h2>
          <div className="live-form-grid">
            <Field label="Invoice no." name="invoice_no">
              <Input key={k("invoice_no")} name="invoice_no" defaultValue={values.invoice_no} />
            </Field>
            <Field label="E-way bill no." name="eway_bill_no">
              <Input key={k("eway_bill_no")} name="eway_bill_no" inputMode="numeric" placeholder="12 digits" defaultValue={values.eway_bill_no} className="font-mono" />
            </Field>
            <Field label="E-way bill valid until" name="eway_valid_until" hint="You get an alert 6 h before it ends.">
              <Input key={k("eway_valid_until")} type="datetime-local" name="eway_valid_until" defaultValue={values.eway_valid_until} />
            </Field>
            <Field label="Promised delivery" name="promised_delivery_at" hint="Used for the 'likely late' alert.">
              <Input key={k("promised_delivery_at")} type="datetime-local" name="promised_delivery_at" defaultValue={values.promised_delivery_at} />
            </Field>
            <Field label="LR / bilty no." name="lr_no">
              <Input key={k("lr_no")} name="lr_no" defaultValue={values.lr_no} />
            </Field>
          </div>
        </section>

        <details className="panel live-form-block live-more" open={Boolean(trip)}>
          <summary>More details (material, customer contact, freight…)</summary>
          <div className="live-form-grid mt-3">
            <Field label="Material" name="material">
              <Input key={k("material")} name="material" placeholder="Vitrified tiles 600x600" defaultValue={values.material} />
            </Field>
            <div className="grid grid-cols-[1fr_7rem] gap-2">
              <Field label="Quantity" name="quantity">
                <Input key={k("quantity")} name="quantity" inputMode="decimal" defaultValue={values.quantity} />
              </Field>
              <Field label="Unit" name="quantity_unit">
                <Input key={k("quantity_unit")} name="quantity_unit" list="live-units" defaultValue={values.quantity_unit} />
              </Field>
            </div>
            <datalist id="live-units">
              {["boxes", "pallets", "sq m", "sq ft", "pcs", "bags", "tonnes"].map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            <Field label="Weight (kg)" name="weight_kg">
              <Input key={k("weight_kg")} name="weight_kg" inputMode="decimal" defaultValue={values.weight_kg} />
            </Field>
            <Field label="Invoice value (₹)" name="invoice_value_inr">
              <Input key={k("invoice_value_inr")} name="invoice_value_inr" inputMode="decimal" defaultValue={values.invoice_value_inr} />
            </Field>
            <Field label="Customer contact name" name="consignee_name">
              <Input key={k("consignee_name")} name="consignee_name" defaultValue={values.consignee_name} />
            </Field>
            <Field label="Customer mobile" name="consignee_phone">
              <Input key={k("consignee_phone")} name="consignee_phone" inputMode="tel" defaultValue={values.consignee_phone} />
            </Field>
            <Field label="Transporter" name="transporter">
              <Input key={`transporter-${version}-${values.transporter}`} name="transporter" defaultValue={values.transporter} />
            </Field>
            <Field label="Truck is" name="vehicle_ownership">
              <Select key={`own-${version}-${values.vehicle_ownership}`} name="vehicle_ownership" defaultValue={values.vehicle_ownership}>
                <option value="market">Market / hired</option>
                <option value="own">Our own</option>
              </Select>
            </Field>
            <Field label="Freight (₹)" name="freight_inr">
              <Input key={k("freight_inr")} name="freight_inr" inputMode="decimal" defaultValue={values.freight_inr} />
            </Field>
            <Field label="Planned dispatch" name="planned_dispatch_at">
              <Input key={k("planned_dispatch_at")} type="datetime-local" name="planned_dispatch_at" defaultValue={values.planned_dispatch_at} />
            </Field>
            <Field label="Notes" name="notes" className="sm:col-span-2">
              <Textarea key={k("notes")} name="notes" rows={2} defaultValue={values.notes} />
            </Field>
          </div>
        </details>

        {!trip ? (
          <label className="panel flex items-start gap-3 p-4 text-sm text-ink">
            <input type="checkbox" name="start_now" className="mt-0.5 size-4" />
            <span>
              <strong className="block text-strong">Truck has already left</strong>
              Start the trip now (otherwise it starts by itself when the truck leaves your factory, or when the driver taps Start).
            </span>
          </label>
        ) : null}

        <div className="live-form-actions">
          <SubmitButton className="w-full sm:w-auto" pendingLabel="Saving…">
            {trip ? "Save changes" : "Create trip"}
          </SubmitButton>
        </div>
      </ActionForm>
    </div>
  );
}
