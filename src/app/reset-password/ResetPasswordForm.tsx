"use client";

import { useActionState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { useFormStatus } from "react-dom";

import { setNewPassword } from "./actions";
import { Field, Input } from "@/components/form";
import { LinkButton, buttonClass } from "@/components/ui";
import type { ActionResult } from "@/lib/types";

/**
 * Two password boxes and a button. That is the whole component now.
 *
 * WHAT IT USED TO DO, AND WHY IT STOPPED.
 *
 * There was a "checking" stage: on mount it read the URL fragment, called
 * setSession() against Supabase, waited for the reply and only then put the form
 * on screen. So the reader watched "Checking your link..." for as long as the
 * bundle took to download plus a round trip - and the bundle was the largest on
 * the site, because importing the Supabase browser client pulls in about 120 kB
 * before any of it is needed. That spinner was the owner's complaint, and there
 * was nothing to do behind it that could not wait until they pressed the button.
 *
 * So the link is now opened by /auth/recover, the token is spent by the Server
 * Action, and this file imports no Supabase client at all. The form is in the
 * HTML of the first response: on screen before hydration, and typeable as soon
 * as it is painted.
 *
 * `link_expired` as an error string is a sentinel rather than a message. It is
 * the one failure that is not about what the reader typed, so it replaces the
 * form instead of appearing under it - there is no point leaving two password
 * boxes on screen when nothing that goes in them can be saved.
 */

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", "md", "w-full")}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : null}
      {pending ? "Saving..." : "Save new password"}
    </button>
  );
}

function NeedsNewLink({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <p className="flex items-start gap-2 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
        <AlertCircle size={15} className="mt-0.5 shrink-0" />
        <span>{children}</span>
      </p>
      <LinkButton href="/forgot-password" variant="primary" className="w-full">
        Send me a new link
      </LinkButton>
    </div>
  );
}

export function ResetPasswordForm({
  hasToken,
  linkBroken,
}: {
  /** The server found a recovery token for this browser. Decided before render,
      so there is no client-side check and no spinner. */
  hasToken: boolean;
  /** The address in the email was mangled in transit - a different problem from
      an expired one, and worth saying so, because requesting another link will
      not help if the mail client keeps breaking it. */
  linkBroken: boolean;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    setNewPassword,
    null,
  );

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg border border-good-500/40 bg-good-500/10 px-3 py-2 text-sm text-good-500">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
          <span>Your password has been changed, and you are signed in.</span>
        </p>
        <LinkButton href="/" variant="primary" className="w-full">
          Go to your dashboard
        </LinkButton>
      </div>
    );
  }

  if (linkBroken) {
    return (
      <NeedsNewLink>
        That link came through incomplete — some email apps cut long links short.
        Request another and open it by tapping the button in the email rather than
        copying the address.
      </NeedsNewLink>
    );
  }

  if (!hasToken || state?.error === "link_expired") {
    return (
      <NeedsNewLink>
        This link has expired or has already been used. Reset links last an hour
        and work once — if yours is newer than that, open it again from the email.
      </NeedsNewLink>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <Field label="New password" name="password">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={8}
          placeholder="At least 8 characters"
        />
      </Field>

      <Field label="Confirm new password" name="confirm">
        <Input
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          placeholder="Type it once more"
        />
      </Field>

      {state && !state.ok ? (
        <p className="flex items-start gap-2 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{state.error}</span>
        </p>
      ) : null}

      <SaveButton />

      <p className="text-center text-xs text-muted">
        <Link href="/login" className="hover:text-brand-500">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
