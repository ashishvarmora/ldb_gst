"use client";
import { PasswordInput } from "@/components/PasswordInput";

import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input } from "@/components/form";
import { signIn } from "./actions";

/**
 * The sign-in form.
 *
 * Deliberately holds no state of its own any more. It used to call
 * supabase.auth.signInWithPassword() from the browser and manage its own
 * pending and error flags; the sign-in now runs as a Server Action so that the
 * attempt can be counted and throttled, and ActionForm already draws the error
 * and the pending button exactly as this file used to.
 *
 * closeOnSuccess is off because there is no modal here, and a successful
 * sign-in redirects from the server rather than returning a result to show.
 */
export function LoginForm() {
  return (
    <ActionForm action={signIn} className="space-y-4" closeOnSuccess={false}>
      <Field label="Email" name="email">
        <Input
          name="email"
          type="email"
          autoCapitalize="none"
          spellCheck={false}
          autoComplete="email"
          required
          placeholder="you@company.com"
        />
      </Field>

      <div>
        <Field label="Password" name="password">
          <PasswordInput
            name="password"
            autoComplete="current-password"
            required
            placeholder="Your password"
          />
        </Field>
        <div className="mt-1.5 flex justify-end">
          <Link
            href="/forgot-password"
            className="inline-flex min-h-8 items-center rounded-lg px-1 text-xs font-medium text-brand-500 transition hover:text-brand-600"
          >
            Forgot your password?
          </Link>
        </div>
      </div>

      <SubmitButton className="w-full" pendingLabel="Signing in...">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
