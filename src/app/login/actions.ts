"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { friendlyError } from "@/lib/errors";
import { fail, str } from "@/lib/forms";
import { clientIp, rateLimit, rateLimitMessage } from "@/lib/ratelimit";
import { getSupabaseServer } from "@/lib/supabase/server";
import type { ActionResult } from "@/lib/types";

/**
 * Signing in, on the server.
 *
 * This used to happen in the browser: LoginForm called
 * supabase.auth.signInWithPassword() directly against the Supabase auth
 * endpoint. It worked, but there was no point in the request where this
 * application could see the attempt, which means there was no point at which it
 * could count one. A form that cannot be counted cannot be rate limited, and a
 * password form that cannot be rate limited is a password form that will be
 * sprayed eventually.
 *
 * So the sign-in moved here. The session cookie is still set the way it always
 * was - through getSupabaseServer(), whose cookie writer attaches Set-Cookie to
 * this response - and the wording of every refusal is carried over unchanged
 * from the client version, because those sentences were already the right ones.
 *
 * Supabase runs its own limits on the auth endpoint underneath this. Those
 * protect Supabase; these protect the account, and they count the two things
 * Supabase's cannot easily separate - one address trying many accounts, and
 * many addresses trying one account.
 */

const schema = z.object({
  email: z.string().email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

/** The one sentence both wrong-password and unknown-account get. */
const NO_MATCH = "That email and password combination does not match an account.";

export async function signIn(_prev: ActionResult | null, fd: FormData): Promise<ActionResult> {
  // Read raw, never trimmed. A password with a leading space is a password, and
  // silently removing it here would refuse somebody their own account.
  const password = typeof fd.get("password") === "string" ? (fd.get("password") as string) : "";
  const parsed = schema.safeParse({
    email: str(fd, "email")?.toLowerCase() ?? "",
    password,
  });

  /*
   * Counted BEFORE the form is judged, and before Supabase is asked anything.
   * A limit that only counts well-formed attempts is a limit somebody skips by
   * sending malformed ones, and one that only counts attempts that reached the
   * auth endpoint has already paid for the attempt it is trying to prevent.
   *
   * Two buckets, because they catch different attacks. One address working
   * through a list of accounts is caught by the IP; a botnet working through a
   * list of passwords for one account is caught by the email, which is the same
   * for all of them however many addresses they come from.
   */
  const ip = await clientIp();
  const byIp = await rateLimit("login:ip", ip);
  if (!byIp.allowed) return fail(rateLimitMessage(byIp, "sign-in attempts from here"));

  if (parsed.success) {
    const byEmail = await rateLimit("login:email", parsed.data.email);
    if (!byEmail.allowed) {
      return fail(rateLimitMessage(byEmail, "sign-in attempts for that account"));
    }
  }

  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? NO_MATCH);

  const supabase = await getSupabaseServer();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    /*
     * Checked before friendlyError, which reads "invalid login" as an expired
     * session and would tell someone with a typo'd password to sign in again.
     */
    return fail(error.message === "Invalid login credentials" ? NO_MATCH : friendlyError(error));
  }

  /*
   * Let the server decide where this account belongs. The root page reads the
   * session and sends a super admin to /admin, an officer to /portal and a
   * suspended account to /no-access - one place that knows the rule, rather
   * than a second copy of it here.
   */
  redirect("/");
}
