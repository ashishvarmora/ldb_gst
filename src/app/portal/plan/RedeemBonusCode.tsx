"use client";

import { Gift } from "lucide-react";

import { redeemBonusCode } from "./checkout-actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/form";
import { Panel } from "@/components/ui";

/**
 * A code that is worth credits, entered on its own.
 *
 * Separate from the discount box on the payment screen, because the two do
 * different things and putting them together taught people the wrong thing: a
 * discount needs something to discount and only makes sense mid-purchase,
 * whereas this needs nothing but the code. The server tells anyone who confuses
 * them which screen they want, rather than calling their code invalid.
 *
 * Deliberately quiet - one row, no illustration. Most visits to this page are
 * not redeeming anything, and a promotional block would be in the way of the
 * top-up that most people came for.
 */
export function RedeemBonusCode({ className }: { className?: string }) {
  return (
    <Panel
      className={className}
      title="Have a credit code?"
      description="Codes that are worth credits go here. A discount code goes on the payment screen instead."
    >
      <ActionForm action={redeemBonusCode} closeOnSuccess={false}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            name="code"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="WELCOME500"
            aria-label="Credit code"
            className="font-mono placeholder:font-sans placeholder:tracking-normal placeholder:normal-case sm:flex-1"
          />
          <SubmitButton variant="secondary" pendingLabel="Checking...">
            <Gift size={14} />
            Redeem
          </SubmitButton>
        </div>
      </ActionForm>
    </Panel>
  );
}
