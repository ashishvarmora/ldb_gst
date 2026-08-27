"use client";

import { useState } from "react";

import { cx } from "@/components/ui";
import { fmtNumber } from "@/lib/format";
import {
  allowedPresets,
  intervalLabel,
  intervalShort,
  monthlyCallsAt,
  splitInterval,
  toMinutes,
  type IntervalUnit,
} from "@/lib/intervals";

/**
 * Picks a checking interval as either a preset or any custom number of minutes
 * or hours. Whatever the officer clicks, one hidden field carries plain minutes
 * to the server, so nothing downstream has to know about units.
 *
 * `floorMinutes` is the fastest the administrator allows. Presets below it are
 * not offered, and a custom value below it is corrected upward on submit by the
 * Server Action - the note under the field says so rather than silently fixing
 * it after the fact.
 */
export function IntervalField({
  name = "polling_interval_minutes",
  defaultMinutes,
  floorMinutes,
  showCost = true,
  inherit,
}: {
  name?: string;
  defaultMinutes: number;
  floorMinutes: number;
  showCost?: boolean;
  /**
   * Offer an "Inherit" choice that submits an empty value. Only for the admin's
   * per-officer override, where blank means "follow the plan" - without it the
   * field would silently pin an override the administrator never asked for.
   */
  inherit?: { label: string; startsInherited: boolean };
}) {
  const presets = allowedPresets(floorMinutes);
  const initial = Math.max(defaultMinutes, floorMinutes);

  const [inherited, setInherited] = useState(inherit?.startsInherited ?? false);
  const [minutes, setMinutes] = useState(initial);
  const [custom, setCustom] = useState(() => !presets.includes(initial));
  const [draft, setDraft] = useState(() => splitInterval(initial));

  function applyCustom(value: number, unit: IntervalUnit) {
    setDraft({ value, unit });
    const asMinutes = toMinutes(value, unit);
    if (asMinutes !== null) setMinutes(asMinutes);
  }

  const belowFloor = minutes < floorMinutes;

  return (
    <div>
      <input type="hidden" name={name} value={inherited ? "" : minutes} />

      <div className="flex flex-wrap gap-1.5">
        {inherit ? (
          <button
            type="button"
            aria-pressed={inherited}
            onClick={() => setInherited(true)}
            className={cx(
              "inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs font-medium transition",
              inherited
                ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
                : "border-line bg-panel text-muted hover:bg-sunken hover:text-ink",
            )}
          >
            {inherit.label}
          </button>
        ) : null}

        {presets.map((preset) => {
          const active = !inherited && !custom && minutes === preset;
          return (
            <button
              key={preset}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setInherited(false);
                setCustom(false);
                setMinutes(preset);
                setDraft(splitInterval(preset));
              }}
              className={cx(
                "inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs font-medium transition",
                active
                  ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
                  : "border-line bg-panel text-muted hover:bg-sunken hover:text-ink",
              )}
            >
              {intervalShort(preset)}
            </button>
          );
        })}

        <button
          type="button"
          aria-pressed={!inherited && custom}
          onClick={() => {
            setInherited(false);
            setCustom(true);
          }}
          className={cx(
            "inline-flex min-h-9 items-center rounded-full border px-3.5 text-xs font-medium transition",
            !inherited && custom
              ? "border-brand-500/40 bg-brand-500/10 text-brand-500"
              : "border-line bg-panel text-muted hover:bg-sunken hover:text-ink",
          )}
        >
          Custom
        </button>
      </div>

      {!inherited && custom ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Every</span>
          <input
            type="number"
            min={1}
            max={10080}
            inputMode="numeric"
            value={draft.value}
            onChange={(event) => applyCustom(Number(event.target.value), draft.unit)}
            className="field w-24 py-1.5"
            aria-label="Interval amount"
          />
          <select
            value={draft.unit}
            onChange={(event) => applyCustom(draft.value, event.target.value as IntervalUnit)}
            className="field w-32 appearance-none py-1.5 pr-8"
            aria-label="Interval unit"
          >
            <option value="minutes">minutes</option>
            <option value="hours">hours</option>
          </select>
        </div>
      ) : null}

      <p className="field-hint">
        {inherited ? (
          <>Following the plan. Pick a value above to override it for this officer only.</>
        ) : belowFloor ? (
          <span className="text-warn-500">
            Your administrator allows {intervalLabel(floorMinutes)} at the fastest. Saving will use{" "}
            {intervalLabel(floorMinutes)}.
          </span>
        ) : (
          <>
            Checks every {intervalLabel(minutes)}
            {showCost ? ` — about ${fmtNumber(monthlyCallsAt(minutes))} checks a month for this truck` : ""}.
          </>
        )}
      </p>
    </div>
  );
}
