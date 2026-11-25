"use client";

import { useMemo, useState, useTransition } from "react";
import { ClipboardPaste, Loader2, Lock, Sparkles } from "lucide-react";

import { Field, Input, Select, Textarea } from "@/components/form";
import { indianMobileDigits } from "@/lib/phone";
import {
  OWN_SITE_KINDS,
  PURPOSES,
  PURPOSE_LABEL,
  toLocalInput,
  type LivePlace,
  type LiveTrip,
} from "@/lib/live/shared";

import { parseDispatchText } from "./actions";

/**
 * Trip details (why / what / when / where), shared by the one-screen create
 * flow (/live/new) and the trip edit page.
 *
 * REQUIRED when trip details are on: purpose + at least one of From / To.
 * Everything else is optional. On edit, `locked(field)` marks what this trip's
 * phase no longer allows (shared.ts tripFieldEditable); a locked field is
 * shown read-only and posted unchanged.
 */

export type { TripPrefill } from "./trip-prefill";
import type { TripPrefill } from "./trip-prefill";

function matchPlace(name: string | undefined, places: LivePlace[]): LivePlace | null {
  if (!name) return null;
  const n = name.toLowerCase().trim();
  return places.find((p) => p.name.toLowerCase() === n) ?? places.find((p) => n.includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(n)) ?? null;
}

export function TripFields({
  places,
  initial,
  locked = () => false,
  showPaste = true,
  isNew = true,
}: {
  places: LivePlace[];
  initial: TripPrefill;
  locked?: (field: string) => boolean;
  showPaste?: boolean;
  isNew?: boolean;
}) {
  const [values, setValues] = useState<TripPrefill>(initial);
  const [version, setVersion] = useState(0);
  const [fromMode, setFromMode] = useState<"place" | "other">(initial.from_name ? "other" : "place");
  const [toMode, setToMode] = useState<"place" | "other">(initial.to_place_id ? "place" : initial.to_name || initial.to_city ? "other" : "place");
  const [paste, setPaste] = useState("");
  const [pasteMsg, setPasteMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [parsing, startParse] = useTransition();

  const sites = useMemo(() => places.filter((p) => OWN_SITE_KINDS.includes(p.kind)), [places]);
  const k = (name: string) => `${name}-${version}`;

  function runParse() {
    setPasteMsg(null);
    startParse(async () => {
      const res = await parseDispatchText(paste);
      if (!res.ok) {
        setPasteMsg({ tone: "bad", text: res.error });
        return;
      }
      const d = res.data;
      const patch: Partial<TripPrefill> = {};
      let filled = 0;
      const put = (key: keyof TripPrefill, v: string | number | undefined | null) => {
        if (v == null || v === "" || locked(key)) return;
        patch[key] = String(v);
        filled++;
      };
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
      const from = matchPlace(d.fromPlace, sites);
      if (from) put("from_place_id", from.id);
      const to = matchPlace(d.toPlace, places) ?? matchPlace(d.consigneeName, places);
      if (to) {
        put("to_place_id", to.id);
        setToMode("place");
      } else if (d.toPlace) {
        put("to_name", d.consigneeName || d.toPlace);
        put("to_city", d.toPlace);
        setToMode("other");
      }
      if (!values.purpose) put("purpose", "dispatch");
      setValues((v) => ({ ...v, ...patch }));
      setVersion((x) => x + 1);
      setPasteMsg(
        filled
          ? { tone: "good", text: `Filled ${filled} field${filled === 1 ? "" : "s"}${res.source === "ai" ? " (AI)" : ""}. Please check.` }
          : { tone: "bad", text: "Could not find any details in that text." },
      );
    });
  }

  /** Locked field: read-only look, value still posted (unchanged) for the server's comparison. */
  function L(field: keyof TripPrefill, node: React.ReactNode) {
    if (!locked(field)) return node;
    return (
      <div className="live-locked">
        <input type="hidden" name={field} value={values[field]} />
        <span>{(field === "purpose" ? PURPOSE_LABEL[values.purpose as keyof typeof PURPOSE_LABEL] : values[field]) || "-"}</span>
        <Lock size={13} aria-label="Locked after start" />
      </div>
    );
  }

  const fromLocked = locked("from");
  const toLocked = locked("to");

  return (
    <div className="space-y-3">
      {showPaste ? (
        <details className="live-paste">
          <summary>
            <ClipboardPaste size={17} /> Paste e-way bill / invoice text <small>fills the fields</small>
          </summary>
          <Textarea
            name="paste_text"
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={3}
            placeholder="Copy the text from the e-way bill, invoice or transporter's WhatsApp message and paste it here."
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" onClick={runParse} disabled={parsing || paste.trim().length < 8} className="live-cta live-cta-sm">
              {parsing ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Fill
            </button>
            {pasteMsg ? <span className={pasteMsg.tone === "good" ? "text-sm text-good-500" : "text-sm text-bad-500"}>{pasteMsg.text}</span> : null}
          </div>
        </details>
      ) : null}

      <Field label="Purpose" name="purpose" required={!locked("purpose")}>
        {locked("purpose") ? (
          L("purpose", null)
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
      </Field>

      {/* WHERE: from -> to. At least one is required. */}
      <div className="live-form-grid">
        <div>
          <span className="field-label">From</span>
          {fromLocked ? (
            <div className="live-locked">
              <input type="hidden" name="from_place_id" value={values.from_place_id} />
              <input type="hidden" name="from_name" value={values.from_name} />
              <span>{places.find((p) => p.id === values.from_place_id)?.name || values.from_name || "-"}</span>
              <Lock size={13} aria-label="Locked after start" />
            </div>
          ) : (
            <>
              <div className="live-seg" role="group" aria-label="From type">
                <button type="button" aria-pressed={fromMode === "place"} onClick={() => setFromMode("place")}>
                  Saved place
                </button>
                <button type="button" aria-pressed={fromMode === "other"} onClick={() => setFromMode("other")}>
                  Type it
                </button>
              </div>
              {fromMode === "place" ? (
                <Select key={k("from")} name="from_place_id" defaultValue={values.from_place_id} aria-label="From place">
                  <option value="">Not set</option>
                  {sites.length ? (
                    <optgroup label="Your warehouses">
                      {sites.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null}
                  <optgroup label="Other places">
                    {places
                      .filter((p) => !OWN_SITE_KINDS.includes(p.kind))
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.city ? `, ${p.city}` : ""}
                        </option>
                      ))}
                  </optgroup>
                </Select>
              ) : (
                <Input key={k("from_name")} name="from_name" placeholder="e.g. Supplier yard, Morbi" defaultValue={values.from_name} aria-label="From" />
              )}
            </>
          )}
        </div>

        <div>
          <span className="field-label">To</span>
          {toLocked ? (
            <div className="live-locked">
              <input type="hidden" name="to_place_id" value={values.to_place_id} />
              <input type="hidden" name="to_name" value={values.to_name} />
              <input type="hidden" name="to_city" value={values.to_city} />
              <span>{values.to_name || values.to_city || "-"}</span>
              <Lock size={13} />
            </div>
          ) : (
            <>
              <div className="live-seg" role="group" aria-label="To type">
                <button type="button" aria-pressed={toMode === "place"} onClick={() => setToMode("place")}>
                  Saved place
                </button>
                <button type="button" aria-pressed={toMode === "other"} onClick={() => setToMode("other")}>
                  Type it
                </button>
              </div>
              {toMode === "place" ? (
                <Select key={k("to")} name="to_place_id" defaultValue={values.to_place_id} aria-label="To place">
                  <option value="">Not set</option>
                  {places.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.city ? `, ${p.city}` : ""}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="grid gap-2">
                  <Input key={k("to_name")} name="to_name" placeholder="Customer / site name" defaultValue={values.to_name} aria-label="To name" />
                  <Input key={k("to_city")} name="to_city" placeholder="City" defaultValue={values.to_city} aria-label="To city" />
                  <Input
                    key={k("to_location")}
                    name="to_location"
                    placeholder="Google Maps link or lat, lng (for ETA)"
                    defaultValue={values.to_location}
                    aria-label="To location"
                  />
                  {isNew ? (
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input type="checkbox" name="save_to_place" defaultChecked className="size-4" /> Save as a place for next time
                    </label>
                  ) : null}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* WHEN */}
      <div className="live-form-grid">
        <Field label="Planned start" name="planned_dispatch_at">
          {L("planned_dispatch_at", <Input key={k("pd")} type="datetime-local" name="planned_dispatch_at" defaultValue={values.planned_dispatch_at} />)}
        </Field>
        <Field label="Expected arrival" name="promised_delivery_at" hint="Used for the 'likely late' alert.">
          <Input key={k("pr")} type="datetime-local" name="promised_delivery_at" defaultValue={values.promised_delivery_at} />
        </Field>
      </div>

      {/* WHAT: goods, all optional */}
      <details className="live-more" open={!isNew && Boolean(values.material || values.invoice_no || values.eway_bill_no)}>
        <summary>Goods and documents (optional)</summary>
        <div className="live-form-grid mt-3">
          <Field label="Material" name="material">
            {L("material", <Input key={k("material")} name="material" placeholder="Vitrified tiles 600x600" defaultValue={values.material} />)}
          </Field>
          <div className="grid grid-cols-[1fr_6.5rem] gap-2">
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
          <Field label="Customer contact" name="consignee_name">
            <Input key={k("cn")} name="consignee_name" defaultValue={values.consignee_name} />
          </Field>
          <Field label="Customer mobile" name="consignee_phone">
            <Input key={k("cp")} name="consignee_phone" inputMode="tel" defaultValue={values.consignee_phone} />
          </Field>
          <Field label="Notes" name="notes" className="sm:col-span-2">
            <Textarea key={k("notes")} name="notes" rows={2} defaultValue={values.notes} />
          </Field>
        </div>
      </details>
    </div>
  );
}
