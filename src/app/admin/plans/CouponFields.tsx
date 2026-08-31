"use client";

import { useState } from "react";
import { Calculator } from "lucide-react";

import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/form";
import type { Coupon, CouponKind } from "@/lib/types";

/**
 * Every field of a coupon, plus the sum an admin would otherwise do in their
 * head.
 *
 * A percentage with a ceiling and a minimum spend is three rules interfering
 * with each other, and none of them is visible in the boxes: "20%, up to 200,
 * over 1,000" reads fine and then takes 200 off a 5,000 order rather than the
 * 1,000 the admin was picturing. So the form works the discount out at four
 * order values as it is typed. That block is the point of this screen.
 *
 * Shared by the create and the edit form so the two cannot drift apart, and a
 * Client Component only for the example - nothing here reads or writes
 * anything.
 */

/** Two decimal places, the way round(x, 2) does it inside validate_coupon. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** "₹1,000". Matches describeCoupon, which is the same sentence stored. */
function inr(value: number): string {
  return `₹${round2(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** A positive number out of a box, or 0 when the box is empty or nonsense. */
function num(raw: string): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * The stored instant as the day it was typed as.
 *
 * The window is set in IST and read back here in the reader's own browser, so
 * without pinning the zone the last second of the 30th shows up as the 30th in
 * Delhi and the 30th at 11:29am in Los Angeles - and one time zone west of that
 * it would show the 29th.
 */
function dayInIst(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // en-CA is the locale that spells a date YYYY-MM-DD, which is what a date
  // input wants.
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/** What the boxes currently say, in the only four values that change the sum. */
type Draft = { kind: CouponKind; value: string; cap: string; minSpend: string };

/** The same four, as numbers, with blank meaning what the column means by null. */
type Rule = { kind: CouponKind; value: number; cap: number | null; minSpend: number };

type Outcome = {
  amount: number;
  /** What the rule gives before the ceiling and the one-rupee floor. */
  full: number;
  discount: number;
  payable: number;
  /** Why the discount is not simply the full amount. */
  note: null | "below_min" | "capped" | "floored";
};

/**
 * What this code would take off one order.
 *
 * A deliberate mirror of validate_coupon(), including the two rules that catch
 * people out: the ceiling beats the percentage, and a discount never leaves
 * less than a rupee to pay because a zero-rupee order cannot be charged. It
 * reads nothing and decides nothing - the database still has the only vote at
 * checkout - so a disagreement here is a wrong label, never a wrong price.
 */
function outcomeAt(rule: Rule, amount: number): Outcome {
  const full = rule.kind === "flat" ? rule.value : round2((amount * rule.value) / 100);

  if (amount < rule.minSpend) {
    return { amount, full, discount: 0, payable: amount, note: "below_min" };
  }

  const capped = rule.kind === "percent" && rule.cap !== null ? Math.min(full, rule.cap) : full;
  const discount = Math.min(capped, Math.max(amount - 1, 0));

  return {
    amount,
    full,
    discount,
    payable: round2(amount - discount),
    note: discount < capped ? "floored" : capped < full ? "capped" : null,
  };
}

/**
 * Order values worth costing the code out at.
 *
 * Written against the coupon's own minimum rather than fixed, so both
 * boundaries that surprise people are on screen at once: one order under the
 * minimum, where the code does nothing at all, and orders far enough above it
 * that a ceiling starts deciding the answer instead of the percentage.
 */
function exampleAmounts(minSpend: number): number[] {
  if (minSpend > 0) {
    const under = Math.max(1, Math.round(minSpend / 2));
    return [...new Set([under, minSpend, minSpend * 2, minSpend * 5].map(Math.round))];
  }
  return [500, 1_000, 5_000, 10_000];
}

export function CouponFields({ coupon }: { coupon?: Coupon }) {
  const [draft, setDraft] = useState<Draft>({
    kind: coupon?.kind ?? "percent",
    value: coupon ? String(coupon.value) : "",
    cap: coupon?.max_discount_inr ? String(coupon.max_discount_inr) : "",
    minSpend: coupon && coupon.min_spend_inr > 0 ? String(coupon.min_spend_inr) : "",
  });

  const edit = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const percent = draft.kind === "percent";

  return (
    <div className="space-y-5">
      <FormGrid cols={2}>
        <Field
          label="Code"
          name="code"
          hint="What the customer types. Stored upper case, so SAVE20 and save20 are one code."
        >
          <Input
            name="code"
            required
            maxLength={40}
            defaultValue={coupon?.code ?? ""}
            placeholder="SAVE20"
            autoComplete="off"
            className="uppercase"
          />
        </Field>

        <Field
          label="Applies to"
          name="applies_to"
          hint="A code for credits will be refused on a plan, and the other way round."
        >
          <Select name="applies_to" defaultValue={coupon?.applies_to ?? "all"}>
            <option value="all">Anything for sale</option>
            <option value="credits">Credit top-ups only</option>
            <option value="plan">Plans only</option>
          </Select>
        </Field>
      </FormGrid>

      <Field
        label="What it is for"
        name="description"
        hint="Your own note. Customers never see a list of codes, so this is for whoever reads this page next."
      >
        <Textarea
          name="description"
          rows={2}
          defaultValue={coupon?.description ?? ""}
          placeholder="Diwali offer, sent to the trucking WhatsApp groups."
        />
      </Field>

      <fieldset>
        <legend className="field-label">What comes off</legend>

        <FormGrid cols={2}>
          <Field label="Kind of discount" name="kind">
            <Select
              name="kind"
              value={draft.kind}
              onChange={(e) => edit({ kind: e.target.value === "flat" ? "flat" : "percent" })}
            >
              <option value="percent">A percentage of the order</option>
              <option value="flat">A fixed number of rupees</option>
            </Select>
          </Field>

          <Field
            label={percent ? "Percent off (%)" : "Rupees off (Rs)"}
            name="value"
            hint={
              percent
                ? "Of the order value, before the discount. 100 would make it free, so it is the most allowed."
                : "The same amount off every order it applies to."
            }
          >
            <Input
              name="value"
              type="number"
              required
              min={0.01}
              max={percent ? 100 : undefined}
              step="any"
              value={draft.value}
              onChange={(e) => edit({ value: e.target.value })}
              placeholder={percent ? "20" : "200"}
            />
          </Field>
        </FormGrid>

        <FormGrid cols={2} className="mt-4">
          {/* Only a percentage has an "up to". Disabled rather than hidden on a
              flat code, because the box vanishing is read as a bug, and a
              disabled input posts nothing - so the column lands on null, which
              is what "no ceiling" is stored as. */}
          <Field
            label="Up to (Rs)"
            name="max_discount_inr"
            hint={
              percent
                ? "The ceiling on the percentage. Blank means none — and 20% of a large order is a large discount."
                : "Only a percentage needs a ceiling. A fixed number of rupees already is one."
            }
          >
            <Input
              name="max_discount_inr"
              type="number"
              min={0.01}
              step="any"
              disabled={!percent}
              value={percent ? draft.cap : ""}
              onChange={(e) => edit({ cap: e.target.value })}
              placeholder={percent ? "200" : "Not used on a flat discount"}
            />
          </Field>

          <Field
            label="Minimum spend (Rs)"
            name="min_spend_inr"
            hint="Under this the code does nothing at all. Blank or 0 works on any order."
          >
            <Input
              name="min_spend_inr"
              type="number"
              min={0}
              step="any"
              value={draft.minSpend}
              onChange={(e) => edit({ minSpend: e.target.value })}
              placeholder="0"
            />
          </Field>
        </FormGrid>
      </fieldset>

      <WorkedExample draft={draft} />

      <fieldset>
        <legend className="field-label">How many times it can be used</legend>

        <FormGrid cols={2}>
          <Field
            label="Total claims"
            name="max_claims"
            hint="Across everyone. Blank means no limit."
          >
            <Input
              name="max_claims"
              type="number"
              min={1}
              step="1"
              defaultValue={coupon?.max_claims ?? ""}
              placeholder="No limit"
            />
          </Field>

          <Field
            label="Uses per person"
            name="max_per_user"
            hint="One is the usual answer: a code someone can use twice is a code they can use twice."
          >
            <Input
              name="max_per_user"
              type="number"
              required
              min={1}
              step="1"
              defaultValue={coupon?.max_per_user ?? 1}
            />
          </Field>
        </FormGrid>

        <p className="field-hint">
          A claim is counted from the moment a checkout opens, not from the moment it is paid —
          otherwise two people could spend the last use of a single-use code at the same instant. A
          claim nobody pays for is handed back after 30 minutes.
        </p>
      </fieldset>

      <fieldset>
        <legend className="field-label">When it works</legend>

        <FormGrid cols={2}>
          <Field label="First day" name="starts_on" hint="Blank starts it straight away.">
            <Input name="starts_on" type="date" defaultValue={dayInIst(coupon?.starts_at)} />
          </Field>
          <Field
            label="Last day"
            name="expires_on"
            hint="Works to the end of this day, IST. Blank never expires."
          >
            <Input name="expires_on" type="date" defaultValue={dayInIst(coupon?.expires_at)} />
          </Field>
        </FormGrid>
      </fieldset>

      <Checkbox
        name="is_active"
        label="Switched on"
        hint="Off keeps the code and everything it has already given, but nobody can use it."
        defaultChecked={coupon?.is_active ?? true}
      />
    </div>
  );
}

/**
 * The discount, worked out, as the admin types.
 *
 * The headline sentence is the whole of what the code does to one order. The
 * four lines under it are there because the interesting part of a capped
 * percentage is where it stops being a percentage, and that is only visible
 * across several order values.
 */
function WorkedExample({ draft }: { draft: Draft }) {
  const value = num(draft.value);
  const minSpend = Math.max(0, num(draft.minSpend));
  const percent = draft.kind === "percent";

  const capped = Number(draft.cap);
  const rule: Rule = {
    kind: draft.kind,
    value,
    cap: percent && draft.cap.trim() !== "" && Number.isFinite(capped) && capped > 0 ? capped : null,
    minSpend,
  };

  if (percent && value > 100) {
    // The same sentence the Server Action would refuse it with, so the form and
    // the save never disagree about why.
    return (
      <p className="rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-sm text-warn-500">
        A percentage over 100 would pay the buyer to shop. Keep it at 100 or less.
      </p>
    );
  }

  if (value <= 0) {
    return (
      <p className="rounded-lg border border-line/70 bg-panel/50 px-3 py-2.5 text-sm text-muted">
        Fill in how much comes off, and what that does to a real order appears here.
      </p>
    );
  }

  // At the minimum spend, because that is the smallest order the code works on
  // and therefore the one where a percentage is worth least. With no minimum,
  // a round thousand.
  const headline = outcomeAt(rule, minSpend > 0 ? minSpend : 1_000);

  return (
    <div className="space-y-2">
      <p className="rounded-lg border border-brand-500/35 bg-brand-500/8 px-3 py-2.5 text-sm text-ink">
        <span className="font-medium">
          On a {inr(headline.amount)} order this takes off {inr(headline.discount)}, so they pay{" "}
          {inr(headline.payable)}.
        </span>
        <span className="mt-0.5 block text-xs text-muted">{reading(rule, headline)}</span>
      </p>

      <div className="rounded-lg border border-line/70 bg-panel/50 px-3 py-2.5">
        <p className="flex items-center gap-1.5 text-xs font-medium text-ink">
          <Calculator size={13} className="shrink-0 text-brand-500" />
          The same code at other order values
        </p>
        <ul className="mt-2 space-y-1">
          {exampleAmounts(minSpend).map((amount) => {
            const outcome = outcomeAt(rule, amount);
            return (
              <li
                key={amount}
                className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs"
              >
                <span className="text-muted">On {inr(amount)}</span>
                {outcome.discount <= 0 ? (
                  <span className="text-faint">
                    nothing comes off
                    {outcome.note === "below_min" ? ` · under the ${inr(minSpend)} minimum` : ""}
                  </span>
                ) : (
                  <span className="tabular-nums">
                    <span className="font-medium text-brand-500">
                      -{inr(outcome.discount)}
                    </span>{" "}
                    <span className="text-muted">so they pay {inr(outcome.payable)}</span>
                    {outcome.note === "capped" ? (
                      <span className="text-faint"> · at the ceiling</span>
                    ) : null}
                    {outcome.note === "floored" ? (
                      <span className="text-faint"> · all but a rupee</span>
                    ) : null}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

/**
 * The headline sum said again in words, naming whichever rule decided it.
 *
 * The line that earns its place is the last one: a ceiling on a percentage is
 * really a boundary between two different discounts, and the order value where
 * that boundary sits is the number an admin is trying to picture and cannot.
 */
function reading(rule: Rule, outcome: Outcome): string {
  if (rule.kind === "flat") {
    return `A flat ${inr(rule.value)} off, whatever the order is worth${
      rule.minSpend > 0 ? `, on anything from ${inr(rule.minSpend)} up` : ""
    }.`;
  }

  if (outcome.note === "floored") {
    return "That is everything but a rupee: an order has to be worth something to be charged at all, so the discount stops one rupee short.";
  }

  if (rule.cap === null) {
    return `${rule.value}% of ${inr(outcome.amount)}, with no ceiling — the bigger the order, the bigger the discount.`;
  }

  if (outcome.full > rule.cap) {
    return `${rule.value}% of ${inr(outcome.amount)} would be ${inr(outcome.full)}, so the ${inr(rule.cap)} ceiling is what decides it.`;
  }

  // Where the percentage stops mattering: the order value whose percentage is
  // exactly the ceiling. Above it every order gets the same rupees off.
  const bites = (rule.cap * 100) / rule.value;
  return outcome.full === rule.cap
    ? `${rule.value}% of ${inr(outcome.amount)} is exactly the ${inr(rule.cap)} ceiling, so every larger order gets the same ${inr(rule.cap)} off.`
    : `${rule.value}% of ${inr(outcome.amount)}, under the ${inr(rule.cap)} ceiling — which takes over above ${inr(bites)} and holds every order to ${inr(rule.cap)} off.`;
}
