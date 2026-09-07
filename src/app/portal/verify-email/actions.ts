"use server";

import { revalidatePath } from "next/cache";

import { sendEmail, verifyEmailCode } from "@/lib/email";
import { assertPortalUser } from "@/lib/officer";
import { clientIp, rateLimit, rateLimitMessage } from "@/lib/ratelimit";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";

/**
 * Proving the mailbox, before the free trial hands over credits and a slot.
 *
 * The rules live in the database - issue_email_code() throttles to one code a
 * minute, verify_email_code() dies after five wrong guesses, and
 * start_free_trial() refuses outright until email_is_verified() is true. These
 * actions read the session, rate-limit the endpoint, turn a verdict into a
 * sentence and send the mail. Nothing here decides anything: a rule in a Server
 * Action is a rule anybody who can reach the endpoint may argue with.
 *
 * THE CODE IS NEVER RETURNED TO THE BROWSER. issue_email_code() hands it back
 * exactly once, to this process, which emails it and drops it. It is stored as
 * a salted sha256, so it cannot be read back out of the row either.
 */

function fail(error: string): ActionResult {
  return { ok: false, error };
}

type Issued = {
  ok: boolean;
  reason?: string;
  code?: string;
  email?: string;
  expires_in_minutes?: number;
  already_verified?: boolean;
  retry_after_seconds?: number;
};

export async function sendEmailCode(): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  /*
   * Per account rather than per IP. An office behind one address may have
   * several officers, and the thing worth limiting is codes to one mailbox -
   * which is somebody else's inbox being used as a weapon. The IP limit is the
   * second gate, for a script cycling accounts.
   */
  const byUser = await rateLimit("email_code:user", session.id);
  if (!byUser.allowed) return fail(rateLimitMessage(byUser, "verification codes"));

  const byIp = await rateLimit("email_code:ip", await clientIp());
  if (!byIp.allowed) return fail(rateLimitMessage(byIp, "verification codes"));

  const { data, error } = await admin.rpc("issue_email_code", { p_user: session.id });
  if (error) return fail("Could not start verification. Please try again.");

  const issued = (data ?? {}) as Issued;

  if (issued.already_verified) {
    revalidatePath("/portal/verify-email");
    return { ok: true, message: "That address is already verified." };
  }

  if (!issued.ok) {
    if (issued.reason === "too_soon") {
      const seconds = issued.retry_after_seconds ?? 60;
      return fail(`A code was just sent. Try again in ${seconds} second${seconds === 1 ? "" : "s"}.`);
    }
    return fail("Could not start verification. Please try again.");
  }

  if (!issued.code || !issued.email) return fail("Could not start verification.");

  const settings = await loadSettings(admin);
  const mail = verifyEmailCode(settings.brandName, issued.code, issued.expires_in_minutes ?? 10);
  const sent = await sendEmail({ to: issued.email, ...mail });

  /*
   * A code issued but not delivered is the worst outcome: the throttle now
   * blocks a retry for a minute over an email that never arrived. So the
   * failure is reported as what it is rather than as a generic error, and it
   * names the wait.
   */
  if (!sent.ok) {
    return fail(
      "The code could not be emailed. Check the address on your profile, then try again in a minute.",
    );
  }

  revalidatePath("/portal/verify-email");
  return { ok: true, message: `Code sent to ${issued.email}. It expires in 10 minutes.` };
}

export async function checkEmailCode(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const code = String(fd.get("code") ?? "").replace(/\D/g, "");
  if (code.length !== 6) return fail("Enter the six digits from the email.");

  /* Guessing is limited in the function too, at five attempts on the row. This
     is the endpoint limit, so a script cannot burn through fresh rows. */
  const guard = await rateLimit("email_verify:user", session.id);
  if (!guard.allowed) return fail(rateLimitMessage(guard, "attempts"));

  const { data, error } = await admin.rpc("verify_email_code", {
    p_user: session.id,
    p_code: code,
  });
  if (error) return fail("Could not check that code. Please try again.");

  const verdict = (data ?? {}) as {
    ok: boolean;
    reason?: string;
    attempts_left?: number;
    already_verified?: boolean;
  };

  if (verdict.ok) {
    revalidatePath("/portal/verify-email");
    revalidatePath("/portal/plan");
    revalidatePath("/portal");
    return {
      ok: true,
      message: verdict.already_verified
        ? "That address is already verified."
        : "Email verified. You can start the free trial now.",
    };
  }

  switch (verdict.reason) {
    case "not_sent":
      return fail("No code has been sent yet. Send one first.");
    case "expired":
      return fail("That code has expired. Send a new one.");
    case "too_many_attempts":
      return fail("Too many wrong codes. Send a new one to start again.");
    case "wrong_code": {
      const left = verdict.attempts_left ?? 0;
      return fail(
        left > 0
          ? `That code is not right. ${left} attempt${left === 1 ? "" : "s"} left.`
          : "That code is not right, and no attempts are left. Send a new one.",
      );
    }
    default:
      return fail("Could not check that code. Please try again.");
  }
}
