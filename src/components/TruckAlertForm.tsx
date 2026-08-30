"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { addTruckAlert } from "@/app/portal/trucks/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, FormGrid, Input, Select } from "@/components/form";
import { ALERT_KIND_HINT, intervalWords, needsPlaza } from "@/lib/alerts";
import { MAX_INTERVAL_MINUTES } from "@/lib/intervals";
import type { AlertRuleTemplate } from "@/lib/types";

/**
 * Adds one alert to one truck.
 *
 * Client-side only because the form changes shape as the rule changes: the
 * plaza dropdown belongs to one kind of rule, and each rule carries its own
 * minimum and default interval.
 */
export function TruckAlertForm({
  truckId,
  templates,
  plazas,
}: {
  truckId: string;
  templates: AlertRuleTemplate[];
  plazas: string[];
}) {
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const chosen = templates.find((template) => template.id === templateId) ?? null;

  if (!chosen) {
    return (
      <p className="text-xs leading-relaxed text-muted">
        Your administrator has not published any alert rules yet. Ask them to add one.
      </p>
    );
  }

  const wantsPlaza = needsPlaza(chosen.kind);

  return (
    <ActionForm action={addTruckAlert} closeOnSuccess={false}>
      <input type="hidden" name="truck_id" value={truckId} />

      <div className="space-y-4">
        <Field label="Alert" name="template_id" hint={chosen.description ?? ALERT_KIND_HINT[chosen.kind]}>
          <Select
            name="template_id"
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </Select>
        </Field>

        <FormGrid cols={wantsPlaza ? 2 : 1}>
          <Field
            label="Check every (minutes)"
            name="interval_minutes"
            hint={`This alert may run every ${intervalWords(chosen.min_interval_minutes)} at the fastest.`}
          >
            {/* Keyed on the rule so switching rules loads that rule's default
                rather than leaving the previous rule's number behind. */}
            <Input
              key={chosen.id}
              type="number"
              name="interval_minutes"
              min={chosen.min_interval_minutes}
              max={MAX_INTERVAL_MINUTES}
              step={1}
              inputMode="numeric"
              defaultValue={chosen.default_interval_minutes}
            />
          </Field>

          {wantsPlaza ? (
            <Field
              label="Toll plaza"
              name="plaza"
              hint={
                plazas.length === 0
                  ? "No plazas recorded yet. One appears here after a truck crosses it."
                  : "You get a message the moment the truck is recorded here."
              }
            >
              <Select name="plaza" defaultValue="" required disabled={plazas.length === 0}>
                <option value="" disabled>
                  Choose a plaza
                </option>
                {plazas.map((plaza) => (
                  <option key={plaza} value={plaza}>
                    {plaza}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </FormGrid>
      </div>

      <FormActions>
        <SubmitButton pendingLabel="Adding...">
          <Plus size={14} />
          Add alert
        </SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
