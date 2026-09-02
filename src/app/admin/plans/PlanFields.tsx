"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { PlanPreview } from "./PlanPreview";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/form";
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
 * The four terms a plan may be sold for, and "off" for no expiry.
 *
 * Not a free number box, and this is the reason: the checkout charges
 * price_per_month x the term, and it only knows how to price these four - see
 * ALLOWED_MONTHS in checkout-actions.ts, which a check constraint on the column
 * mirrors. A typed 24 would be charged as one month and granted as two years.
 */
const TERMS = [
  { value: "", label: "Off - no expiry" },
  { value: "1", label: "1 month" },
  { value: "3", label: "3 months" },
  { value: "6", label: "6 months" },
  { value: "12", label: "12 months" },
] as const;

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
  const isTrial = plan?.is_trial ?? false;

  const [draft, setDraft] = useState({
    name: plan?.name ?? "",
    description: plan?.description ?? "",
    price: String(plan?.price_per_month ?? 0),
    credits: String(plan?.included_credits ?? 0),
    /*
     * A new plan opens on twelve months rather than on "off".
     *
     * The default has to be a real term, because the alternative default is
     * selling access for ever by omission - and that is exactly the mistake
     * this field exists to stop. An admin who genuinely wants no expiry has to
     * choose it.
     */
    months: plan ? (plan.duration_months === null ? "" : String(plan.duration_months)) : "12",
    trialDays: String(plan?.trial_days ?? 7),
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
        {/* The trial is a plan row, so it is edited here like any other - but
            three of these fields do not apply to it and one of them (the price)
            is refused by a check constraint. Said once, at the top, rather than
            hedged on every field below. */}
        {isTrial ? (
          <p className="rounded-lg border border-brand-500/40 bg-brand-500/8 px-3 py-2.5 text-xs leading-relaxed text-muted">
            <span className="font-medium text-brand-400">This is the free trial.</span> It is always
            free and it is handed over by the portal rather than bought, so it has no price and no
            month term. What you set here is the offer: how many days it runs, how many credits it
            opens with, and how many trucks it allows.
          </p>
        ) : null}

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
          {isTrial ? (
            <Field
              label="Trial length (days)"
              name="trial_days"
              hint="It ends by itself on that day - the end date is stored on the account and plan_active is computed from it, so nothing has to run."
            >
              <Input
                name="trial_days"
                type="number"
                required
                min={1}
                max={90}
                step="1"
                value={draft.trialDays}
                onChange={(e) => edit({ trialDays: e.target.value })}
              />
            </Field>
          ) : (
            <Field
              label="Price per month (Rs)"
              name="price_per_month"
              hint="A unit price, not the bill. The customer is charged this times the term below."
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
          )}
        </FormGrid>

        {isTrial ? null : (
          <Field
            label="This plan lasts"
            name="duration_months"
            hint="Buying it ends this long after the purchase date. Off means it never expires - one payment, for ever."
          >
            <Select
              name="duration_months"
              value={draft.months}
              onChange={(e) => edit({ months: e.target.value })}
              className="max-w-56"
            >
              {TERMS.map((term) => (
                <option key={term.value} value={term.value}>
                  {term.label}
                </option>
              ))}
            </Select>
          </Field>
        )}

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
          pricePerMonth={isTrial ? 0 : amount(draft.price)}
          /* Blank reads as no expiry, which is what the column stores. */
          durationMonths={isTrial || draft.months === "" ? null : amount(draft.months)}
          includedCredits={amount(draft.credits)}
          truckLimit={truckLimit ?? 0}
          isActive={plan?.is_active ?? true}
          isTrial={isTrial}
          trialDays={isTrial ? amount(draft.trialDays) : null}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          This is what a customer sees before they pay. Archived plans are hidden from that page but
          keep working for whoever is already on one.
        </p>
      </aside>
    </div>
  );
}
