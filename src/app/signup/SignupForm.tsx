"use client";

import { Gift } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input } from "@/components/form";
import { PhoneField } from "@/components/PhoneInput";
import { signUp } from "./actions";

export function SignupForm({
  /**
   * The code from ?ref=, carried through the form so the action can resolve it
   * against the database rather than trusting whatever the page decided. It
   * rides along even when nothing was acknowledged above: the action ignores a
   * code that matches nobody, and never lets one fail a registration.
   */
  referralCode,
  /** "You were invited by ...", already composed. Absent when there is nobody. */
  inviteNote,
}: {
  referralCode?: string | null;
  inviteNote?: string | null;
}) {
  return (
    <ActionForm action={signUp} className="space-y-4" closeOnSuccess={false}>
      {inviteNote ? (
        <p className="flex items-start gap-2 rounded-lg border border-brand-500/40 bg-brand-500/10 px-3 py-2 text-sm leading-relaxed text-brand-500">
          <Gift size={15} className="mt-0.5 shrink-0" />
          <span>{inviteNote}</span>
        </p>
      ) : null}

      {referralCode ? <input type="hidden" name="ref" value={referralCode} /> : null}

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

      <PhoneField hint="We use this if something goes wrong with your account. 10 digits." />

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
