import { Checkbox, Field, FormGrid, Input, Textarea } from "@/components/form";
import { BOOLEAN_LIMITS, NUMERIC_LIMITS, UNLIMITED } from "@/lib/limits";
import type { Plan } from "@/lib/types";

/** -1 is stored, but "Unlimited" is what an admin wants to read and type. */
function limitValue(value: number): string {
  return value === UNLIMITED ? "Unlimited" : String(value);
}

/**
 * Every field of a plan. Shared by the create and edit forms so the two can
 * never drift apart.
 *
 * A plan says what an account may REACH. What it may USE comes out of the
 * credit balance, at the rates on the credits page, so there are no per-day or
 * per-month allowances here - only the credits the plan hands over up front.
 */
export function PlanFields({ plan }: { plan?: Plan }) {
  return (
    <div className="space-y-5">
      <FormGrid cols={2}>
        <Field label="Plan name" name="name">
          <Input name="name" required defaultValue={plan?.name} placeholder="Professional" />
        </Field>
        <Field
          label="Service charge / month"
          name="price_per_month"
          hint="For your records only — nothing is charged by the app."
        >
          <Input
            name="price_per_month"
            type="number"
            min={0}
            step="1"
            defaultValue={plan?.price_per_month ?? 0}
          />
        </Field>
      </FormGrid>

      <Field label="Description" name="description">
        <Textarea
          name="description"
          rows={2}
          defaultValue={plan?.description ?? ""}
          placeholder="Full district workload."
        />
      </Field>

      <div>
        <p className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Credits</p>
        <FormGrid cols={2}>
          <Field
            label="Credits included"
            name="included_credits"
            hint="Granted once, when the plan is first assigned. Officers buy more on top; this is the starting allocation, not a cap."
          >
            <Input
              name="included_credits"
              type="number"
              min={0}
              step="1"
              defaultValue={plan?.included_credits ?? 0}
            />
          </Field>
        </FormGrid>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Limits</p>
        <FormGrid cols={3}>
          {NUMERIC_LIMITS.map((field) => (
            <Field
              key={field.key}
              label={field.label}
              name={field.key}
              hint={field.allowUnlimited ? `${field.hint} Type "unlimited" for no cap.` : field.hint}
            >
              <Input
                name={field.key}
                required
                defaultValue={plan ? limitValue(plan[field.key]) : undefined}
                placeholder={field.allowUnlimited ? "e.g. 50 or unlimited" : "e.g. 10"}
              />
            </Field>
          ))}
        </FormGrid>
      </div>

      <div>
        <p className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">Features</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {BOOLEAN_LIMITS.map((field) => (
            <Checkbox
              key={field.key}
              name={field.key}
              label={field.label}
              hint={field.hint}
              defaultChecked={plan ? plan[field.key] : true}
            />
          ))}
        </div>
      </div>

      <Field
        label="Sort order"
        name="sort_order"
        hint="Lower numbers appear first in the plan list."
      >
        <Input
          name="sort_order"
          type="number"
          min={0}
          step="10"
          defaultValue={plan?.sort_order ?? 100}
          className="max-w-32"
        />
      </Field>
    </div>
  );
}
