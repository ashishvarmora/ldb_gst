"use server";

import { z } from "zod";

import { publicSettings } from "@/components/SiteFooter";
import { emailConfigured, passwordResetEmail, sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { done, fail, str } from "@/lib/forms";
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

export async function requestPasswordReset(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const email = str(fd, "email")?.toLowerCase() ?? "";
  const parsed = z.string().email().safeParse(email);
  if (!parsed.success) return fail("Enter a valid email address.");

  if (!emailConfigured()) {
    // Not the sender's problem and not their business either: a page that
    // announces "email is not configured" tells an attacker more than it tells
    // the person who just wants back into their account.
    console.error("Password reset requested but email is not configured on this deployment.");
    return done("We could not send that email just now. Support has been notified - please try again later.");
  }

  const { brandName } = await publicSettings();
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
      console.error("Password reset: generateLink failed:", error);
    }
    return done(SAME_ANSWER);
  }

  const mail = passwordResetEmail(brandName, link);
  const sent = await sendEmail({ to: email, ...mail });
  if (!sent.ok) console.error("Password reset: email not sent:", sent.error);

  return done(SAME_ANSWER);
}
