"use client";

import { useState } from "react";
import { Eye } from "lucide-react";

import { PlanPreview } from "./PlanPreview";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/form";
import { planExpiryNote, planTermLabel } from "@/lib/credits";
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
 * The terms a plan may be sold for, IN DAYS, and "off" for no expiry.
 *
 * This picker used to set duration_months and never touched duration_days -
 * which is the column settle_payment() actually adds - so the editor for a
 * ninety-day plan sat there reading "1 month" and an admin who saved the form
 * left the real term untouched. Two columns for one fact, and the form only
 * wrote the wrong one.
 *
 * It writes days now, and the labels are computed from the days by the same
 * helper the customer's card uses, so the picker cannot disagree with either
 * the term or the wording anywhere else. Seven days is on the list because the
 * trial's length is seven and a paid week is a thing the owner has sold before.
 */
const TERM_DAYS = [7, 30, 90, 180, 365] as const;

/**
 * "1 month (30 days)" - the word the customer reads, and the number the column
 * stores, in one option. Both because the admin has to be able to reconcile
 * this picker with a duration_days they may have seen in the console, and
 * neither on its own does that.
 *
 * The gloss is dropped when the label is already a count of days, so a
 * seven-day term does not read "7 days (7 days)".
 */
function termLabel(days: number): string {
  const label = planTermLabel({ price_inr: 0, duration_days: days });
  return label.endsWith("days") || label.endsWith("day") ? label : `${label} (${days} days)`;
}

const TERMS = [
  { value: "", label: "Off — no expiry" },
  ...TERM_DAYS.map((days) => ({ value: String(days), label: termLabel(days) })),
];

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
    price: String(plan?.price_inr ?? 0),
    credits: String(plan?.included_credits ?? 0),
    /*
     * A new plan opens on ninety days rather than on "off".
     *
     * The default has to be a real term, because the alternative default is
     * selling access for ever by omission - and that is exactly the mistake
     * this field exists to stop. An admin who genuinely wants no expiry has to
     * choose it. Ninety rather than thirty because three of the four plans on
     * sale run for ninety, so it is the shape of a new one.
     *
     * A stored term that is not on the list - an admin edited the row in the
     * console - is kept as the selected value below rather than snapped to the
     * nearest option, so opening the form cannot silently change the term.
     */
    days: plan ? (plan.duration_days === null ? "" : String(plan.duration_days)) : "90",
    trialDays: String(plan?.trial_days ?? 7),
  });

  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      NUMERIC_LIMITS.map((field) => [field.key, plan ? limitValue(plan[field.key]) : ""]),
    ),
  );

  const edit = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));

  /** The chosen term in days, or null for no expiry. Blank is no expiry. */
  const termDays = draft.days === "" ? null : amount(draft.days) || null;

  /*
   * A stored term the list does not offer keeps its own option rather than
   * being dropped - a Select whose value is not among its options renders
   * blank, which would read as "no expiry" and save as one. Somebody who set
   * 45 days in the console gets to keep 45 days unless they choose otherwise.
   */
  const termOptions =
    termDays !== null && !TERM_DAYS.some((days) => days === termDays)
      ? [
          ...TERMS,
          { value: String(termDays), label: termLabel(termDays) },
        ]
      : TERMS;

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
            bought term. What you set here is the offer: how many days it runs, how many credits it
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
              label="Price (Rs)"
              name="price_inr"
              hint="The whole price of the plan, charged once. Not a monthly rate - nothing multiplies it by the term."
            >
              <Input
                name="price_inr"
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
            name="duration_days"
            hint={planExpiryNote({ price_inr: 0, duration_days: termDays })}
          >
            <Select
              name="duration_days"
              value={draft.days}
              onChange={(e) => edit({ days: e.target.value })}
              className="max-w-56"
            >
              {termOptions.map((term) => (
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
          priceInr={isTrial ? 0 : amount(draft.price)}
          /* Blank reads as no expiry, which is what the column stores. */
          durationDays={isTrial ? null : termDays}
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
