"use client";

import { Gift } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input } from "@/components/form";
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

      {/*
        The +91 is furniture, not a field. Every officer here is on an Indian
        number, so asking for a country code is a box that can only be typed
        wrong - and a number typed with one anyway ("+91 98765 43210") still
        normalises cleanly on the server, so pasting is safe.

        type="tel" rather than "number": a number spinner on a phone number is
        nonsense, and inputMode="numeric" already brings up the digit keypad.
      */}
      <Field
        label="Mobile number"
        name="phone"
        hint="We use this if something goes wrong with your account. 10 digits."
        required
      >
        <div className="flex">
          <span
            aria-hidden
            className="inline-flex shrink-0 items-center rounded-l-lg border border-r-0 border-line bg-raised px-3 font-mono text-sm text-muted"
          >
            +91
          </span>
          <Input
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            required
            maxLength={10}
            pattern="[6-9][0-9]{9}"
            placeholder="9876543210"
            aria-describedby="phone-country"
            className="rounded-l-none font-mono tracking-wider placeholder:font-sans placeholder:tracking-normal"
          />
        </div>
        <span id="phone-country" className="sr-only">
          Indian mobile number, country code plus 91
        </span>
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
