"use client";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input } from "@/components/form";
import { signUp } from "./actions";

export function SignupForm() {
  return (
    <ActionForm action={signUp} className="space-y-4" closeOnSuccess={false}>
      <Field label="Full name" name="full_name">
        <Input
          name="full_name"
          type="text"
          autoComplete="name"
          required
          autoFocus
          placeholder="Your full name"
        />
      </Field>

      <Field label="Email" name="email">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@company.com"
        />
      </Field>

      <Field label="Password" name="password">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="At least 8 characters"
        />
      </Field>

      <Field label="Confirm password" name="confirm_password">
        <Input
          name="confirm_password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Type it once more"
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Creating your account...">
        Create account
      </SubmitButton>
    </ActionForm>
  );
}
