"use server";

import { z } from "zod";

import { publicSettings } from "@/components/SiteFooter";
import { emailSenderProblem, passwordResetEmail, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { done, fail, str } from "@/lib/forms";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ActionResult } from "@/lib/types";

/*
 * Every path out of here that reaches a person says the same thing, whether or
 * not the address has an account. Anything else - a "no such account" message,
 * or even a visibly quicker reply - turns this form into a way of asking the
 * site which of a list of email addresses are registered.
 */
const SAME_ANSWER =
  "If that address has an account, a link to choose a new password is on its way. It expires in an hour, so use it soon.";

/**
 * The answer when the fault is ours. It has to be given for *every* address,
 * including ones with no account: a message that only appeared for real
 * accounts would answer the enumeration question the same way "no such account"
 * does. So it is decided before the address is looked up, never after a send
 * fails - the check below runs first for exactly that reason.
 */
function ourFault(supportEmail: string): ActionResult {
  return done(
    supportEmail
      ? `We cannot send reset emails at the moment - the fault is on our side, not with your address. Please write to ${supportEmail} and we will get you back in.`
      : "We cannot send reset emails at the moment - the fault is on our side, not with your address. Please contact support and we will get you back in.",
  );
}

export async function requestPasswordReset(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  /*
   * Throttled from two directions, because this form sends real mail from our
   * domain to an address somebody else typed. Unlimited, it is a way of pointing
   * our sending reputation at whoever you dislike, and a way of grinding through
   * a list of addresses looking for accounts.
   *
   * A refusal here says nothing SAME_ANSWER is protecting. The counter is keyed
   * on the address as typed and is written whether or not that address has an
   * account, so "too many requests for this address" is true of an address that
   * has never existed - and the only person who can see it is the one who just
   * made those requests.
   */
  const throttle = await rateLimit("forgot:ip", await clientIp());
  if (!throttle.allowed) {
    return fail("Too many reset requests from here. Please try again later.");
  }

  const email = str(fd, "email")?.toLowerCase() ?? "";
  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) return fail("Enter a valid email address.");

  const perAddress = await rateLimit("forgot:email", email);
  if (!perAddress.allowed) {
    return fail(
      "A reset link has already been requested for that address. Check the inbox and the spam folder, then try again in an hour.",
    );
  }

  const { brandName, supportEmail } = await publicSettings();

  /*
   * Asked before anything is sent, because a deployment can be unable to reach
   * a customer while every send still returns 200 for the operator testing it
   * with their own address. Silently carrying on is what makes this form look
   * like it works while nobody ever gets a link.
   */
  const senderProblem = emailSenderProblem();
  if (senderProblem) {
    console.error(
      `Password reset cannot be delivered - email is misconfigured on this deployment. ${senderProblem}`,
    );
    return ourFault(supportEmail);
  }

  const admin = getSupabaseAdmin();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: `${env.siteUrl}/reset-password` },
  });

  const link = data?.properties?.action_link;

  if (error || !link) {
    // An unknown address is the ordinary case and not worth a log line; a
    // genuine fault is.
    if (error && !/not found/i.test(error.message)) {
      console.error("Password reset: generateLink failed:", error.message);
    }
    return done(SAME_ANSWER);
  }

  const mail = passwordResetEmail(brandName, link);
  const sent = await sendEmail({ to: email, ...mail });

  if (!sent.ok) {
    /*
     * The address exists and the send still failed, so this is ours. The
     * reader gets SAME_ANSWER rather than ourFault(): only an existing account
     * can reach this line, so a distinct message here would leak exactly what
     * the identical answers above are protecting. The log is where this one is
     * meant to be read.
     */
    console.error(
      `Password reset: Resend rejected the send. Link generated but not delivered. Reason: ${sent.error}`,
    );
  }

  return done(SAME_ANSWER);
}
