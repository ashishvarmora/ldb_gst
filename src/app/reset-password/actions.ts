"use server";

import { cookies } from "next/headers";

import { fail, str } from "@/lib/forms";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { RECOVERY_COOKIE, looksLikeRecoveryToken } from "@/lib/recovery";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

/**
 * Spending the recovery token and setting the new password, in one round trip.
 *
 * The old version did this in the browser: parse the URL fragment, setSession(),
 * wait, show the form, then updateUser(). Three sequential requests before the
 * reader could type anything. Here nothing happens until they submit, and then
 * it is one POST - verify the token, write the password, done. See
 * src/app/auth/recover/route.ts for why the token arrives in a cookie.
 *
 * A FAILED ATTEMPT LEAVES THE TOKEN ALONE. verifyOtp() spends it, so a wrong
 * password - too short, mistyped twice - must be rejected before that call, not
 * after. Otherwise the reader's first mistake would burn their link and the next
 * thing they saw would be "request a new one", which is the sort of thing that
 * makes somebody give up on getting back into their account.
 */

const MIN_PASSWORD = 8;

export async function setNewPassword(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const password = str(fd, "password") ?? "";
  const confirm = str(fd, "confirm") ?? "";

  /*
   * Checked before the token is touched, and before the rate limiter, because
   * neither of those should be spent on a form the reader can fix by looking at
   * it. The same two rules the browser checked, restated here: the browser's
   * copy is a courtesy and this is the one that decides.
   */
  if (password.length < MIN_PASSWORD) {
    return fail(`Choose a password of at least ${MIN_PASSWORD} characters.`);
  }
  if (password !== confirm) {
    return fail("The two passwords do not match.");
  }

  const store = await cookies();
  const token = store.get(RECOVERY_COOKIE)?.value;

  /*
   * No cookie means the link was never opened in this browser, an hour passed
   * with the form sitting open, or the token was already spent by a successful
   * submit. All three read the same from here, and saying which would be
   * guessing - so the message offers both ways out, a fresh link or the old one
   * opened again.
   */
  if (!looksLikeRecoveryToken(token)) {
    return { ok: false, error: "link_expired" };
  }

  /*
   * Rate limited on the caller's address rather than on the token. The token is
   * 56 hex characters - measured, not assumed - so guessing it is not the threat;
   * but this endpoint calls Supabase and writes a password, and every such
   * endpoint on this site has a limit in front of it. Sits after the cheap checks
   * so a mistyped confirmation does not eat an attempt.
   */
  const throttle = await rateLimit("forgot:ip", await clientIp());
  if (!throttle.allowed) {
    return fail("Too many attempts from here. Please wait a few minutes and try again.");
  }

  const supabase = await getSupabaseServer();

  /*
   * This is the moment the link is spent. It signs the reader in as themselves -
   * which is what a recovery token is for - and the session lands in cookies
   * through the client's setAll(), writable here because a Server Action may set
   * them.
   */
  const { error: verifyError } = await supabase.auth.verifyOtp({
    type: "recovery",
    token_hash: token,
  });

  if (verifyError) {
    /* Spent or expired either way - clear it so a second submit gets the honest
       answer immediately instead of another round trip to Supabase. */
    store.delete(RECOVERY_COOKIE);
    return { ok: false, error: "link_expired" };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });

  if (updateError) {
    /*
     * The token is gone now - verifyOtp() spent it - but the reader is signed in
     * on the strength of it, so the cookie is cleared and they are told what
     * happened rather than being sent round the loop again. Supabase refuses a
     * password it considers too weak or one that matches the old one, and its
     * own wording is better than a guess at which.
     */
    store.delete(RECOVERY_COOKIE);
    console.error("Password reset: updateUser failed after a valid token:", updateError.message);
    return fail(
      updateError.message ||
        "That password could not be saved. Please try a different one, or request a new link.",
    );
  }

  store.delete(RECOVERY_COOKIE);

  /*
   * No redirect() here on purpose. The reader is signed in and the page turns
   * into a confirmation with one button on it: a password change is worth
   * saying out loud, and dropping somebody straight onto their dashboard leaves
   * them wondering whether it actually saved.
   */
  return { ok: true, message: "changed" };
}
