"use client";

import { useState } from "react";

import { addTruck } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, Select } from "@/components/form";
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
export function AddTruckForm({
  templates,
  defaultFailureCutoff,
  defaultInactiveHours,
}: {
  templates: AlertRuleTemplate[];
  /** The admin's number, used for any truck the officer leaves blank. */
  defaultFailureCutoff: number;
  /** The admin's "stopped moving for this long" fallback, in hours. */
  defaultInactiveHours: number;
}) {
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
          On the first screen rather than behind "More settings", because it is
          the answer to the mistake this product actually causes: somebody puts
          a lorry on automatic checking to follow it for an afternoon, does not
          come back, and pays for a check every hour for a fortnight. Asking the
          question while they are still thinking about the journey costs one
          box; asking it later costs them credits.

          Blank is a real answer and the default one - plenty of trucks are
          meant to be watched indefinitely.
        */}
        <div className="border-t border-divider pt-5">
          <LabelWithInfo
            label="Stop checking automatically after"
            htmlFor="auto_pause_amount"
            info={
              <>
                Set this if you only need to follow this truck for a while. When the time is up it
                is paused, you are told, and it stops costing credits — nothing is deleted and
                every crossing it recorded stays.
                <span className="mt-1.5 block text-faint">
                  Leave it empty to keep checking until you pause it yourself.
                </span>
              </>
            }
          />
          <div className="mt-1.5 flex gap-2">
            <Input
              id="auto_pause_amount"
              name="auto_pause_amount"
              type="number"
              inputMode="numeric"
              min={1}
              max={8760}
              step={1}
              placeholder="Leave empty to keep going"
              className="flex-1"
            />
            <Select name="auto_pause_unit" defaultValue="hours" className="w-28 shrink-0">
              <option value="hours">hours</option>
              <option value="days">days</option>
            </Select>
          </div>
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
                      Leave it empty to use the platform default, currently {defaultFailureCutoff}{" "}
                      failed checks. Change it here only for a truck you want more or less patience
                      with.
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
                placeholder={`Default (${defaultFailureCutoff})`}
                className="mt-1.5"
              />

              {/*
                The third stop, and the one nobody thinks to ask for. A lorry
                parked in a yard answers every check with the same crossing it
                answered with yesterday, so the checks cost credits and tell
                nobody anything. This is a per-truck number for the same reason
                the failure budget is: only the officer knows whether this
                particular vehicle is expected to sit still for a week.
              */}
              <div className="mt-4">
                <LabelWithInfo
                  label="Pause if it stops moving for"
                  htmlFor="inactive_pause_hours"
                  info={
                    <>
                      Counted from the last toll crossing that came through. If the lorry is parked
                      and no new crossing arrives for this long, checking is paused and you are
                      told — so a vehicle standing in a yard stops quietly spending credits on the
                      same answer.
                      <span className="mt-1.5 block text-faint">
                        Leave it empty to use the platform default, currently{" "}
                        {defaultInactiveHours} hours. Set it longer for a truck you expect to be
                        parked.
                      </span>
                    </>
                  }
                />
                <Input
                  id="inactive_pause_hours"
                  name="inactive_pause_hours"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={8760}
                  step={1}
                  placeholder={`Default (${defaultInactiveHours} hours)`}
                  className="mt-1.5"
                />
              </div>
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
