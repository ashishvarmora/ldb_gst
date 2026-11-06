"use server";

import { cookies } from "next/headers";

import { fail, str } from "@/lib/forms";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import {
  RECOVERY_COOKIE,
  RECOVERY_VERIFIED_COOKIE,
  RECOVERY_VERIFIED_TTL_SECONDS,
  looksLikeRecoveryToken,
  looksLikeUserId,
} from "@/lib/recovery";
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
  const verifiedFor = store.get(RECOVERY_VERIFIED_COOKIE)?.value;
  const hasToken = looksLikeRecoveryToken(token);

  /*
   * Neither cookie means the link was never opened in this browser, an hour
   * passed with the form sitting open, or the password was already saved. All
   * three read the same from here, and saying which would be guessing - so the
   * message offers both ways out, a fresh link or the old one opened again.
   */
  if (!hasToken && !looksLikeUserId(verifiedFor)) {
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

  if (hasToken) {
    /*
     * This is the moment the link is spent. It signs the reader in as
     * themselves - which is what a recovery token is for - and the session lands
     * in cookies through the client's setAll(), writable here because a Server
     * Action may set them.
     */
    const { data, error: verifyError } = await supabase.auth.verifyOtp({
      type: "recovery",
      token_hash: token,
    });

    // Spent either way: on success by us, on failure by somebody earlier.
    store.delete(RECOVERY_COOKIE);

    if (verifyError || !data.user) {
      store.delete(RECOVERY_VERIFIED_COOKIE);
      return { ok: false, error: "link_expired" };
    }

    /*
     * Remember that this browser has already proved the link, so that if the
     * password is refused below the reader can simply try another one instead
     * of being told their link has expired. See RECOVERY_VERIFIED_COOKIE.
     */
    store.set(RECOVERY_VERIFIED_COOKIE, data.user.id, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: RECOVERY_VERIFIED_TTL_SECONDS,
    });
  } else {
    /*
     * A second attempt after Supabase refused a password. Honoured only for the
     * user the link signed in, and only while that session is still here.
     */
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || user.id !== verifiedFor) {
      store.delete(RECOVERY_VERIFIED_COOKIE);
      return { ok: false, error: "link_expired" };
    }
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });

  if (updateError) {
    /*
     * THE PASSWORD THEY TYPED IS ALREADY THEIR PASSWORD.
     *
     * Not a failure from the reader's side. They came here to get back into
     * their account, the link has signed them in, and the password they chose
     * is the one that now works - which is everything a reset is for. This used
     * to be shown as Supabase's "New password should be different from the old
     * password" with the link already burned, and the customer who hit it on
     * 6 Nov 2026 requested a second link, typed the same password, got the same
     * dead end and left. Somebody who remembers their password under pressure
     * is the most ordinary visitor this page has.
     */
    if (
      updateError.code === "same_password" ||
      /different from the old password/i.test(updateError.message)
    ) {
      store.delete(RECOVERY_VERIFIED_COOKIE);
      return { ok: true, message: "unchanged" };
    }

    /*
     * Anything else - most often a password Supabase thinks too weak. The
     * reader is signed in and RECOVERY_VERIFIED_COOKIE keeps the form usable,
     * so they are told what was wrong and can type another one straight away.
     */
    console.error(
      `Password reset: updateUser refused after a valid token (${updateError.code ?? "no code"}): ${updateError.message}`,
    );
    return fail(passwordRefusal(updateError.code, updateError.message));
  }

  store.delete(RECOVERY_VERIFIED_COOKIE);

  /*
   * No redirect() here on purpose. The reader is signed in and the page turns
   * into a confirmation with one button on it: a password change is worth
   * saying out loud, and dropping somebody straight onto their dashboard leaves
   * them wondering whether it actually saved.
   */
  return { ok: true, message: "changed" };
}

/** Supabase's reasons, in words that tell the reader what to do next. */
function passwordRefusal(code: string | undefined, message: string): string {
  if (code === "weak_password") {
    return "That password is too easy to guess. Please choose a longer one, mixing letters and numbers.";
  }
  if (code === "reauthentication_needed" || code === "session_expired" || code === "session_not_found") {
    return "Your reset session has run out. Please request a new link and try again.";
  }
  return message
    ? `That password could not be saved: ${message} Please try a different one.`
    : "That password could not be saved. Please try a different one, or request a new link.";
}
