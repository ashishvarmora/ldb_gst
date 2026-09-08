"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";

import { checkEmailCode, sendEmailCode, type SendCodeResult } from "./actions";
import { Input } from "@/components/form";
import { buttonClass, cx } from "@/components/ui";
import type { ActionResult } from "@/lib/types";

const CODE_LENGTH = 6;

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
 * naming the wait says the same thing without the failure - and the number now
 * comes from the server's own remaining wait rather than from an assumed sixty,
 * so a reload mid-throttle shows a real countdown instead of an enabled button
 * that has to be pressed to discover it is dead.
 */
export function VerifyEmailForm() {
  const router = useRouter();

  const [sendState, setSendState] = useState<SendCodeResult | null>(null);
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  /*
   * The field is controlled for one reason: whatever arrives has to end up as
   * six digits.
   *
   * A pasted code almost never arrives clean. Selecting it in a mail client
   * takes the spaces around it, and selecting the sentence takes the sentence -
   * "Your code is 481920" - which a plain input accepts and the form then
   * refuses as malformed, blaming the reader for a copy that contained exactly
   * the right number. Stripping non-digits on the way in makes every one of
   * those a valid paste, and truncating rather than rejecting means a keyboard
   * that offers the code from the notification cannot overshoot either.
   */
  const [code, setCode] = useState("");
  const complete = code.length === CODE_LENGTH;

  const [checkState, checkAction] = useActionState<ActionResult | null, FormData>(
    checkEmailCode,
    null,
  );

  /*
   * A fresh send answers the previous wrong guess, so the old verdict goes.
   * Leaving it up put "Code sent to you@example.com" and "That code is not
   * right" on screen together, which is a screen contradicting itself about
   * which code it means.
   */
  const [showCheck, setShowCheck] = useState(true);

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
    try {
      const result = await sendEmailCode();
      setSendState(result);
      setShowCheck(false);

      /*
       * The server's own remaining wait. It is returned on every outcome that
       * leaves the throttle running - a successful send, a refusal that was too
       * soon, and a code that was issued but could not be emailed, which is the
       * one worth getting right: the code is spent and the minute is running
       * even though nothing arrived.
       */
      setCooldown(result.retryAfterSeconds ?? 0);

      /* Verified elsewhere while this tab sat here. The page above decides what
         to draw, so ask it again rather than trying to become that screen. */
      if (result.ok && result.verified) router.refresh();
    } catch {
      /*
       * The action itself no longer throws, so this is the network: a phone
       * that lost signal between here and the mail app. Without it the button
       * kept "Sending..." and stayed disabled for ever, because the finally
       * below never ran - a dead screen whose only exit was a reload nobody
       * had been told to try.
       */
      setSendState({
        ok: false,
        error: "Could not reach us just now. Check your connection and try again.",
      });
    } finally {
      setSending(false);
    }
  }

  const checkError = showCheck && checkState && !checkState.ok ? checkState.error : null;

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

      <form
        action={checkAction}
        onSubmit={() => setShowCheck(true)}
        className="space-y-2 border-t border-divider pt-4"
      >
        <label htmlFor="code" className="field-label">
          Six-digit code
        </label>
        <div className="flex flex-wrap items-start gap-2">
          <Input
            id="code"
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
            /*
             * The four attributes that decide whether this is typed or tapped.
             * inputMode brings up the digit pad; autoComplete one-time-code is
             * what lets Android offer the code straight from the notification
             * and iOS autofill it from the mail; maxLength stops a seventh
             * character; and pattern is [0-9]* rather than [0-9]{6} on purpose
             * - it is iOS Safari's numeric-keypad hint, and as a validity rule
             * it would only ever fire the browser's own "match the requested
             * format" bubble, which is the one error message on this screen
             * that could not say what was actually wrong. Length is enforced by
             * the disabled button instead, and by the action, which re-strips
             * and re-counts server-side.
             */
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={CODE_LENGTH}
            /* The keyboard opens on a field somebody has usually just come
               back to fill: reading the mail means leaving this page, and on a
               phone coming back is a fresh load with the code on the
               clipboard. */
            autoFocus
            required
            aria-invalid={checkError ? true : undefined}
            aria-describedby={checkError ? "code-error" : undefined}
            placeholder="123456"
            className="w-32 font-mono text-base tracking-[0.35em] placeholder:tracking-normal"
          />
          {/* Disabled until six digits are in, so the button is never a way of
              finding out that the field is short. */}
          <SubmitCode disabled={!complete} />
        </div>

        {showCheck && checkState ? (
          <p
            id={checkState.ok ? undefined : "code-error"}
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

function SubmitCode({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={disabled || pending}
      className={cx(buttonClass("primary", "md"), "disabled:opacity-60")}
    >
      {pending ? <Loader2 size={15} className="animate-spin" /> : null}
      {pending ? "Checking..." : "Verify"}
    </button>
  );
}
