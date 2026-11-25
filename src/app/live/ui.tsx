"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";

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
 * Trip state buttons (Planned / Active / Done / Cancelled). Submits `state`
 * with the button; Cancel and reopening ask first. Lives inside an ActionForm.
 */
export function StateBar({ current, labels }: { current: "planned" | "active" | "done" | "cancelled"; labels: Record<string, string> }) {
  const order = ["planned", "active", "done", "cancelled"] as const;
  return (
    <div className="live-statebar" role="group" aria-label="Trip status">
      {order.map((s) => (
        <button
          key={s}
          type="submit"
          name="state"
          value={s}
          aria-pressed={current === s}
          disabled={current === s}
          data-tone={s}
          onClick={(e) => {
            const closed = current === "done" || current === "cancelled";
            const msg =
              s === "cancelled"
                ? "Cancel this trip? It stays in your records and can be reopened."
                : closed
                  ? `Reopen this trip as ${labels[s]}?`
                  : s === "planned" && current === "active"
                    ? "Move this Active trip back to Planned?"
                    : null;
            if (msg && !window.confirm(msg)) e.preventDefault();
          }}
        >
          {labels[s]}
        </button>
      ))}
    </div>
  );
}
