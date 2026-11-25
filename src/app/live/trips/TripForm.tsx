"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { ArrowDownLeft, ArrowUpRight, ClipboardPaste, Flag, Loader2, Lock, MapPin, Package, Plus, Sparkles, Truck, UserRound } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select, Textarea } from "@/components/form";
import {
  FALLBACK_KMPH,
  IN_PARTY_TYPES,
  OUT_PARTY_TYPES,
  PARTY_TYPE_LABEL,
  PURPOSES,
  PURPOSE_LABEL,
  TRIP_FIELDS_DYNAMIC,
  fmtIst,
  fromLocalInput,
  parseLatLng,
  prettyVehicle,
  roadKm,
  toLocalInput,
} from "@/lib/live/shared";

import { createTrip, parseDispatchText, updateTrip } from "../actions";
import { LocationField } from "../MapPicker";
import type { TripPrefill } from "../trip-prefill";
import { Seg } from "../ui";

/**
 * v4 trip form - one for New trip and Edit (docs/LIVE-PLAN-v4.md §4).
 * Sections are an accordion (one open at a time); each summary shows the
 * current choice so a closed section still reads.
 *
 *   mode "create"  direction + name, then everything.
 *   mode "planned" everything except direction / name.
 *   mode "active"  driver, truck, destination (reason required), arrival,
 *                  e-way bill, contact, notes. From and goods are locked.
 */

export type FormDriver = { id: string; name: string; phone: string | null; busy: string | null };
export type FormVehicle = { id: string; number: string; busy: string | null };
export type FormPlace = { id: string; name: string; lat: number | null; lng: number | null };

type Mode = "create" | "planned" | "active";

function AddNew({ href }: { href: string }) {
  return (
    <Link href={href} className="live-addnew" aria-label="Add new to masters">
      <Plus size={13} /> New
    </Link>
  );
}

function Lockd({ text }: { text: string }) {
  return (
    <div className="live-locked">
      <span>{text || "-"}</span>
      <Lock size={12} aria-label="Locked while Active" />
    </div>
  );
}

export function TripForm({
  mode,
  tripId,
  tripLabel,
  initial,
  drivers,
  vehicles,
  warehouses,
  otherPlaces,
  returnTo,
}: {
  mode: Mode;
  tripId?: string;
  tripLabel?: string;
  initial: TripPrefill;
  drivers: FormDriver[];
  vehicles: FormVehicle[];
  warehouses: FormPlace[];
  otherPlaces: FormPlace[];
  returnTo: string;
}) {
  const active = mode === "active";
  const locked = (f: string) => active && !(TRIP_FIELDS_DYNAMIC as readonly string[]).includes(f);
  const back = encodeURIComponent(returnTo);
  const [v, setV] = useState<TripPrefill>(initial);
  const [version, setVersion] = useState(0);
  const set = (k: keyof TripPrefill, val: string) => setV((x) => ({ ...x, [k]: val }));
  const incoming = v.direction === "incoming";
  const [toPoint, setToPoint] = useState(() => parseLatLng(initial.to_location));
  const [fromPoint, setFromPoint] = useState(() => parseLatLng(initial.from_location));
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [parsing, startParse] = useTransition();

  const allPlaces = [...warehouses, ...otherPlaces];
  const placeName = (id: string) => allPlaces.find((p) => p.id === id)?.name ?? "";
  const placePt = (id: string) => {
    const p = allPlaces.find((x) => x.id === id);
    return p?.lat != null && p?.lng != null ? { lat: p.lat, lng: p.lng } : null;
  };
  const a = v.from_mode === "custom" ? fromPoint : placePt(v.from_place_id);
  const b = v.to_mode === "custom" ? toPoint : placePt(v.to_place_id);
  const est = useMemo(() => {
    if (!a || !b) return null;
    const km = roadKm(a, b);
    return { km: Math.round(km), hours: km / FALLBACK_KMPH };
  }, [a?.lat, a?.lng, b?.lat, b?.lng]); // eslint-disable-line react-hooks/exhaustive-deps
  const startIso = fromLocalInput(v.planned_dispatch_at);
  // v6: Planned arrival = planned start + journey hours (read-only; the driver knows his halts).
  const jh = Number((v.journey_hours || "").replace(",", "."));
  const arrivalIso = startIso && Number.isFinite(jh) && jh > 0 ? new Date(new Date(startIso).getTime() + jh * 3_600_000).toISOString() : null;
  const suggested = est ? String(Math.max(0.5, Math.round(est.hours * 2) / 2)) : null;

  // Active: did a reason-needing field change?
  const driverKey = (x: TripPrefill) => (x.driver_mode === "custom" ? `c:${x.tmp_driver_name}|${x.tmp_driver_phone}` : `m:${x.driver_id}`);
  const truckKey = (x: TripPrefill) => (x.truck_mode === "custom" ? `c:${x.tmp_truck_no.toUpperCase()}` : x.truck_mode === "none" ? "n" : `m:${x.vehicle_id}`);
  const toKey = (x: TripPrefill) => (x.to_mode === "custom" ? `c:${x.to_name}` : `p:${x.to_place_id}`);
  const needReason = active && (driverKey(v) !== driverKey(initial) || truckKey(v) !== truckKey(initial) || toKey(v) !== toKey(initial));

  const driverSummary =
    v.driver_mode === "custom" ? (v.tmp_driver_name ? `${v.tmp_driver_name} (temporary)` : "Not set") : drivers.find((d) => d.id === v.driver_id)?.name ?? "Not set";
  const truckSummary =
    v.truck_mode === "none"
      ? "None"
      : v.truck_mode === "custom"
        ? v.tmp_truck_no
          ? `${prettyVehicle(v.tmp_truck_no.toUpperCase())} (temporary)`
          : "Not set"
        : prettyVehicle(vehicles.find((x) => x.id === v.vehicle_id)?.number) || "Not set";
  const endSummary = (side: "from" | "to") =>
    v[`${side}_mode`] === "custom" ? v[`${side}_name`] || "Not set" : placeName(v[`${side}_place_id`]) || "Not set";

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
      if (x.vehicleNo && !active) {
        patch.truck_mode = "custom";
        put("tmp_truck_no", x.vehicleNo);
      }
      if (!incoming && (x.toPlace || x.consigneeName) && !locked("to")) {
        put("consignee_name", x.consigneeName);
        patch.to_mode = "custom";
        put("to_name", x.consigneeName || x.toPlace);
        put("to_city", x.toPlace);
      }
      if (incoming && x.fromPlace && !active) {
        patch.from_mode = "custom";
        put("from_name", x.fromPlace);
      }
      setV((cur) => ({ ...cur, ...patch }));
      setVersion((n) => n + 1);
      setPasteMsg(
        filled
          ? { tone: "good", text: `Filled ${filled} field${filled === 1 ? "" : "s"}${res.source === "ai" ? " (AI)" : ""}. Please check.` }
          : { tone: "bad", text: "Could not find any details in that text." },
      );
    });
  }

  const endSection = (side: "from" | "to") => {
    const isFrom = side === "from";
    const ours = isFrom ? !incoming : incoming;
    if (isFrom && active) return <Lockd text={endSummary("from")} />;
    const mode = v[`${side}_mode`] as "place" | "custom";
    return (
      <div className="space-y-2">
        <Seg
          name={`${side}_mode`}
          label={isFrom ? "From" : "To"}
          value={mode}
          onChange={(m) => set(`${side}_mode`, m)}
          options={[
            { v: "place", label: "Warehouse" },
            { v: "custom", label: "Custom location" },
          ]}
        />
        {mode === "place" ? (
          <div className="live-pick-row">
            <Select
              name={`${side}_place_id`}
              value={v[`${side}_place_id`]}
              onChange={(e) => set(`${side}_place_id`, e.target.value)}
              aria-label={isFrom ? "From warehouse" : "To warehouse"}
              className="min-w-0 flex-1"
            >
              <option value="">Choose warehouse</option>
              {warehouses.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
              {otherPlaces.length ? (
                <optgroup label="Other saved places">
                  {otherPlaces.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              ) : null}
            </Select>
            <AddNew href={`/live/places?add=warehouse&return=${back}`} />
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              name={`${side}_name`}
              value={v[`${side}_name`]}
              onChange={(e) => set(`${side}_name`, e.target.value)}
              maxLength={120}
              placeholder={ours ? "Place name, e.g. Rented godown" : incoming ? "Supplier place, e.g. Morbi factory" : "Dealer / customer place"}
              aria-label={`${isFrom ? "From" : "To"} name`}
            />
            <LocationField
              key={`${side}-${version}`}
              name={`${side}_location`}
              addressName={`${side}_address`}
              defaultLocation={v[`${side}_location`]}
              defaultAddress={v[`${side}_address`]}
              label="Google Maps link or pick on map"
              onPoint={isFrom ? setFromPoint : setToPoint}
            />
            <p className="field-hint">Kept on this trip only, not saved in masters.</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <ActionForm action={mode === "create" ? createTrip : updateTrip} closeOnSuccess={false} className="space-y-3">
      {tripId ? <input type="hidden" name="id" value={tripId} /> : null}

      {mode === "create" ? (
        <section className="panel live-form-block space-y-3">
          <Seg
            name="direction"
            label="Direction"
            value={v.direction as "outgoing" | "incoming"}
            onChange={(d) =>
              setV((x) => ({
                ...x,
                direction: d,
                from_mode: d === "incoming" ? "custom" : "place",
                to_mode: d === "incoming" ? "place" : "custom",
                from_place_id: d === "incoming" ? "" : x.to_place_id || x.from_place_id,
                to_place_id: d === "incoming" ? x.from_place_id || x.to_place_id : "",
                purpose: d === "incoming" ? "pickup" : "dispatch",
                party_type: d === "incoming" ? "supplier" : "customer",
              }))
            }
            options={[
              { v: "outgoing", label: "We are sending", icon: <ArrowUpRight size={14} /> },
              { v: "incoming", label: "We are receiving", icon: <ArrowDownLeft size={14} /> },
            ]}
          />
          <Field label="Trip name" name="trip_name" hint="T-number is automatic. Name and number never change.">
            <Input name="trip_name" maxLength={80} autoComplete="off" placeholder={incoming ? "e.g. Clay from Morbi supplier" : "e.g. Rajkot order 448"} />
          </Field>
        </section>
      ) : (
        <input type="hidden" name="direction" value={v.direction} />
      )}

      <div className="live-acc live-acc-form">
        {/* DRIVER */}
        <details name="trip-form" open={mode === "create" || undefined}>
          <summary>
            <UserRound size={15} /> <strong>Driver</strong> <small>{driverSummary}</small>
          </summary>
          <div className="live-acc-body space-y-2">
            <Seg
              name="driver_mode"
              label="Driver from"
              value={v.driver_mode as "master" | "custom"}
              onChange={(m) => set("driver_mode", m)}
              options={[
                { v: "master", label: "Masters" },
                { v: "custom", label: "Custom" },
              ]}
            />
            {v.driver_mode === "custom" ? (
              <>
                <div className="live-form-grid">
                  <Input name="tmp_driver_name" value={v.tmp_driver_name} onChange={(e) => set("tmp_driver_name", e.target.value)} maxLength={80} autoComplete="off" placeholder="Driver name" aria-label="Driver name" />
                  <div className="live-phone">
                    <span>+91</span>
                    <Input name="tmp_driver_phone" value={v.tmp_driver_phone} onChange={(e) => set("tmp_driver_phone", e.target.value)} inputMode="tel" autoComplete="off" placeholder="98765 43210" aria-label="Driver mobile" />
                  </div>
                </div>
                <p className="field-hint">Temporary: gets his own link for this trip only. Not saved in masters; removed 1 h after the trip ends.</p>
              </>
            ) : (
              <div className="live-pick-row">
                <Select name="driver_id" value={v.driver_id} onChange={(e) => set("driver_id", e.target.value)} aria-label="Driver" className="min-w-0 flex-1">
                  <option value="">Choose driver</option>
                  {drivers.map((d) => (
                    <option key={d.id} value={d.id} disabled={active && Boolean(d.busy)}>
                      {d.name}
                      {d.busy ? ` · on ${d.busy}` : ""}
                    </option>
                  ))}
                </Select>
                <AddNew href={`/live/masters/drivers?add=1&return=${back}`} />
              </div>
            )}
          </div>
        </details>

        {/* TRUCK */}
        <details name="trip-form">
          <summary>
            <Truck size={15} /> <strong>Truck</strong> <small>{truckSummary}</small>
          </summary>
          <div className="live-acc-body space-y-2">
            <Seg
              name="truck_mode"
              label="Truck from"
              value={v.truck_mode as "master" | "custom" | "none"}
              onChange={(m) => set("truck_mode", m)}
              options={[
                { v: "master", label: "Masters" },
                { v: "custom", label: "Custom" },
                { v: "none", label: "None" },
              ]}
            />
            {v.truck_mode === "custom" ? (
              <Input name="tmp_truck_no" value={v.tmp_truck_no} onChange={(e) => set("tmp_truck_no", e.target.value)} autoCapitalize="characters" autoComplete="off" placeholder="GJ36X1234" className="font-mono uppercase" aria-label="Truck number" />
            ) : v.truck_mode === "master" ? (
              <div className="live-pick-row">
                <Select name="vehicle_id" value={v.vehicle_id} onChange={(e) => set("vehicle_id", e.target.value)} aria-label="Truck" className="min-w-0 flex-1">
                  <option value="">Choose truck</option>
                  {vehicles.map((x) => (
                    <option key={x.id} value={x.id} disabled={active && Boolean(x.busy)}>
                      {prettyVehicle(x.number)}
                      {x.busy ? ` · on ${x.busy}` : ""}
                    </option>
                  ))}
                </Select>
                <AddNew href={`/live/masters/trucks?add=1&return=${back}`} />
              </div>
            ) : null}
          </div>
        </details>

        {/* FROM */}
        <details name="trip-form">
          <summary>
            <MapPin size={15} /> <strong>From</strong> <small>{endSummary("from")}</small>
          </summary>
          <div className="live-acc-body">{endSection("from")}</div>
        </details>

        {/* TO */}
        <details name="trip-form">
          <summary>
            <Flag size={15} /> <strong>To</strong> <small>{endSummary("to")}</small>
          </summary>
          <div className="live-acc-body">{endSection("to")}</div>
        </details>

        {/* MORE */}
        <details name="trip-form">
          <summary>
            <Package size={15} /> <strong>More</strong> <small>goods, documents, times</small>
          </summary>
          <div className="live-acc-body space-y-3">
            {!active ? (
              <details className="live-paste">
                <summary>
                  <ClipboardPaste size={15} /> Paste e-way bill / invoice text <small>fills the fields</small>
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

            <div className="live-form-grid">
              <Field label="Purpose" name="purpose">
                {locked("purpose") ? (
                  <Lockd text={PURPOSE_LABEL[v.purpose as keyof typeof PURPOSE_LABEL] ?? "-"} />
                ) : (
                  <Select name="purpose" value={v.purpose} onChange={(e) => set("purpose", e.target.value)}>
                    {PURPOSES.map((p) => (
                      <option key={p} value={p}>
                        {PURPOSE_LABEL[p]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={incoming ? "Sender is" : "Going to"} name="party_type">
                {locked("party_type") ? (
                  <Lockd text={PARTY_TYPE_LABEL[v.party_type as keyof typeof PARTY_TYPE_LABEL] ?? "-"} />
                ) : (
                  <Select name="party_type" value={v.party_type} onChange={(e) => set("party_type", e.target.value)}>
                    {(incoming ? IN_PARTY_TYPES : OUT_PARTY_TYPES).map((p) => (
                      <option key={p} value={p}>
                        {PARTY_TYPE_LABEL[p]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              {incoming ? (
                <Field label="Supplier / dealer name" name="party_name">
                  {locked("party_name") ? <Lockd text={v.party_name} /> : <Input name="party_name" value={v.party_name} onChange={(e) => set("party_name", e.target.value)} maxLength={120} />}
                </Field>
              ) : null}
              <Field label="Planned start" name="planned_dispatch_at">
                {locked("planned_dispatch_at") ? (
                  <Lockd text={v.planned_dispatch_at.replace("T", " ")} />
                ) : (
                  <Input type="datetime-local" name="planned_dispatch_at" value={v.planned_dispatch_at} onChange={(e) => set("planned_dispatch_at", e.target.value)} />
                )}
              </Field>
              <Field label="Journey hours" name="journey_hours" hint="Start to arrival, incl. halts.">
                <Input
                  name="journey_hours"
                  inputMode="decimal"
                  placeholder="e.g. 14"
                  value={v.journey_hours}
                  onChange={(e) => set("journey_hours", e.target.value.replace(/[^0-9.,]/g, "").slice(0, 6))}
                />
              </Field>
              <p className="live-arrival-ro">
                Planned arrival: <strong>{arrivalIso ? fmtIst(arrivalIso) : "-"}</strong>
              </p>
            </div>
            {est ? (
              <p className="live-eta-hint">
                <Sparkles size={13} className="shrink-0" />
                <span>
                  About {est.km} km by road, ~{est.hours < 1 ? `${Math.max(1, Math.round(est.hours * 60))} min` : `${est.hours.toFixed(1)} h`}.
                  {suggested ? (
                    <>
                      {" "}
                      <button type="button" className="font-semibold text-brand-600" onClick={() => set("journey_hours", suggested)}>
                        Use {suggested} h
                      </button>
                    </>
                  ) : null}
                </span>
              </p>
            ) : null}

            <div className="live-form-grid">
              {(
                [
                  ["material", "Material", "text"],
                  ["quantity", "Quantity", "decimal"],
                  ["quantity_unit", "Unit", "text"],
                  ["weight_kg", "Weight (kg)", "decimal"],
                  ["invoice_no", "Invoice no.", "text"],
                  ["invoice_value_inr", "Invoice value (₹)", "decimal"],
                  ["eway_bill_no", "E-way bill no.", "numeric"],
                  ["lr_no", "LR / bilty no.", "text"],
                  ["transporter", "Transporter", "text"],
                  ["freight_inr", "Freight (₹)", "decimal"],
                  ["consignee_name", incoming ? "Supplier contact" : "Customer contact", "text"],
                  ["consignee_phone", "Contact mobile", "tel"],
                ] as const
              ).map(([k, label, im]) => (
                <Field key={k} label={label} name={k}>
                  {locked(k) ? (
                    <Lockd text={v[k]} />
                  ) : (
                    <Input name={k} value={v[k]} onChange={(e) => set(k, e.target.value)} inputMode={im === "text" ? undefined : im} className={k === "eway_bill_no" ? "font-mono" : undefined} />
                  )}
                </Field>
              ))}
              <Field label="E-way bill valid until" name="eway_valid_until" hint="Alert 6 h before it ends.">
                <Input type="datetime-local" name="eway_valid_until" value={v.eway_valid_until} onChange={(e) => set("eway_valid_until", e.target.value)} />
              </Field>
              {v.to_mode === "custom" && !incoming ? (
                <Field label="Destination city" name="to_city">
                  <Input name="to_city" value={v.to_city} onChange={(e) => set("to_city", e.target.value)} maxLength={80} />
                </Field>
              ) : null}
              <Field label="Notes" name="notes" className="sm:col-span-2">
                <Textarea name="notes" rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
              </Field>
            </div>
          </div>
        </details>
      </div>

      {active ? (
        <section className={needReason ? "panel live-form-block live-reason is-needed" : "panel live-form-block live-reason"}>
          <Field label="Reason for change" name="reason" hint="Needed when the driver, truck or destination changes on an Active trip. Saved in the trip activity.">
            <Input name="reason" maxLength={300} placeholder="e.g. Driver unwell, truck breakdown at Palanpur" />
          </Field>
        </section>
      ) : null}

      <div className="live-form-actions">
        <SubmitButton className="w-full sm:w-auto" pendingLabel="Saving…">
          {mode === "create" ? "Create trip (Planned)" : `Save ${tripLabel ?? "trip"}`}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
