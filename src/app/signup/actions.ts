"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { publicSettings } from "@/components/SiteFooter";
import { notifyAdminOfSignup, sendEmail, welcomeEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { reportError } from "@/lib/errors";
import { fail, str } from "@/lib/forms";
import { PHONE_ERROR, normaliseIndianMobile } from "@/lib/phone";
import { clientIp, rateLimit, rateLimitMessage } from "@/lib/ratelimit";
import { grantCredits } from "@/lib/credits";
import { attachReferral, resolveReferralCode } from "@/lib/referrals";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

const schema = z.object({
  full_name: z.string().min(2, "Enter your full name."),
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(8, "Choose a password of at least 8 characters."),
  /*
   * Required, and validated as an Indian mobile rather than as "some text".
   * This is the number an officer is actually reached on when their account is
   * locked or a payment fails - an email address alone has already proved not
   * to be enough, because this deployment's outbound mail can be
   * misconfigured while the account looks fine.
   */
  phone: z
    .string()
    .min(1, "Enter your mobile number.")
    .transform((value) => normaliseIndianMobile(value))
    .refine((value): value is string => value !== null, PHONE_ERROR),
});

export async function signUp(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  /*
   * Counted first, before the settings read and before anything is written.
   *
   * A registration is not free to us even though it is free to the person
   * making one: it creates an auth user, and it hands over the free-tier
   * credits below. Somebody scripting this form mints accounts and, with them,
   * credits - and one bonus code that is "once per account" becomes once per
   * account they can be bothered to create.
   *
   * The address is the only thing there is to count at this point, since there
   * is no session and the email is chosen by whoever is asking.
   */
  const throttle = await rateLimit("signup:ip", await clientIp());
  if (!throttle.allowed) {
    return fail(rateLimitMessage(throttle, "accounts created from here"));
  }

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
    phone: str(fd, "phone") ?? "",
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Please check the form.");

  const { full_name, email, password, phone } = parsed.data;
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
    user_metadata: { full_name, phone },
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
  /*
   * The free tier, granted before the first redirect so the new account can try
   * a search on its very first screen instead of hitting a wall.
   *
   * Read from settings at signup rather than baked in, and a failure here is a
   * log line only - somebody who registered successfully must not be shown an
   * error because a bonus could not be applied. grant_credits writes the ledger
   * row, so the officer can see where it came from.
   *
   * freeCreditsGranted, below, is what was actually handed over rather than
   * what the setting says. The admin notification further down prints that
   * figure, and a mail claiming 25 free credits on an account that got none
   * because the grant failed is worse than a mail that leaves the line out.
   */
  let freeCreditsGranted = 0;
  if (settings.signupFreeCredits > 0 && created?.user?.id) {
    const granted = await grantCredits({
      admin,
      userId: created.user.id,
      amount: settings.signupFreeCredits,
      reason: "signup_bonus",
      note: "Free credits for a new account",
    });
    if (granted.ok) freeCreditsGranted = settings.signupFreeCredits;
    else console.error("Sign-up: free credits not granted:", granted.error);
  }

  const referrerId = await resolveReferralCode(admin, str(fd, "ref"));
  if (referrerId && created?.user?.id) {
    await attachReferral(admin, referrerId, created.user.id);
  }

  /*
   * Both mails, together, and BEFORE the sign-in.
   *
   * The welcome note used to be sent after it, which meant the one path where
   * sign-in fails - "your account was created, but we could not sign you in" -
   * sent no welcome at all, to the one person who has to go and sign in by
   * hand. And the admin notification would have been lost on that same path,
   * which is the worst place to lose it: an account exists and nobody has been
   * told.
   *
   * The account is real from createUser() onwards, so this is the right point
   * for anything that describes an account existing. Run as a pair because
   * they are two independent POSTs to the same provider and doing them one
   * after the other put an unnecessary round trip in front of the redirect.
   *
   * Promise.all cannot reject here: sendEmail() is documented never to throw
   * and notifyAdminOfSignup() swallows everything including its own settings
   * read. That is the whole reason a notification cannot break a registration -
   * a customer must never fail to get an account because an operator's mailbox
   * setting is wrong.
   */
  const mail = welcomeEmail(settings.brandName, `${env.siteUrl}/login`);
  const [sent] = await Promise.all([
    /* Replies go to support, not to the no-reply address this is sent from.
       A welcome note is the mail people answer most - with a question about
       plans - and this is the first message the account ever receives, so it
       is the worst one to have no reply path. */
    sendEmail({ to: email, ...mail, replyTo: settings.supportEmail }),
    created?.user?.id
      ? notifyAdminOfSignup(admin, {
          userId: created.user.id,
          name: full_name,
          email,
          phone,
          freeCredits: freeCreditsGranted,
          referred: referrerId !== null,
        })
      : Promise.resolve(),
  ]);

  // The account already works, so a failed welcome mail is a log line and not
  // an error the new member has to read or act on.
  if (!sent.ok) console.error("Sign-up: welcome email not sent:", sent.error);

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

  // Straight to the plans rather than the dashboard. A brand new account has no
  // plan, so nothing on the dashboard can be anything but zero, and choosing a
  // plan is the only thing that makes the rest of the product work.
  redirect("/portal/plan");
}
