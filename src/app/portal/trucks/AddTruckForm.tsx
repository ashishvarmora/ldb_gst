"use client";

import { addTruck } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input } from "@/components/form";
import { AlertChooser } from "@/components/TruckAlertForm";
import type { AlertRuleTemplate } from "@/lib/types";

/**
 * Adding a truck and choosing its first alert, in one step.
 *
 * Adding used to stop at the number, and a truck with no alert is never
 * checked - so the most common first experience of the platform was silence.
 * The alert is not an extra here: it is the reason the truck is on the list.
 */
export function AddTruckForm({ templates }: { templates: AlertRuleTemplate[] }) {
  return (
    <ActionForm action={addTruck} closeOnSuccess={false}>
      <div className="space-y-5">
        <Field label="Truck number" name="truck_number" hint="Spaces and dashes are ignored.">
          <Input
            name="truck_number"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="GJ02AT8546"
            className="font-mono tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
          />
        </Field>

        <Field label="Name it" name="label" hint="Optional. Whatever helps you recognise it later.">
          <Input name="label" placeholder="Supplier vehicle" />
        </Field>

        <div className="border-t border-divider pt-5">
          <AlertChooser templates={templates} />
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
