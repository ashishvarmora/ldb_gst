"use client";

import { useState } from "react";

import { recordOfflinePayment } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, Select } from "@/components/form";
import { OFFLINE_METHODS } from "@/lib/analytics";

export type PayableCustomer = { id: string; label: string };
export type SellablePlan = {
  id: string;
  name: string;
  price: number;
  credits: number;
  /** "3 months", "7 days", "No expiry" - already worded by planTermLabel(). */
  term: string;
};

/**
 * Writing down money that arrived off the gateway.
 *
 * Client-side only so far as the form needs to change shape: choosing "a plan"
 * and choosing "credits" ask for different things, and showing both sets of
 * boxes at once is how somebody ends up entering a credit count against a plan
 * sale. Everything that matters is re-checked in the Server Action, which is
 * the only thing that can actually move money.
 *
 * The plan select carries its price and included credits, so picking a plan
 * fills the amount in. It stays editable: a plan sold at a negotiated price is
 * common, and a form that will not let you type the number you were actually
 * paid is a form people work around by not using it.
 */
export function RecordPaymentForm({
  customers,
  plans,
  today,
}: {
  customers: PayableCustomer[];
  plans: SellablePlan[];
  /** Today in IST, from the server - the browser's clock may be anywhere. */
  today: string;
}) {
  const [kind, setKind] = useState<"credits" | "plan">("credits");
  const [amount, setAmount] = useState("");
  const [planId, setPlanId] = useState("");

  const chosen = plans.find((plan) => plan.id === planId) ?? null;

  function onPlanChange(id: string) {
    setPlanId(id);
    const plan = plans.find((p) => p.id === id);
    if (plan && plan.price > 0) setAmount(String(plan.price));
  }

  return (
    <ActionForm action={recordOfflinePayment} className="space-y-4">
      <Field
        label="Customer"
        name="user_id"
        required
        hint="Whose account the credits or plan should land on."
      >
        <Select name="user_id" required defaultValue="">
          <option value="" disabled>
            Choose a customer
          </option>
          {customers.map((customer) => (
            <option key={customer.id} value={customer.id}>
              {customer.label}
            </option>
          ))}
        </Select>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="How it arrived" name="method" required>
          <Select name="method" required defaultValue="cash">
            {OFFLINE_METHODS.map((method) => (
              <option key={method.key} value={method.key}>
                {method.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Amount received"
          name="amount_inr"
          required
          hint="In rupees, exactly what came in."
        >
          <Input
            name="amount_inr"
            inputMode="decimal"
            required
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="5000"
            className="tabular-nums"
          />
        </Field>
      </div>

      <Field label="What it paid for" name="kind" required>
        <Select
          name="kind"
          required
          value={kind}
          onChange={(event) => setKind(event.target.value === "plan" ? "plan" : "credits")}
        >
          <option value="credits">Credits</option>
          <option value="plan">A plan</option>
        </Select>
      </Field>

      {kind === "plan" ? (
        <>
          {/*
            The "Months" box that sat beside this has gone.
            It posted a multiplier that pricePlan() charged price_per_month by,
            and settle_payment() has taken the length of access off the plan row
            since 0038 - so typing 12 into it charged twelve times and granted
            ninety days. Nothing multiplies since 0042, so the box could only
            ever have been wrong; the plan's own term is shown instead, which is
            the only thing that number was ever standing in for.
          */}
          <Field
            label="Plan"
            name="plan_id"
            required
            hint={
              chosen
                ? `Runs for ${chosen.term.toLowerCase()} from the date received above. Its included credits are granted automatically.`
                : "Its included credits are granted automatically, and its own term decides when access ends."
            }
          >
            <Select
              name="plan_id"
              required
              value={planId}
              onChange={(event) => onPlanChange(event.target.value)}
            >
              <option value="" disabled>
                Choose a plan
              </option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </Select>
          </Field>
          {/* The offline twin of the portal's combined checkout: one receipt,
              plan plus a credit top-up, so a cash customer's first payment can
              carry both - and the referral pays on the whole of it. */}
          <Field
            label="Credits sold on top"
            name="credits"
            hint="Optional. Leave empty for a plan-only sale; the amount above stays the full sum received."
          >
            <Input name="credits" inputMode="decimal" placeholder="0" className="tabular-nums" />
          </Field>
        </>
      ) : (
        <Field
          label="Credits bought"
          name="credits"
          required
          hint="What this money buys. Nothing works this out for you — an offline sale has no pack behind it."
        >
          <Input
            name="credits"
            inputMode="decimal"
            required
            placeholder="500"
            className="tabular-nums"
          />
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Date received"
          name="paid_on"
          hint="Leave blank for today. A cheque that cleared last week belongs in last week."
        >
          <Input name="paid_on" type="date" max={today} defaultValue={today} />
        </Field>
        <Field label="Note" name="note" hint="A cheque number, or who handed it over.">
          <Input name="note" placeholder="Cheque 004312" />
        </Field>
      </div>

      <FormActions>
        <SubmitButton pendingLabel="Recording...">Record payment</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
