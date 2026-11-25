"use client";

import { useState } from "react";

import { Select } from "@/components/form";
import { Switch } from "@/components/ui";
import { formatCredits } from "@/lib/credits";

import { WHATSAPP_AMOUNTS } from "./whatsapp-amounts";

/**
 * The on/off switch and, under it, the amount. One form, one Save: the switch
 * only decides whether the amount is shown and posted. While it is off the
 * amount is not posted at all, so the stored rate is left as it was and comes
 * back unchanged when charging is switched on again.
 */
export function WhatsAppChargeFields({
  enabled,
  amount,
}: {
  enabled: boolean;
  /** Credits per message now in force, or null before migration 0076. */
  amount: number | null;
}) {
  const [on, setOn] = useState(enabled);
  const current = amount ?? 0.2;
  // A rate set some other way before this list existed still shows as itself.
  const options: number[] = (WHATSAPP_AMOUNTS as readonly number[]).includes(current)
    ? [...WHATSAPP_AMOUNTS]
    : [...WHATSAPP_AMOUNTS, current].sort((a, b) => a - b);

  return (
    <div>
      <input type="hidden" name="whatsapp_charge_enabled" value={on ? "true" : "false"} />

      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p id="wa-charge-label" className="text-sm font-medium text-ink">
            Charge credits for WhatsApp alerts
          </p>
          <p className="mt-0.5 text-xs text-muted">
            {on
              ? "On. Each WhatsApp alert a customer receives uses credits."
              : "Off. WhatsApp alerts are free for customers."}
          </p>
        </div>
        <Switch
          checked={on}
          onChange={() => setOn((value) => !value)}
          label="Charge credits for WhatsApp alerts"
        />
      </div>

      {on ? (
        <div className="mt-4 ml-1 border-l-2 border-line pl-4">
          <label htmlFor="whatsapp_amount" className="block text-sm font-medium text-ink">
            Credits per WhatsApp message
          </label>
          <Select
            id="whatsapp_amount"
            name="whatsapp_amount"
            defaultValue={String(current)}
            className="mt-1.5 max-w-40"
          >
            {options.map((value) => (
              <option key={value} value={String(value)}>
                {formatCredits(value)} credit
              </option>
            ))}
          </Select>
          <p className="mt-1.5 text-xs leading-relaxed text-muted">
            Charged only after WhatsApp accepts the message. Never charged: the customer&rsquo;s test
            message, the admin daily summary and the &lsquo;no credits left&rsquo; notice.
          </p>
        </div>
      ) : null}
    </div>
  );
}
