"use client";

import { useState } from "react";
import { ChevronDown, Plus, RefreshCw, X } from "lucide-react";

import { ActionForm, SubmitButton, useActionPending } from "@/components/ActionForm";

import { setTripState } from "./actions";

/**
 * v4 form controls (docs/LIVE-PLAN-v4.md §8):
 *   Seg               2-4 exclusive options (radio underneath, so it posts).
 *   CustomFieldsEditor "Add field" key/value rows -> cf_key[] / cf_val[].
 */

export function Seg<T extends string>({
  name,
  value,
  onChange,
  options,
  label,
  disabled,
}: {
  name: string;
  value: T;
  onChange?: (v: T) => void;
  options: { v: T; label: string; icon?: React.ReactNode }[];
  label: string;
  disabled?: boolean;
}) {
  return (
    <div className="live-seg2" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <label key={o.v} data-on={value === o.v || undefined}>
          <input type="radio" name={name} value={o.v} checked={value === o.v} disabled={disabled} onChange={() => onChange?.(o.v)} />
          <span>
            {o.icon}
            {o.label}
          </span>
        </label>
      ))}
    </div>
  );
}

export function CustomFieldsEditor({ initial }: { initial: [string, string][] }) {
  const [rows, setRows] = useState<{ id: number; k: string; v: string }[]>(() => initial.map(([k, v], i) => ({ id: i, k, v })));
  const [next, setNext] = useState(initial.length);
  return (
    <div className="live-cf">
      <input type="hidden" name="cf_present" value="1" />
      {rows.map((r) => (
        <div key={r.id} className="live-cf-row">
          <input
            name="cf_key"
            value={r.k}
            onChange={(e) => setRows((x) => x.map((y) => (y.id === r.id ? { ...y, k: e.target.value } : y)))}
            maxLength={40}
            placeholder="Field"
            aria-label="Field name"
            className="field"
          />
          <input
            name="cf_val"
            value={r.v}
            onChange={(e) => setRows((x) => x.map((y) => (y.id === r.id ? { ...y, v: e.target.value } : y)))}
            maxLength={200}
            placeholder="Value"
            aria-label="Field value"
            className="field"
          />
          <button type="button" aria-label="Remove field" onClick={() => setRows((x) => x.filter((y) => y.id !== r.id))} className="live-icon-btn">
            <X size={14} />
          </button>
        </div>
      ))}
      {rows.length < 20 ? (
        <button
          type="button"
          className="live-btn-sm"
          onClick={() => {
            setRows((x) => [...x, { id: next, k: "", v: "" }]);
            setNext((n) => n + 1);
          }}
        >
          <Plus size={13} /> Add field
        </button>
      ) : null}
    </div>
  );
}

/**
 * v5: the trip's status control. The chip shows the current status; "Change"
 * opens a small card with a status select and an optional note. A refused
 * change (driver on another Active trip...) shows its reason right here.
 */
export function StatusControl({
  tripId,
  current,
  labels,
  canStart,
  asAction = false,
}: {
  tripId: string;
  current: "planned" | "active" | "done" | "cancelled";
  labels: Record<string, string>;
  canStart: boolean;
  /** v7: drawn as an icon tile in the trip page's action bar. */
  asAction?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const order = ["planned", "active", "done", "cancelled"] as const;
  const options = order.filter((s) => s !== current);
  const [to, setTo] = useState<string>(current === "planned" ? "active" : current === "active" ? "done" : "active");
  const hint =
    to === "cancelled"
      ? "Kept in your records; can be reopened."
      : to === "planned"
        ? current === "active"
          ? "Back to Planned: tracking stays on, the trip is not counted as started."
          : "Reopen as Planned."
        : to === "active"
          ? canStart
            ? current === "planned"
              ? "Starts the trip now; actual start = now."
              : "Reopen as Active."
            : "Add a driver first: tracking follows his phone."
          : "Marks the trip delivered. The note becomes the delivery note.";
  return (
    <div className="live-statusctl">
      {asAction ? (
        <button type="button" className="lv-act" aria-expanded={open} aria-label="Change status" onClick={() => setOpen((x) => !x)}>
          <RefreshCw size={17} />
          <span>Status</span>
        </button>
      ) : (
        <button type="button" className="live-btn-sm" aria-expanded={open} onClick={() => setOpen((x) => !x)}>
          Change <ChevronDown size={13} />
        </button>
      )}
      {open ? (
        <div className="live-pop" role="dialog" aria-label="Change status">
          <ActionForm action={setTripState} closeOnSuccess={false}>
            <input type="hidden" name="id" value={tripId} />
            <label className="live-mini-label" htmlFor={`st-${tripId}`}>
              New status
            </label>
            <select id={`st-${tripId}`} name="state" value={to} onChange={(e) => setTo(e.target.value)} className="field live-field-sm w-full">
              {options.map((s) => (
                <option key={s} value={s}>
                  {labels[s]}
                </option>
              ))}
            </select>
            <p className="live-mini-hint">{hint}</p>
            <input name="note" maxLength={500} placeholder={to === "done" ? "Delivery note (optional)" : "Note (optional)"} className="field live-field-sm mt-1.5 w-full" />
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button type="button" className="live-btn-sm" onClick={() => setOpen(false)}>
                Close
              </button>
              <SubmitButton size="sm" pendingLabel="Saving">
                Save
              </SubmitButton>
            </div>
          </ActionForm>
        </div>
      ) : null}
    </div>
  );
}

/** v5: preset select with an "Other..." free-text field (warehouse type, vehicle type). */
export function PresetOrOther({
  name,
  customName,
  presets,
  value,
  otherValue = "__other",
  label,
  placeholder,
}: {
  name: string;
  customName: string;
  presets: string[];
  value: string | null | undefined;
  otherValue?: string;
  label: string;
  placeholder?: string;
}) {
  const isPreset = !value || presets.includes(value);
  const [v, setV] = useState(isPreset ? (value ?? presets[0]) : otherValue);
  return (
    <div className="live-f">
      <label className="live-mini-label" htmlFor={name}>
        {label}
      </label>
      <select id={name} name={name} value={v} onChange={(e) => setV(e.target.value)} className="field live-field-sm w-full">
        {presets.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
        <option value={otherValue}>Other…</option>
      </select>
      {v === otherValue ? (
        <input name={customName} defaultValue={isPreset ? "" : (value ?? "")} maxLength={40} placeholder={placeholder ?? "Type it"} className="field live-field-sm mt-1.5 w-full" aria-label={`${label}: other`} />
      ) : null}
    </div>
  );
}

/** v5: icon-only submit (inside an ActionForm), with an optional confirm. 32 px. */
export function IconSubmit({ label, confirm, tone, children }: { label: string; confirm?: string; tone?: "bad"; children: React.ReactNode }) {
  const pending = useActionPending();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      title={label}
      className={tone === "bad" ? "live-ib live-ib-bad" : "live-ib"}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}

/** Seg with its own state (for server-rendered forms). */
export function SegU<T extends string>(props: { name: string; initial: T; options: { v: T; label: string }[]; label: string }) {
  const [v, setV] = useState<T>(props.initial);
  return <Seg name={props.name} label={props.label} value={v} onChange={setV} options={props.options} />;
}
