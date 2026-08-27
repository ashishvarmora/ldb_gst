import { RotateCcw } from "lucide-react";

import { saveOverrides } from "../actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, TriState } from "@/components/form";
import { Badge, Panel } from "@/components/ui";
import { BOOLEAN_LIMITS, NUMERIC_LIMITS, UNLIMITED, formatLimit } from "@/lib/limits";
import type { LimitOverrides, OfficerOverview, Plan } from "@/lib/types";

function inputValue(value: number | null): string {
  if (value === null) return "";
  return value === UNLIMITED ? "Unlimited" : String(value);
}

/**
 * Per-officer limit overrides. Each row shows what the plan says, what the
 * override says, and what the officer actually gets. Blank override = inherit.
 */
export function OverridesPanel({
  officer,
  plan,
  overrides,
}: {
  officer: OfficerOverview;
  plan: Plan | null;
  overrides: LimitOverrides | null;
}) {
  return (
    <Panel
      title="Limits for this officer"
      description={
        plan
          ? `Blank = inherit from the "${plan.name}" plan. Fill a box to override just that number.`
          : "No plan assigned, so every inherited value is zero. Assign a plan or set explicit overrides."
      }
      actions={overrides ? <Badge tone="warn">custom limits</Badge> : <Badge>following plan</Badge>}
      bodyClassName="p-0"
    >
      <ActionForm action={saveOverrides} closeOnSuccess={false}>
        <input type="hidden" name="user_id" value={officer.id} />

        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead className="border-b border-line/70 bg-raised/60">
              <tr>
                <th className="th">Limit</th>
                <th className="th text-right">Plan</th>
                <th className="th w-44">Override</th>
                <th className="th text-right">Effective</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-divider">
              {NUMERIC_LIMITS.map((field) => {
                const planValue = plan ? plan[field.key] : null;
                const overrideValue = overrides ? overrides[field.key] : null;
                const effective = officer[field.key];

                return (
                  <tr key={field.key}>
                    <td className="td">
                      <span className="block text-sm text-ink">{field.label}</span>
                      <span className="block text-xs text-faint">{field.hint}</span>
                    </td>
                    <td className="td text-right text-sm tabular-nums text-muted">
                      {plan ? formatLimit(planValue) : "--"}
                    </td>
                    <td className="td">
                      <Input
                        name={`override_${field.key}`}
                        defaultValue={inputValue(overrideValue)}
                        placeholder="inherit"
                        className="py-1.5 text-sm"
                      />
                    </td>
                    <td className="td text-right text-sm font-semibold tabular-nums text-ink">
                      {formatLimit(effective)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-3 border-t border-divider px-5 py-4">
          {BOOLEAN_LIMITS.map((field) => (
            <TriState
              key={field.key}
              name={`override_${field.key}`}
              label={field.label}
              hint={`${field.hint} Currently ${officer[field.key] ? "allowed" : "blocked"}.`}
              value={overrides ? overrides[field.key] : null}
              inheritedLabel={plan ? (plan[field.key] ? "on" : "off") : "off"}
            />
          ))}

          <Field
            label="Why"
            name="override_reason"
            hint="Shows up in the audit log. e.g. 'Extra 20 trucks for the Surat textile case.'"
          >
            <Input
              name="override_reason"
              defaultValue={overrides?.reason ?? ""}
              placeholder="Reason for the exception"
            />
          </Field>
        </div>

        <FormActions className="mx-5 mb-4">
          <span className="mr-auto flex items-center gap-1.5 text-xs text-faint">
            <RotateCcw size={12} />
            Clear every box and save to go back to the plan exactly.
          </span>
          <SubmitButton>Save limits</SubmitButton>
        </FormActions>
      </ActionForm>
    </Panel>
  );
}
