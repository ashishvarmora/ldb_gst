"use client";

import { useState } from "react";

import { addTruck } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input } from "@/components/form";
import { LabelWithInfo } from "@/components/InfoTip";
import { AlertChooser } from "@/components/TruckAlertForm";
import type { AlertRuleTemplate } from "@/lib/types";

/**
 * Adding a truck and choosing its first alert, in one step.
 *
 * Adding used to stop at the number, and a truck with no alert is never
 * checked - so the most common first experience of the platform was silence.
 * The alert is not an extra here: it is the reason the truck is on the list.
 *
 * The order is the order the questions actually arrive in. The number is the
 * only thing that must be typed, so it is first and alone. The name is
 * optional and sits under it rather than beside it - a two-column row on a
 * phone makes both boxes too narrow to read a registration number in. Then
 * what to be told, then how often. Everything a first-time reader does not
 * need is behind the (i) or behind "More settings".
 */
export function AddTruckForm({ templates }: { templates: AlertRuleTemplate[] }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  return (
    <ActionForm action={addTruck} closeOnSuccess={false}>
      <div className="space-y-5">
        <Field
          label="Truck number"
          name="truck_number"
          hint="Spaces and dashes are ignored."
          required
        >
          <Input
            name="truck_number"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="GJ02AT8546"
            className="font-mono text-base tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
          />
        </Field>

        <Field label="Name it" name="label" hint="Optional. Whatever helps you recognise it later.">
          <Input name="label" placeholder="Supplier vehicle" />
        </Field>

        <div className="border-t border-divider pt-5">
          <AlertChooser templates={templates} />
        </div>

        {/*
          One toggle, not a second form. What is behind it is a safety valve
          most people never touch, and putting it on the first screen would
          make adding a truck look like configuring one.
        */}
        <div className="border-t border-divider pt-4">
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            aria-expanded={showAdvanced}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg text-xs font-medium text-muted transition hover:text-ink"
          >
            {showAdvanced ? "Hide" : "More settings"}
          </button>

          {showAdvanced ? (
            <div className="mt-3">
              <LabelWithInfo
                label="Stop checking after this many failures"
                htmlFor="max_consecutive_failures"
                info={
                  <>
                    A check fails when the toll network cannot answer for this number - usually a
                    typo, or a lorry it has stopped reporting. After five failures in a row we
                    message you. If they keep failing, the truck is paused so it stops spending
                    credits on a question with no answer; nothing is deleted and its recorded
                    crossings stay.
                    <span className="mt-1.5 block text-faint">
                      Leave this empty and we work it out from how often this truck is checked,
                      which comes to about a day of failing either way.
                    </span>
                  </>
                }
              />
              <Input
                id="max_consecutive_failures"
                name="max_consecutive_failures"
                type="number"
                inputMode="numeric"
                min={1}
                max={1000}
                step={1}
                placeholder="Automatic"
                className="mt-1.5"
              />
            </div>
          ) : null}
        </div>
      </div>

      <FormActions>
        <SubmitButton pendingLabel="Adding...">
          {templates.length > 0 ? "Add truck and start watching" : "Add truck"}
        </SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
