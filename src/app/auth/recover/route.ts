import { NextResponse, type NextRequest } from "next/server";

import { RECOVERY_COOKIE, looksLikeRecoveryToken } from "@/lib/recovery";

/**
 * Where a password reset email lands.
 *
 * It does one thing: take the recovery token out of the URL, put it in a
 * short-lived cookie, and send the reader to /reset-password with a clean
 * address bar. No database, no Supabase call, no rendering - a redirect from the
 * edge, which is as fast as this hop can be.
 *
 * WHY THE LINK COMES HERE AND NOT TO SUPABASE.
 *
 * The email used to carry GoTrue's own action_link, which meant: a round trip to
 * supabase.co to verify the token, a 302 back to /reset-password with the
 * session in the URL fragment, our page rendered, 179 kB of JavaScript
 * downloaded, hydration, and only then a third round trip to open the session
 * and put the form on screen. Three requests in series and a large bundle before
 * anything appeared - which on an Indian mobile connection is the several
 * seconds of "Checking your link..." the owner reported. The form is now on
 * screen after one request, and the reset page ships no Supabase client at all.
 *
 * WHY THE TOKEN IS NOT SPENT HERE. This is a GET, and a GET that consumes a
 * one-time token can be consumed by something that is not a person. Gmail,
 * Outlook and every corporate mail gateway fetch the links in a message to
 * check them, and with the old flow that fetch could verify the token and burn
 * it - so the reader clicked their own link and was told it had already been
 * used. Nothing here spends it. It is spent by the POST that sets the new
 * password, which only a human submitting a form can make.
 *
 * WHY A COOKIE RATHER THAN A QUERY STRING ON THE NEXT PAGE. A query string is
 * recorded in this deployment's request logs, kept in browser history and
 * visible in a screenshot; httpOnly also puts it out of reach of any script on
 * the page. The one place it does appear is this route's own log line, which is
 * the same exposure GoTrue's /verify already had, narrowed to a single endpoint
 * that does nothing else. It also survives a page refresh, which the old
 * fragment did not: reloading the form used to lose the link entirely.
 */

/*
 * Matched to the link's own hour rather than set shorter.
 *
 * It was fifteen minutes, which created a case where the cookie died while the
 * link was still perfectly good - and the reader was then told their link had
 * expired, which was false, and would have sent them to request another instead
 * of simply opening the one they had. Nothing is gained by expiring the copy
 * before the original: the token is httpOnly, single-use, cleared the moment the
 * password is saved, and GoTrue refuses it after the hour whatever this says.
 */
const COOKIE_TTL_SECONDS = 60 * 60;

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("t");

  /*
   * Checking the shape here keeps anything else from being written into a cookie
   * and carried to the next page, and costs one regex. A link that has been
   * mangled by a mail client - wrapped, truncated, or had its query string eaten
   * - fails this rather than failing later with a message about the token being
   * expired, which would send the reader looking for the wrong problem.
   */
  const looksRight = looksLikeRecoveryToken(token);

  const destination = new URL("/reset-password", request.nextUrl.origin);
  if (!looksRight) destination.searchParams.set("link", "broken");

  const response = NextResponse.redirect(destination);

  if (looksRight) {
    response.cookies.set(RECOVERY_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      /*
       * Lax, not Strict. The reader arrives from their mail client, which is a
       * different site, and Strict would drop the cookie on exactly the
       * navigation it exists for. Lax is sent on a top-level GET, which is what
       * clicking a link is.
       */
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_TTL_SECONDS,
    });
  }

  return response;
}
