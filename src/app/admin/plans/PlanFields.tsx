import { Checkbox, Field, FormGrid, Input, Textarea } from "@/components/form";
import { BOOLEAN_LIMITS, NUMERIC_LIMITS, UNLIMITED, estimateMonthlyQueries } from "@/lib/limits";
import { fmtNumber } from "@/lib/format";
import type { Plan } from "@/lib/types";

/** -1 is stored, but "Unlimited" is what an admin wants to read and type. */
function limitValue(value: number): string {
  return value === UNLIMITED ? "Unlimited" : String(value);
}

/**
 * Every field of a plan. Shared by the create and edit forms so the two can
 * never drift apart.
 */
export function PlanFields({ plan }: { plan?: Plan }) {
  const trucks = plan?.truck_limit ?? 10;
  const interval = plan?.min_polling_interval_minutes ?? 30;
  const monthly = plan?.tracking_queries_per_month ?? 2000;
  const needed = estimateMonthlyQueries(trucks === UNLIMITED ? 0 : trucks, interval);
  const shortfall = trucks !== UNLIMITED && monthly !== UNLIMITED && needed > monthly;

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
        <p className="mb-3 text-xs font-semibold tracking-wider text-ink-400 uppercase">
          Limits
        </p>
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

      {shortfall ? (
        <p className="rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs leading-relaxed text-warn-500">
          Heads up: {fmtNumber(trucks)} trucks polled every {interval} min needs about{" "}
          {fmtNumber(needed)} queries a month, but this plan allows {fmtNumber(monthly)}. Officers
          will hit the monthly cap before the month ends unless they poll some trucks more slowly.
        </p>
      ) : null}

      <div>
        <p className="mb-3 text-xs font-semibold tracking-wider text-ink-400 uppercase">
          Features
        </p>
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
