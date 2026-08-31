"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { publicSettings } from "@/components/SiteFooter";
import { sendEmail, welcomeEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { fail, str } from "@/lib/forms";
import { attachReferral, resolveReferralCode } from "@/lib/referrals";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

const schema = z.object({
  full_name: z.string().min(2, "Enter your full name."),
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Choose a password of at least 8 characters."),
});

export async function signUp(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  const settings = await publicSettings();
  // Checked again here, not only on the page: a closed sign-up that only hides
  // the form is still open to anyone who posts to the action directly.
  if (!settings.signupEnabled) {
    return fail("Registration is closed at the moment. Please get in touch with us instead.");
  }

  // Passwords are read raw, never trimmed: a leading space someone typed on
  // purpose is part of the password, and quietly removing it here would lock
  // them out of the account they just made.
  const raw = (name: string): string => {
    const value = fd.get(name);
    return typeof value === "string" ? value : "";
  };

  const parsed = schema.safeParse({
    full_name: str(fd, "full_name") ?? "",
    email: str(fd, "email")?.toLowerCase() ?? "",
    password: raw("password"),
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.");

  const { full_name, email, password } = parsed.data;
  if (password !== raw("confirm_password")) {
    return fail("The two passwords do not match.");
  }

  const admin = getSupabaseAdmin();

  /*
   * Created with the service role and marked confirmed on the spot. The usual
   * signUp() route mails a confirmation link, and this deployment has no SMTP
   * behind Supabase - the link would never arrive and the account would be
   * unusable. The profiles row comes from a trigger on auth.users, and
   * deliberately starts with no plan and no credits: a plan is chosen and paid
   * for afterwards.
   */
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (createError) {
    const taken =
      /already (been )?registered|already exists|email_exists/i.test(createError.message) ||
      (createError as { code?: string }).code === "email_exists";
    if (taken) {
      return fail("An account already exists for that email address. Try signing in instead.");
    }
    return fail(reportError("Sign-up: create user", createError));
  }

  /*
   * The invitation, recorded after the account exists and before anything else
   * can go wrong.
   *
   * The code is resolved here rather than trusted from the form, so a hand-typed
   * hidden field cannot credit somebody who never invited anyone. An unknown or
   * malformed code resolves to null and is simply dropped: it must never block a
   * registration, it just earns nobody anything. attachReferral swallows its own
   * failures for the same reason - the account is what the person came for, the
   * attribution is bookkeeping.
   *
   * Recorded even while referrals are switched off. The row is what a later
   * payment reads to decide whether anyone is owed, so throwing it away now
   * would silently punish everyone who was invited during a pause.
   */
  const referrerId = await resolveReferralCode(admin, str(fd, "ref"));
  if (referrerId && created?.user?.id) {
    await attachReferral(admin, referrerId, created.user.id);
  }

  // Sign in through the request-scoped client so the session cookie is set on
  // this response - the admin client holds no session of its own.
  const supabase = await getSupabaseServer();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    reportError("Sign-up: sign in after create", signInError);
    return fail(
      "Your account was created, but we could not sign you in automatically. Please sign in with your new password.",
    );
  }

  // The account already works, so a failed welcome mail is a log line and not
  // an error the new member has to read or act on.
  const mail = welcomeEmail(settings.brandName, `${env.siteUrl}/login`);
  const sent = await sendEmail({ to: email, ...mail });
  if (!sent.ok) console.error("Sign-up: welcome email not sent:", sent.error);

  // Straight to the plans rather than the dashboard. A brand new account has no
  // plan, so nothing on the dashboard can be anything but zero, and choosing a
  // plan is the only thing that makes the rest of the product work.
  redirect("/portal/plan");
}
