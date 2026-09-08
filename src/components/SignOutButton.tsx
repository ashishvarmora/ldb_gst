"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

import { buttonClass, type ButtonVariant } from "@/components/ui";
import { getSupabaseBrowser } from "@/lib/supabase/browser";

/**
 * Signing out, and saying so when it does not work.
 *
 * WHY THIS IS NOT router.replace("/login") ANY MORE.
 *
 * signOut() does not throw - it returns { error } - and the old version awaited
 * it, ignored that, and navigated. supabase-js only clears the local session
 * once the revoke call has come back, and on a network failure it returns the
 * error WITHOUT clearing it. So a hiccup left the auth cookie in place and sent
 * the reader to /login, which redirects a signed-in account straight back to
 * /portal. Tap Sign out, land on the dashboard, still signed in, nothing said:
 * exactly the "it does not work" the owner reported, and the failure is
 * likeliest on a phone in a lorry yard with two bars of signal.
 *
 * So the error is read. A revoke that could not reach Supabase falls back to
 * scope "local", which drops this device's session without asking the server -
 * the tokens stay valid elsewhere until they expire, which is a far smaller
 * problem than a customer who cannot get out of the app. Only if that fails
 * too does the button say so, and it stays usable.
 *
 * And the redirect is a full document load rather than a client navigation.
 * The middleware and every Server Component re-read the cookies from scratch,
 * so nothing rendered for the signed-in session can be shown to whoever is
 * holding the phone next. router.replace + router.refresh got there most of the
 * time; a sign-out is not a place for most of the time.
 *
 * The failure is reported IN THE BUTTON rather than as a line under it. This
 * renders in four places - the sidebar footer, the account sheet, the admin
 * header and the no-access page - and a message that appears underneath would
 * change the height of all four. The label is the one place that costs nothing.
 */
export function SignOutButton({
  variant = "ghost",
  size = "sm",
  label = "Sign out",
  className,
}: {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  label?: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setPending(true);
    setFailed(false);

    const auth = getSupabaseBrowser().auth;
    let { error } = await auth.signOut();

    // The revoke did not land. Drop the session on this device anyway, which is
    // what the reader actually asked for.
    if (error) ({ error } = await auth.signOut({ scope: "local" }));

    if (error) {
      setPending(false);
      setFailed(true);
      return;
    }

    window.location.replace("/login");
  }

  return (
    <button
      type="button"
      disabled={pending}
      aria-live="polite"
      title={failed ? "Signing out failed. Check your connection and try again." : undefined}
      className={buttonClass(failed ? "danger" : variant, size, className)}
      onClick={() => void signOut()}
    >
      <LogOut size={14} />
      {pending ? "Signing out..." : failed ? "Sign out failed — retry" : label}
    </button>
  );
}
