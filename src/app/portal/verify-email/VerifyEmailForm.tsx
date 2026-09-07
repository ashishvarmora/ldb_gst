"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";

import { checkEmailCode, sendEmailCode } from "./actions";
import { Input } from "@/components/form";
import { buttonClass, cx } from "@/components/ui";
import type { ActionResult } from "@/lib/types";

/**
 * Send a code, then type it back.
 *
 * Two actions on one screen, and they must not share a result slot: "Code sent"
 * and "That code is not right" answer different questions, and showing the
 * second in place of the first loses the only confirmation that the email is on
 * its way.
 *
 * The countdown is the whole reason this is a Client Component. The database
 * throttles a resend to one a minute, and a button that simply fails with "try
 * again in 47 seconds" invites the reader to keep pressing it. Disabling it and
 * naming the wait says the same thing without the failure.
 */
export function VerifyEmailForm() {
  const router = useRouter();

  const [sendState, setSendState] = useState<ActionResult | null>(null);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [checkState, checkAction] = useActionState<ActionResult | null, FormData>(
    checkEmailCode,
    null,
  );

  /* Verified is a server fact - the page above reads it - so the screen has to
     be re-fetched rather than patched here. */
  useEffect(() => {
    if (checkState?.ok) router.refresh();
  }, [checkState, router]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function onSend() {
    setSending(true);
    const result = await sendEmailCode();
    setSendState(result);
    setSending(false);
    /* Sixty seconds whether it succeeded or not: a send that failed after the
       code was issued is still throttled in the database, so pretending
       otherwise would produce a second, more confusing failure. */
    setCooldown(60);
  }

  return (
    <div className="space-y-4">
      <div>
        <button
          type="button"
          onClick={onSend}
          disabled={sending || cooldown > 0}
          className={cx(buttonClass("secondary", "md"), "disabled:opacity-60")}
        >
          {sending ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <Send size={15} aria-hidden />
          )}
          {cooldown > 0 ? `Send again in ${cooldown}s` : sending ? "Sending..." : "Email me a code"}
        </button>

        {sendState ? (
          <p
            role="status"
            className={cx(
              "mt-2 text-xs leading-relaxed",
              sendState.ok ? "text-good-500" : "text-bad-500",
            )}
          >
            {sendState.ok ? sendState.message : sendState.error}
          </p>
        ) : null}
      </div>

      <form action={checkAction} className="space-y-2 border-t border-divider pt-4">
        <label htmlFor="code" className="field-label">
          Six-digit code
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <Input
            id="code"
            name="code"
            /* inputMode numeric and autoComplete one-time-code: on a phone this
               brings up the digit pad and lets the keyboard offer the code
               straight from the notification, which is the difference between
               typing it and tapping it. */
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            pattern="[0-9]{6}"
            placeholder="123456"
            className="w-32 font-mono text-base tracking-[0.35em] placeholder:tracking-normal"
          />
          <SubmitCode />
        </div>

        {checkState ? (
          <p
            role="status"
            className={cx(
              "text-xs leading-relaxed",
              checkState.ok ? "text-good-500" : "text-bad-500",
            )}
          >
            {checkState.ok ? checkState.message : checkState.error}
          </p>
        ) : null}
      </form>
    </div>
  );
}

function SubmitCode() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={buttonClass("primary", "md")}>
      {pending ? <Loader2 size={15} className="animate-spin" /> : null}
      {pending ? "Checking..." : "Verify"}
    </button>
  );
}
