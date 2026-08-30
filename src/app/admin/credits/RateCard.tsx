"use client";

import { useState } from "react";

import { saveCreditRate } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, FormGrid, Input, Textarea } from "@/components/form";
import { Mono, Panel } from "@/components/ui";
// Only the two pure formatters. The service-role helpers in the same module are
// never referenced here, so nothing privileged is constructed in the browser.
import { describeRate, formatCredits } from "@/lib/credits";
import type { CreditRate } from "@/lib/types";

/**
 * "manual search" -> "manual searches", "automatic check" -> "automatic checks".
 * Crude on purpose: the admin types the label, so a wrong plural is visible and
 * fixable in the same box.
 */
function plural(noun: string): string {
  return /(s|x|z|ch|sh)$/i.test(noun) ? `${noun}es` : `${noun}s`;
}

/**
 * describeRate() speaks in generic "uses". The admin is looking at one named
 * action, so put its own label in: "1 credit = 2 automatic checks".
 */
function sentence(unitsPerCredit: number, label: string): string {
  if (!Number.isFinite(unitsPerCredit) || unitsPerCredit <= 0) {
    return "Enter how many of this action one credit buys.";
  }
  const noun = label.trim().toLowerCase();
  const base = describeRate({ units_per_credit: unitsPerCredit });
  if (!noun) return base;
  return base.replace(/\buses?$/, (word) => (word === "uses" ? plural(noun) : noun));
}

/** One editable row of credit_rates, with the sentence it produces underneath. */
export function RateCard({ rate }: { rate: CreditRate }) {
  const [label, setLabel] = useState(rate.label);
  const [units, setUnits] = useState(String(rate.units_per_credit));

  const parsed = Number(units);
  const costEach = Number.isFinite(parsed) && parsed > 0 ? 1 / parsed : null;

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

        <div className="space-y-4">
          <FormGrid cols={2}>
            <Field
              label="What officers call it"
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

            <Field
              label="One credit buys"
              name={`units_${rate.action}`}
              hint="2 means one credit covers two of them. 0.5 means each one costs two credits."
            >
              <Input
                name="units_per_credit"
                id={`units_${rate.action}`}
                type="number"
                required
                min={0.01}
                max={10000}
                step="0.01"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
              />
            </Field>
          </FormGrid>

          <p className="rounded-lg border border-brand-500/35 bg-brand-500/8 px-3 py-2.5 text-sm text-ink">
            {sentence(parsed, label)}
            {costEach !== null ? (
              <span className="mt-0.5 block text-xs text-muted">
                Each one debits {formatCredits(Math.ceil(costEach * 100) / 100)} credit
                {Math.ceil(costEach * 100) / 100 === 1 ? "" : "s"}, rounded up to the paisa.
              </span>
            ) : null}
          </p>

          <Field
            label="Description"
            name={`description_${rate.action}`}
            hint="Explains to the officer what they are paying for."
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
