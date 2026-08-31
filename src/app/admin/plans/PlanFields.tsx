"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { PlanPreview } from "./PlanPreview";
import { Field, FormGrid, Input, Textarea } from "@/components/form";
import { NUMERIC_LIMITS, UNLIMITED, parseLimitInput } from "@/lib/limits";
import type { Plan } from "@/lib/types";

/** -1 is stored, but "Unlimited" is what an admin wants to read and type. */
function limitValue(value: number): string {
  return value === UNLIMITED ? "Unlimited" : String(value);
}

function amount(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Every field of a plan. Shared by the create and edit forms so the two can
 * never drift apart.
 *
 * A plan decides two things: how many trucks may be under automatic checking,
 * and how many credits the account opens with. What it used to carry besides -
 * feature switches, a retention window, alert intervals - is either paid for
 * out of the credit balance or set once for the whole platform, so none of it
 * belongs on a plan any more.
 *
 * It is a Client Component only for the preview beside it. Plans are bought by
 * strangers now, so the price and the credit allocation are read before anyone
 * pays, and typing them blind is how a wrong price ships.
 */
export function PlanFields({ plan }: { plan?: Plan }) {
  const [draft, setDraft] = useState({
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    price: String(plan?.price_per_month ?? 0),
    credits: String(plan?.included_credits ?? 0),
  });

  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      NUMERIC_LIMITS.map((field) => [field.key, plan ? limitValue(plan[field.key]) : ""]),
    ),
  );

  const edit = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));

  // The same parser the Server Action uses, so "unlimited" previews as
  // unlimited rather than as a broken number.
  const truckLimit = parseLimitInput(limits.truck_limit ?? "", {
    allowUnlimited: true,
    allowBlank: true,
    min: 0,
  });

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="space-y-5">
        <FormGrid cols={2}>
          <Field label="Plan name" name="name" hint="The heading on the public plan page.">
            <Input
              name="name"
              required
              value={draft.name}
              onChange={(e) => edit({ name: e.target.value })}
              placeholder="Professional"
              autoComplete="off"
            />
          </Field>
          <Field
            label="Price per month (Rs)"
            name="price_per_month"
            hint="What a customer is charged when they buy this plan. Zero makes it a free plan."
          >
            <Input
              name="price_per_month"
              type="number"
              min={0}
              step="1"
              value={draft.price}
              onChange={(e) => edit({ price: e.target.value })}
            />
          </Field>
        </FormGrid>

        <Field
          label="Description"
          name="description"
          hint="One line under the price on the public plan page. Say who the plan is for."
        >
          <Textarea
            name="description"
            rows={2}
            value={draft.description}
            onChange={(e) => edit({ description: e.target.value })}
            placeholder="For a fleet of up to fifty trucks."
          />
        </Field>

        <div>
          <p className="mb-3 text-xs font-semibold tracking-wider text-muted uppercase">
            What the customer gets
          </p>
          <FormGrid cols={2}>
            <Field
              label="Credits included"
              name="included_credits"
              hint="Handed over the moment the plan is bought or assigned, and again on every renewal. Customers buy more on top; this is the starting allocation, not a cap."
            >
              <Input
                name="included_credits"
                type="number"
                min={0}
                step="1"
                value={draft.credits}
                onChange={(e) => edit({ credits: e.target.value })}
              />
            </Field>

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
                  value={limits[field.key] ?? ""}
                  onChange={(e) =>
                    setLimits((current) => ({ ...current, [field.key]: e.target.value }))
                  }
                  placeholder={field.allowUnlimited ? "e.g. 50 or unlimited" : "e.g. 10"}
                />
              </Field>
            ))}
          </FormGrid>
        </div>

        <Field
          label="Sort order"
          name="sort_order"
          hint="Lower numbers appear first, here and on the public plan page."
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

      <aside>
        <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
          <Eye size={13} />
          On the plan page
        </p>
        <PlanPreview
          name={draft.name}
          description={draft.description}
          pricePerMonth={amount(draft.price)}
          includedCredits={amount(draft.credits)}
          truckLimit={truckLimit ?? 0}
          isActive={plan?.is_active ?? true}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          This is what a customer sees before they pay. Archived plans are hidden from that page but
          keep working for whoever is already on one.
        </p>
      </aside>
    </div>
  );
}
