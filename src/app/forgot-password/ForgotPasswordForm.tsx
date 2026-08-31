"use client";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input } from "@/components/form";
import { requestPasswordReset } from "./actions";

export function ForgotPasswordForm() {
  return (
    <ActionForm
      action={requestPasswordReset}
      className="space-y-4"
      closeOnSuccess={false}
      resetOnSuccess
    >
      <Field
        label="Email"
        name="email"
        hint="Use the address you signed up with."
      >
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          placeholder="you@company.com"
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Sending...">
        Send reset link
      </SubmitButton>
    </ActionForm>
  );
}
