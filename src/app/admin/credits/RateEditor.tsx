"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";

import { saveCreditRate } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, Textarea } from "@/components/form";
import { Mono, Panel } from "@/components/ui";
// Only the pure helpers. The service-role functions in the same module are never
// referenced here, so nothing privileged is constructed in the browser.
import { CREDIT_ACTIONS, costOf, formatCredits } from "@/lib/credits";
import { checksPerDay, intervalLabel } from "@/lib/intervals";
import type { CreditRate } from "@/lib/types";

/**
 * The rate editor, enterable from either end.
 *
 * A rate is stored one way round - units_per_credit, "how many of this action
 * ONE credit buys" - but it is not spoken one way round. "1 credit = 2 checks"
 * and "2 credits = 1 search" are both natural, and which one an admin reaches
 * for depends entirely on whether the action is cheaper or dearer than a credit.
 * Forcing the reciprocal on them is how a rate ends up inverted.
 *
 * So both sentences are boxes, each one updates the other as it is typed, and
 * only units_per_credit is posted. Values below 1 are legitimate: they are how
 * an action that costs more than a credit is expressed.
 */

const MIN_UNITS = 0.01;
const MAX_UNITS = 10_000;

/** Two decimal places, matching numeric(10, 2) - what the column can hold. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A number for a box: 2, 0.5, 0.33. Never "0.5000000000000001". */
function boxValue(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return String(round2(value));
}

/**
 * "manual search" -> "manual searches", "automatic check" -> "automatic checks".
 * Crude on purpose: the admin types the label, so a wrong plural is visible and
 * fixable in the same box.
 */
function plural(noun: string): string {
  return /(s|x|z|ch|sh)$/i.test(noun) ? `${noun}es` : `${noun}s`;
}

/** The intervals worth costing out. Roughly the range people actually pick. */
const EXAMPLE_INTERVALS = [15, 30, 60, 360];

/** Volumes worth costing out for an action nobody schedules. */
const EXAMPLE_COUNTS = [1, 10, 100, 1_000];

export function RateEditor({ rate }: { rate: CreditRate }) {
  const [label, setLabel] = useState(rate.label);
  // Two boxes, one truth. Editing either writes the other, and neither is
  // recomputed from the other afterwards - that would fight the typing.
  const [units, setUnits] = useState(boxValue(rate.units_per_credit));
  const [perUse, setPerUse] = useState(boxValue(1 / rate.units_per_credit));

  const typedUnits = Number(units);
  const valid = Number.isFinite(typedUnits) && typedUnits >= MIN_UNITS && typedUnits <= MAX_UNITS;
  // Everything below is worked out from the value that will actually be stored,
  // not from what was typed, so the admin sees the rounding before they save it
  // rather than after.
  const stored = valid ? round2(typedUnits) : null;

  const noun = label.trim().toLowerCase() || "use";
  const nouns = plural(noun);

  const onUnits = (value: string) => {
    setUnits(value);
    const n = Number(value);
    setPerUse(Number.isFinite(n) && n > 0 ? boxValue(1 / n) : "");
  };

  const onPerUse = (value: string) => {
    setPerUse(value);
    const n = Number(value);
    setUnits(Number.isFinite(n) && n > 0 ? boxValue(1 / n) : "");
  };

  return (
    <Panel
      title={rate.label}
      description={
        <>
          Charged as <Mono className="text-[11px]">{rate.action}</Mono> by the platform.
        </>
      }
    >
      <ActionForm action={saveCreditRate} closeOnSuccess={false}>
        <input type="hidden" name="action_key" value={rate.action} />
        {/* Only ever this one. The reciprocal box is a way of typing it. */}
        <input type="hidden" name="units_per_credit" value={stored ?? ""} />

        <div className="space-y-4">
          <Field
            label="What customers call it"
            name={`label_${rate.action}`}
            hint="Appears in their credit history and on the plan page."
          >
            <Input
              name="label"
              id={`label_${rate.action}`}
              required
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </Field>

          <fieldset>
            <legend className="field-label">Set the rate from either end</legend>

            <div className="grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <SentenceBox
                id={`units_${rate.action}`}
                before="1 credit ="
                after={nouns}
                value={units}
                onChange={onUnits}
              />

              <span className="flex items-center justify-center text-xs text-faint sm:px-1">
                or
              </span>

              <SentenceBox
                id={`per_${rate.action}`}
                before="credits ="
                after={`1 ${noun}`}
                value={perUse}
                onChange={onPerUse}
                numberFirst
              />
            </div>

            <p className="field-hint">
              Type into either box and the other follows. A rate below 1 is normal — it is how an
              action that costs more than one credit is written.
            </p>
          </fieldset>

          <p className="rounded-lg border border-brand-500/35 bg-brand-500/8 px-3 py-2.5 text-sm text-ink">
            {stored === null ? (
              <span className="text-muted">
                Enter how many {nouns} one credit buys, or how many credits one {noun} costs.
              </span>
            ) : (
              <>
                <span className="font-medium">
                  1 credit = {formatCredits(stored)} {stored === 1 ? noun : nouns}
                </span>
                <span className="mt-0.5 block text-xs text-muted">
                  The same thing said the other way: {formatCredits(costOf(stored))} credit
                  {costOf(stored) === 1 ? "" : "s"} for one {noun}. That is what is debited, rounded
                  up to the paisa.
                </span>
              </>
            )}
          </p>

          {stored === null ? null : (
            <WorkedExample action={rate.action} unitsPerCredit={stored} noun={noun} />
          )}

          <Field
            label="Description"
            name={`description_${rate.action}`}
            hint="Explains to the customer what they are paying for."
          >
            <Textarea
              name="description"
              id={`description_${rate.action}`}
              rows={2}
              defaultValue={rate.description ?? ""}
            />
          </Field>
        </div>

        <FormActions>
          <SubmitButton>Save rate</SubmitButton>
        </FormActions>
      </ActionForm>
    </Panel>
  );
}

/**
 * One half of the relation, written as a sentence with the number in the middle
 * of it. The whole block is the label, so tapping the words focuses the box.
 */
function SentenceBox({
  id,
  before,
  after,
  value,
  onChange,
  numberFirst = false,
}: {
  id: string;
  before: string;
  after: string;
  value: string;
  onChange: (value: string) => void;
  /** True when the number opens the sentence: "[2] credits = 1 search". */
  numberFirst?: boolean;
}) {
  const box = (
    <input
      id={id}
      type="number"
      inputMode="decimal"
      min={MIN_UNITS}
      max={MAX_UNITS}
      step="0.01"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="field w-20 shrink-0 px-2 py-1.5 text-center tabular-nums"
    />
  );

  return (
    <label
      htmlFor={id}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-line/70 bg-panel/50 px-3 py-2.5 text-sm text-ink transition hover:border-line-strong"
    >
      {numberFirst ? box : null}
      <span className={numberFirst ? "" : "shrink-0"}>{before}</span>
      {numberFirst ? null : box}
      <span className="min-w-0 break-words text-muted">{after}</span>
    </label>
  );
}

/**
 * What the rate costs in practice.
 *
 * A rate on its own is an abstraction: 0.5 credits per check is fine until it
 * is twenty-four credits a day on every truck. The automatic check is driven by
 * an alert interval, so it is costed per day at the intervals people pick;
 * everything else is costed by volume.
 */
function WorkedExample({
  action,
  unitsPerCredit,
  noun,
}: {
  action: string;
  unitsPerCredit: number;
  noun: string;
}) {
  const scheduled = action === CREDIT_ACTIONS.autoCheck;

  const rows = scheduled
    ? EXAMPLE_INTERVALS.map((minutes) => {
        const perDay = checksPerDay(minutes);
        return {
          key: String(minutes),
          left: `Alert every ${intervalLabel(minutes)}`,
          middle: `${perDay.toLocaleString("en-IN")} a day`,
          right: `${formatCredits(costOf(unitsPerCredit, perDay))} credits a day`,
        };
      })
    : EXAMPLE_COUNTS.map((count) => ({
        key: String(count),
        left: `${count.toLocaleString("en-IN")} ${count === 1 ? noun : plural(noun)}`,
        middle: "",
        right: `${formatCredits(costOf(unitsPerCredit, count))} credits`,
      }));

  return (
    <div className="rounded-lg border border-line/70 bg-panel/50 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
        <Calculator size={13} className="shrink-0 text-brand-500" />
        {scheduled ? "What one truck costs at this rate" : "What this costs in bulk"}
      </p>
      <ul className="mt-2 space-y-1">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
            <span className="text-muted">
              {row.left}
              {row.middle ? <span className="text-faint"> · {row.middle}</span> : null}
            </span>
            <span className="font-medium tabular-nums text-ink">{row.right}</span>
          </li>
        ))}
      </ul>
      {scheduled ? (
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Per truck, per alert. A customer watching ten trucks on a 30-minute alert spends ten times
          the second line.
        </p>
      ) : null}
    </div>
  );
}
