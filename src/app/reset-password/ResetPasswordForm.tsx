"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Field, Input } from "@/components/form";
import { LinkButton, buttonClass } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/** checking the link -> form on screen -> changed, or the link was no good. */
type Stage = "checking" | "ready" | "invalid" | "changed";

export function ResetPasswordForm() {
  const [stage, setStage] = useState<Stage>("checking");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function openRecoverySession() {
      /*
       * Read the URL before touching the Supabase client. The recovery link
       * hands the session over in the fragment, and the browser client parses
       * and clears that fragment by itself the moment it is constructed - so
       * whatever we want from it has to be in hand first.
       */
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      const query = new URLSearchParams(window.location.search);

      const linkError =
        hash.get("error_description") ??
        query.get("error_description") ??
        hash.get("error") ??
        query.get("error");
      const accessToken = hash.get("access_token");
      const refreshToken = hash.get("refresh_token");
      const code = query.get("code");

      // Tokens do not belong in the address bar, where they are copied into
      // chats and left in screenshots. Cleared before anything can go wrong.
      window.history.replaceState(null, "", window.location.pathname);

      if (linkError) {
        if (!cancelled) setStage("invalid");
        return;
      }

      const supabase = getSupabaseBrowser();

      if (accessToken && refreshToken) {
        const { error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        });
        if (!cancelled) setStage(sessionError ? "invalid" : "ready");
        return;
      }

      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (!cancelled) setStage(exchangeError ? "invalid" : "ready");
        return;
      }

      // Nothing in the URL: either the client got there first and already has
      // the session, or somebody typed this address in by hand.
      const { data } = await supabase.auth.getSession();
      if (!cancelled) setStage(data.session ? "ready" : "invalid");
    }

    void openRecoverySession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Choose a password of at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }

    setPending(true);
    const { error: updateError } = await getSupabaseBrowser().auth.updateUser({ password });
    if (updateError) {
      // A session that has gone missing means the link ran out while the form
      // was open, which is a different problem from a password we rejected.
      if (/session|jwt|token/i.test(updateError.message)) {
        setStage("invalid");
        return;
      }
      setError(friendlyError(updateError));
      setPending(false);
      return;
    }

    setPending(false);
    setStage("changed");
  }

  if (stage === "checking") {
    return (
      <p className="flex items-center justify-center gap-2 py-4 text-sm text-muted">
        <Loader2 size={15} className="animate-spin" />
        Checking your link...
      </p>
    );
  }

  if (stage === "invalid") {
    return (
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>
            This link has expired or has already been used. Reset links last an hour and work once.
          </span>
        </p>
        <LinkButton href="/forgot-password" variant="primary" className="w-full">
          Send me a new link
        </LinkButton>
      </div>
    );
  }

  if (stage === "changed") {
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

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="New password" name="password">
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
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
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Type it once more"
        />
      </Field>

      {error ? (
        <p className="flex items-start gap-2 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={buttonClass("primary", "md", "w-full")}>
        {pending ? <Loader2 size={15} className="animate-spin" /> : null}
        {pending ? "Saving..." : "Save new password"}
      </button>

      <p className="text-center text-xs text-muted">
        <Link href="/login" className="hover:text-brand-500">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}
