import { Plus } from "lucide-react";

import { grantOfficerCredits } from "./actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, FormGrid, Input, Select } from "@/components/form";
import { CREDIT_REASON_LABEL } from "@/lib/credits";

/** Reasons an admin picks by hand. The rest are written by the platform. */
const REASONS = ["admin_topup", "purchase", "admin_adjust"] as const;

/**
 * Top up one officer. Also the way a mistake is taken back out - a negative
 * amount is allowed, and the balance is clamped at zero by the database.
 *
 * `pricePerCredit` is only for the hint: there is no single price any more, so
 * the caller passes whatever rate it wants to quote - normally the entry credit
 * pack's rupees per credit - or nothing at all.
 */
export function GrantCreditsForm({
  userId,
  pricePerCredit,
}: {
  userId: string;
  pricePerCredit?: number;
}) {
  return (
    <ActionForm action={grantOfficerCredits} closeOnSuccess={false} resetOnSuccess>
      <input type="hidden" name="user_id" value={userId} />

      <div className="space-y-4">
        <FormGrid cols={2}>
          <Field
            label="Credits"
            name="amount"
            hint={
              pricePerCredit
                ? `At Rs ${pricePerCredit} a credit. Use a minus sign to take some back.`
                : "Use a minus sign to take some back."
            }
          >
            <Input
              name="amount"
              type="number"
              required
              step="0.01"
              placeholder="100"
              autoComplete="off"
            />
          </Field>

          <Field label="Reason" name="reason" hint="Shows in the officer's credit history.">
            <Select name="reason" defaultValue="admin_topup">
              {REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {CREDIT_REASON_LABEL[reason] ?? reason}
                </option>
              ))}
            </Select>
          </Field>
        </FormGrid>

        <Field
          label="Note"
          name="note"
          hint="Optional. e.g. 'Rs 1,000 collected in cash, receipt 214.'"
        >
          <Input name="note" placeholder="What was collected, and how" autoComplete="off" />
        </Field>
      </div>

      <FormActions>
        <SubmitButton pendingLabel="Adding...">
          <Plus size={14} />
          Add credits
        </SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
