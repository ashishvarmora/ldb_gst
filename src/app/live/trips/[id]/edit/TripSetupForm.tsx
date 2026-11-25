"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, ClipboardPaste, Loader2, Lock, Plus, Route, Sparkles, Truck, UserRound } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select, Textarea } from "@/components/form";
import { cx } from "@/components/ui";
import {
  FALLBACK_KMPH,
  IN_PARTY_TYPES,
  OUT_PARTY_TYPES,
  PARTY_TYPE_LABEL,
  PURPOSES,
  PURPOSE_LABEL,
  fromLocalInput,
  prettyVehicle,
  roadKm,
  toLocalInput,
  tripFieldEditable,
  type TripDirection,
  type TripStatus,
} from "@/lib/live/shared";

import { parseDispatchText, updateTrip } from "../../../actions";
import { LocationField } from "../../../MapPicker";
import type { TripPrefill } from "../../../trip-prefill";

/**
 * Trip setup and edit, one screen, three sections:
 *
 *   Driver        REQUIRED to start tracking (the trip can exist without one).
 *                 Sending: pick from the Drivers master ("Add new" goes there
 *                 and comes back). Receiving: name + mobile typed here, for
 *                 this trip only.
 *   Truck         optional (toggle). Sending: Trucks master. Receiving: number.
 *   Trip details  optional (toggle). Inside, REQUIRED: purpose, From, To.
 *                 Sending: From = our warehouse, To = name + exact location.
 *                 Receiving: From = supplier name + place, To = our warehouse.
 *                 Optional: times (with a rules ETA), and under "More details"
 *                 goods, documents, contact, notes.
 *
 * Locked fields follow the trip's phase (shared.ts tripFieldEditable): shown
 * read-only and posted unchanged.
 */

export type SetupDriver = { id: string; name: string; phone: string | null; busyTrip: string | null; truckId: string | null };
export type SetupVehicle = { id: string; number: string; holderId: string | null; holderName: string | null };
export type SetupPlace = { id: string; name: string; city: string | null; lat: number | null; lng: number | null };

function Toggle({ on, setOn, icon, title, hint }: { on: boolean; setOn: (v: boolean) => void; icon: React.ReactNode; title: string; hint: string }) {
  return (
    <label className={cx("live-toggle", on && "is-on")}>
      <span className="live-toggle-icon">{icon}</span>
      <span className="min-w-0 flex-1">
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
      <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} className="live-switch" role="switch" aria-checked={on} aria-label={title} />
    </label>
  );
}

function AddNew({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="live-addnew">
      <Plus size={13} /> {label}
    </Link>
  );
}

export function TripSetupForm({
  tripId,
  direction,
  status,
  setup,
  driverId,
  vehicleId,
  inline,
  drivers,
  vehicles,
  warehouses,
  customers,
  initial,
  detailsOn: detailsDefault,
  returnTo,
}: {
  tripId: string;
  direction: TripDirection;
  status: TripStatus;
  setup: boolean;
  driverId: string | null;
  vehicleId: string | null;
  inline: { driverName: string; driverPhone: string; truckNo: string };
  drivers: SetupDriver[];
  vehicles: SetupVehicle[];
  warehouses: SetupPlace[];
  customers: SetupPlace[];
  initial: TripPrefill;
  detailsOn: boolean;
  returnTo: string;
}) {
  const incoming = direction === "incoming";
  const locked = (f: string) => !tripFieldEditable(status, f);
  const back = encodeURIComponent(returnTo);

  const [dId, setDId] = useState(driverId ?? "");
  const [truckOn, setTruckOn] = useState(Boolean(vehicleId || inline.truckNo));
  const [vId, setVId] = useState(vehicleId ?? "");
  const [detailsOn, setDetailsOn] = useState(detailsDefault);

  const [values, setValues] = useState<TripPrefill>(initial);
  const [version, setVersion] = useState(0);
  const k = (n: string) => `${n}-${version}`;
  const [toMode, setToMode] = useState<"new" | "saved">(initial.to_place_id && !incoming ? "saved" : "new");
  const [fromPoint, setFromPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [toPoint, setToPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [parsing, startParse] = useTransition();

  const d = drivers.find((x) => x.id === dId) ?? null;
  const v = vehicles.find((x) => x.id === vId) ?? null;
  const held = truckOn && v && v.holderId && v.holderId !== dId ? v.holderName : null;
  const set = (key: keyof TripPrefill, val: string) => setValues((x) => ({ ...x, [key]: val }));

  // Rules ETA: straight line x 1.25 road factor at 40 km/h (the live ETA takes over once moving).
  const placePoint = (id: string, list: SetupPlace[]) => {
    const p = list.find((x) => x.id === id);
    return p?.lat != null && p?.lng != null ? { lat: p.lat, lng: p.lng } : null;
  };
  const a = incoming ? fromPoint : placePoint(values.from_place_id, warehouses);
  const b = incoming
    ? placePoint(values.to_place_id, warehouses)
    : toMode === "saved"
      ? placePoint(values.to_place_id, [...customers, ...warehouses])
      : toPoint;
  const est = useMemo(() => {
    if (!a || !b) return null;
    const km = roadKm(a, b);
    return { km: Math.round(km), hours: km / FALLBACK_KMPH };
  }, [a?.lat, a?.lng, b?.lat, b?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const startIso = fromLocalInput(values.planned_dispatch_at);
  const suggested = est && startIso ? toLocalInput(new Date(new Date(startIso).getTime() + est.hours * 3_600_000).toISOString()) : null;

  function runParse() {
    setPasteMsg(null);
    startParse(async () => {
      const res = await parseDispatchText(paste);
      if (!res.ok) return setPasteMsg({ tone: "bad", text: res.error });
      const x = res.data;
      const patch: Partial<TripPrefill> = {};
      let filled = 0;
      const put = (key: keyof TripPrefill, val: string | number | undefined | null) => {
        if (val == null || val === "" || locked(key)) return;
        patch[key] = String(val);
        filled++;
      };
      put("eway_bill_no", x.ewayBillNo);
      if (x.ewayValidUntil) put("eway_valid_until", toLocalInput(x.ewayValidUntil));
      put("invoice_no", x.invoiceNo);
      put("invoice_value_inr", x.invoiceValueInr);
      put("lr_no", x.lrNo);
      put("material", x.material);
      put("weight_kg", x.weightKg);
      put("transporter", x.transporter);
      if (x.quantity) {
        const m = /([\d,.]+)\s*(.*)/.exec(x.quantity);
        if (m) {
          put("quantity", m[1].replace(/,/g, ""));
          if (m[2]) put("quantity_unit", m[2].trim().slice(0, 20));
        }
      }
      if (incoming) {
        put("from_name", x.fromPlace);
      } else {
        put("consignee_name", x.consigneeName);
        if (x.toPlace || x.consigneeName) {
          put("to_name", x.consigneeName || x.toPlace);
          put("to_city", x.toPlace);
          setToMode("new");
        }
      }
      setValues((cur) => ({ ...cur, ...patch }));
      setVersion((n) => n + 1);
      setPasteMsg(
        filled
          ? { tone: "good", text: `Filled ${filled} field${filled === 1 ? "" : "s"}${res.source === "ai" ? " (AI)" : ""}. Please check.` }
          : { tone: "bad", text: "Could not find any details in that text." },
      );
    });
  }

  /** Locked field: read-only look, value still posted unchanged. */
  function L(field: keyof TripPrefill, node: React.ReactNode, shown?: string, rule?: string) {
    if (!locked(rule ?? field)) return node;
    return (
      <div className="live-locked">
        <input type="hidden" name={field} value={values[field]} />
        <span>{shown ?? (values[field] || "-")}</span>
        <Lock size={12} aria-label="Locked after start" />
      </div>
    );
  }

  const fromLocked = locked("from");
  const purposeLocked = locked("purpose");

  return (
    <ActionForm action={updateTrip} closeOnSuccess={false} className="space-y-3">
      <input type="hidden" name="id" value={tripId} />

      {/* 1. DRIVER */}
      <section className="panel live-form-block">
        <h2 className="live-sec-title">
          <UserRound size={15} /> Driver <span className="live-req">needed to track</span>
        </h2>
        {incoming ? (
          <>
            <div className="live-form-grid">
              <Field label="Driver name" name="in_driver_name">
                <Input name="in_driver_name" defaultValue={inline.driverName} maxLength={80} autoComplete="off" placeholder="Supplier's driver" />
              </Field>
              <Field label="Driver mobile" name="in_driver_phone">
                <div className="live-phone">
                  <span>+91</span>
                  <Input name="in_driver_phone" defaultValue={inline.driverPhone} inputMode="tel" autoComplete="off" placeholder="98765 43210" />
                </div>
              </Field>
            </div>
            <p className="field-hint">For this trip only - not saved in your masters. His link stops by itself after the trip.</p>
          </>
        ) : (
          <>
            <div className="live-pick-row">
              <Select name="driver_id" value={dId} onChange={(e) => setDId(e.target.value)} aria-label="Driver" className="min-w-0 flex-1">
                <option value="">Choose driver</option>
                {drivers.map((x) => (
                  <option key={x.id} value={x.id} disabled={Boolean(x.busyTrip) && x.id !== driverId}>
                    {x.name}
                    {x.busyTrip && x.id !== driverId ? ` · on ${x.busyTrip}` : ""}
                  </option>
                ))}
              </Select>
              <AddNew href={`/live/masters/drivers?add=1&return=${back}`} label="Add new" />
            </div>
            {drivers.length === 0 ? <p className="field-hint">No drivers yet. Add your first driver in Masters.</p> : null}
          </>
        )}
      </section>

      {/* 2. TRUCK */}
      <section className="panel live-form-block">
        <Toggle on={truckOn} setOn={setTruckOn} icon={<Truck size={16} />} title="Truck" hint="Optional" />
        {incoming ? (
          truckOn ? (
            <div className="mt-2">
              <Input name="in_truck_no" defaultValue={inline.truckNo} autoCapitalize="characters" autoComplete="off" placeholder="GJ36X1234" className="font-mono uppercase" aria-label="Truck number" />
            </div>
          ) : (
            <input type="hidden" name="in_truck_no" value="" />
          )
        ) : truckOn ? (
          <div className="mt-2 space-y-2">
            <div className="live-pick-row">
              <Select name="vehicle_id" value={vId} onChange={(e) => setVId(e.target.value)} aria-label="Truck" className="min-w-0 flex-1">
                <option value="">Choose truck</option>
                {vehicles.map((x) => (
                  <option key={x.id} value={x.id}>
                    {prettyVehicle(x.number)}
                    {x.holderName && x.holderId !== dId ? ` · with ${x.holderName}` : ""}
                  </option>
                ))}
              </Select>
              <AddNew href={`/live/masters/trucks?add=1&return=${back}`} label="Add new" />
            </div>
            {held ? (
              <div className="live-warn">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <div>
                  <p>
                    {prettyVehicle(v!.number)} is with <strong>{held}</strong>.
                  </p>
                  <label className="mt-1 flex items-center gap-2">
                    <input type="checkbox" name="force" className="size-4" /> Move it to {d?.name ?? "this driver"}
                  </label>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <input type="hidden" name="vehicle_id" value="none" />
        )}
      </section>

      {/* 3. TRIP DETAILS */}
      <section className="panel live-form-block">
        <Toggle on={detailsOn} setOn={setDetailsOn} icon={<Route size={16} />} title="Trip details" hint="Route, times, goods - for ETA and alerts" />
        {detailsOn ? (
          <div className="mt-3 space-y-3">
            <input type="hidden" name="details_on" value="on" />

            {!locked("material") ? (
              <details className="live-paste">
                <summary>
                  <ClipboardPaste size={15} /> Paste e-way bill / invoice text <small>AI fills the fields</small>
                </summary>
                <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder="Paste the e-way bill, invoice or transporter's message." />
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button type="button" onClick={runParse} disabled={parsing || paste.trim().length < 8} className="live-btn-sm live-btn-brand">
                    {parsing ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Fill
                  </button>
                  {pasteMsg ? <span className={pasteMsg.tone === "good" ? "text-xs text-good-500" : "text-xs text-bad-500"}>{pasteMsg.text}</span> : null}
                </div>
              </details>
            ) : null}

            {/* FROM */}
            <div>
              <span className="field-label">
                From <span className="text-bad-500">*</span>
              </span>
              {incoming ? (
                fromLocked ? (
                  <div className="live-locked">
                    {(["party_name", "party_type", "from_name", "from_address", "from_location"] as const).map((f) => (
                      <input key={f} type="hidden" name={f} value={values[f]} />
                    ))}
                    <span>{[values.party_name, values.from_name !== values.party_name ? values.from_name : ""].filter(Boolean).join(" · ") || "-"}</span>
                    <Lock size={12} />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Input key={k("party_name")} name="party_name" defaultValue={values.party_name} maxLength={120} placeholder="Supplier / dealer name" aria-label="Supplier name" required />
                    <div className="live-chips" role="radiogroup" aria-label="Sender type">
                      {IN_PARTY_TYPES.map((p) => (
                        <label key={p} className="live-chip-radio">
                          <input type="radio" name="party_type" value={p} defaultChecked={(values.party_type || "supplier") === p} />
                          <span>{PARTY_TYPE_LABEL[p]}</span>
                        </label>
                      ))}
                    </div>
                    <Input key={k("from_name")} name="from_name" defaultValue={values.from_name} maxLength={120} placeholder="Their place, e.g. Morbi factory (optional)" aria-label="Supplier place" />
                    <LocationField
                      key={k("from_loc")}
                      name="from_location"
                      addressName="from_address"
                      defaultLocation={values.from_location}
                      defaultAddress={values.from_address}
                      label="Their exact location (for ETA)"
                      onPoint={setFromPoint}
                    />
                    <p className="field-hint">Trip-only info, not saved in masters. If the supplier uses Rahdari, he can create the trip himself and just send you his tracking link (rahdari.in/track/…).</p>
                  </div>
                )
              ) : fromLocked ? (
                L("from_place_id", null, warehouses.find((p) => p.id === values.from_place_id)?.name ?? values.from_name, "from")
              ) : (
                <div className="live-pick-row">
                  <Select key={k("from")} name="from_place_id" defaultValue={values.from_place_id} onChange={(e) => set("from_place_id", e.target.value)} aria-label="From warehouse" className="min-w-0 flex-1" required>
                    <option value="">Choose warehouse</option>
                    {warehouses.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <AddNew href={`/live/places?add=warehouse&return=${back}`} label="Add new" />
                </div>
              )}
            </div>

            {/* TO */}
            <div>
              <span className="field-label">
                To <span className="text-bad-500">*</span>
              </span>
              {incoming ? (
                <div className="live-pick-row">
                  <Select key={k("to")} name="to_place_id" defaultValue={values.to_place_id} onChange={(e) => set("to_place_id", e.target.value)} aria-label="Our warehouse" className="min-w-0 flex-1" required>
                    <option value="">Choose your warehouse</option>
                    {warehouses.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <AddNew href={`/live/places?add=warehouse&return=${back}`} label="Add new" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="live-chips" role="radiogroup" aria-label="Going to">
                    {OUT_PARTY_TYPES.map((p) =>
                      locked("party_type") ? null : (
                        <label key={p} className="live-chip-radio">
                          <input type="radio" name="party_type" value={p} defaultChecked={(values.party_type || "customer") === p} />
                          <span>{PARTY_TYPE_LABEL[p]}</span>
                        </label>
                      ),
                    )}
                    {locked("party_type") ? <input type="hidden" name="party_type" value={values.party_type} /> : null}
                  </div>
                  {customers.length || warehouses.length ? (
                    <div className="live-seg" role="group" aria-label="Destination">
                      <button type="button" aria-pressed={toMode === "new"} onClick={() => setToMode("new")}>
                        New place
                      </button>
                      <button type="button" aria-pressed={toMode === "saved"} onClick={() => setToMode("saved")}>
                        Saved place
                      </button>
                    </div>
                  ) : null}
                  {toMode === "saved" ? (
                    <Select key={k("to_saved")} name="to_place_id" defaultValue={values.to_place_id} onChange={(e) => set("to_place_id", e.target.value)} aria-label="Saved place" required>
                      <option value="">Choose place</option>
                      {customers.length ? (
                        <optgroup label="Customers & dealers">
                          {customers.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                              {p.city ? `, ${p.city}` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                      {warehouses.length ? (
                        <optgroup label="Our warehouses">
                          {warehouses.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </Select>
                  ) : (
                    <>
                      <Input key={k("to_name")} name="to_name" defaultValue={values.to_name} maxLength={120} placeholder="Dealer / customer name" aria-label="To name" required />
                      <LocationField
                        key={k("to_loc")}
                        name="to_location"
                        addressName="to_address"
                        defaultLocation={values.to_location}
                        defaultAddress={values.to_address}
                        label="Exact location (for arrival and ETA)"
                        onPoint={setToPoint}
                      />
                      {setup ? (
                        <label className="flex items-center gap-2 text-xs text-ink">
                          <input type="checkbox" name="save_to_place" defaultChecked className="size-4" /> Save this customer for next time
                        </label>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>

            {/* PURPOSE */}
            <div>
              <span className="field-label">
                Purpose <span className="text-bad-500">*</span>
              </span>
              {purposeLocked ? (
                L("purpose", null, PURPOSE_LABEL[values.purpose as keyof typeof PURPOSE_LABEL])
              ) : (
                <div className="live-chips" role="radiogroup" aria-label="Purpose">
                  {PURPOSES.map((p) => (
                    <label key={`${p}-${version}`} className="live-chip-radio">
                      <input type="radio" name="purpose" value={p} defaultChecked={values.purpose === p} />
                      <span>{PURPOSE_LABEL[p].split(" (")[0]}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* WHEN */}
            <div className="live-form-grid">
              <Field label="Planned start" name="planned_dispatch_at">
                {L(
                  "planned_dispatch_at",
                  <Input type="datetime-local" name="planned_dispatch_at" value={values.planned_dispatch_at} onChange={(e) => set("planned_dispatch_at", e.target.value)} />,
                )}
              </Field>
              <Field label="Expected arrival" name="promised_delivery_at" hint="For the 'likely late' alert.">
                <Input type="datetime-local" name="promised_delivery_at" value={values.promised_delivery_at} onChange={(e) => set("promised_delivery_at", e.target.value)} />
              </Field>
            </div>
            {est ? (
              <p className="live-eta-hint">
                <Sparkles size={13} className="shrink-0" />
                <span>
                  About {est.km} km by road, ~{est.hours < 1 ? `${Math.max(1, Math.round(est.hours * 60))} min` : `${est.hours.toFixed(1)} h`} drive.
                  {suggested ? (
                    <>
                      {" "}
                      <button type="button" className="font-semibold text-brand-600" onClick={() => set("promised_delivery_at", suggested)}>
                        Use as arrival
                      </button>
                    </>
                  ) : " Set the planned start to get an arrival time."}
                  {" "}The live ETA takes over once the truck moves.
                </span>
              </p>
            ) : null}

            {/* MORE */}
            <details className="live-more" open={!setup && Boolean(values.material || values.invoice_no || values.eway_bill_no)}>
              <summary>More details (goods, documents, contact)</summary>
              <div className="live-form-grid mt-3">
                {!incoming && toMode === "new" ? (
                  <Field label="City" name="to_city">
                    <Input key={k("to_city")} name="to_city" defaultValue={values.to_city} maxLength={80} />
                  </Field>
                ) : null}
                <Field label="Material" name="material">
                  {L("material", <Input key={k("material")} name="material" placeholder="Vitrified tiles 600x600" defaultValue={values.material} />)}
                </Field>
                <div className="grid grid-cols-[1fr_6rem] gap-2">
                  <Field label="Quantity" name="quantity">
                    {L("quantity", <Input key={k("quantity")} name="quantity" inputMode="decimal" defaultValue={values.quantity} />)}
                  </Field>
                  <Field label="Unit" name="quantity_unit">
                    {L("quantity_unit", <Input key={k("unit")} name="quantity_unit" list="live-units" defaultValue={values.quantity_unit} />)}
                  </Field>
                </div>
                <datalist id="live-units">
                  {["boxes", "pallets", "sq m", "sq ft", "pcs", "bags", "tonnes"].map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
                <Field label="Weight (kg)" name="weight_kg">
                  {L("weight_kg", <Input key={k("w")} name="weight_kg" inputMode="decimal" defaultValue={values.weight_kg} />)}
                </Field>
                <Field label="Invoice no." name="invoice_no">
                  {L("invoice_no", <Input key={k("inv")} name="invoice_no" defaultValue={values.invoice_no} />)}
                </Field>
                <Field label="Invoice value (₹)" name="invoice_value_inr">
                  {L("invoice_value_inr", <Input key={k("iv")} name="invoice_value_inr" inputMode="decimal" defaultValue={values.invoice_value_inr} />)}
                </Field>
                <Field label="E-way bill no." name="eway_bill_no">
                  <Input key={k("ewb")} name="eway_bill_no" inputMode="numeric" placeholder="12 digits" defaultValue={values.eway_bill_no} className="font-mono" />
                </Field>
                <Field label="E-way bill valid until" name="eway_valid_until" hint="Alert 6 h before it ends.">
                  <Input key={k("ewv")} type="datetime-local" name="eway_valid_until" defaultValue={values.eway_valid_until} />
                </Field>
                <Field label="LR / bilty no." name="lr_no">
                  {L("lr_no", <Input key={k("lr")} name="lr_no" defaultValue={values.lr_no} />)}
                </Field>
                <Field label="Transporter" name="transporter">
                  {L("transporter", <Input key={k("tr")} name="transporter" defaultValue={values.transporter} />)}
                </Field>
                <Field label="Freight (₹)" name="freight_inr">
                  {L("freight_inr", <Input key={k("fr")} name="freight_inr" inputMode="decimal" defaultValue={values.freight_inr} />)}
                </Field>
                <Field label={incoming ? "Supplier contact" : "Customer contact"} name="consignee_name">
                  <Input key={k("cn")} name="consignee_name" defaultValue={values.consignee_name} />
                </Field>
                <Field label="Contact mobile" name="consignee_phone">
                  <Input key={k("cp")} name="consignee_phone" inputMode="tel" defaultValue={values.consignee_phone} />
                </Field>
                <Field label="Notes" name="notes" className="sm:col-span-2">
                  <Textarea key={k("notes")} name="notes" rows={2} defaultValue={values.notes} />
                </Field>
              </div>
            </details>
          </div>
        ) : null}
      </section>

      <div className="live-form-actions">
        <SubmitButton className="w-full sm:w-auto" pendingLabel="Saving…">
          {setup ? "Save trip" : "Save changes"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
