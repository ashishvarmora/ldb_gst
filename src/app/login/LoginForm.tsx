"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";

import { Field, Input } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

export function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const supabase = getSupabaseBrowser();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      // Checked before friendlyError, which reads "invalid login" as an expired
      // session and would tell someone with a typo'd password to sign in again.
      setError(
        signInError.message === "Invalid login credentials"
          ? "That email and password combination does not match an account."
          : friendlyError(signInError),
      );
      setPending(false);
      return;
    }

    // Let the server decide where this account belongs.
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field label="Email" name="email">
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
        />
      </Field>

      <div>
        <Field label="Password" name="password">
          <Input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
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

      {error ? (
        <p className="flex items-start gap-2 rounded-lg border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
          <AlertCircle size={15} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      ) : null}

      <button type="submit" disabled={pending} className={buttonClass("primary", "md", "w-full")}>
        {pending ? <Loader2 size={15} className="animate-spin" /> : null}
        {pending ? "Signing in..." : "Sign in"}
      </button>
    </form>
  );
}
