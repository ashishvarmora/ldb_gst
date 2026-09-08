"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { getSupabaseServer } from "@/lib/supabase/server";

/**
 * Signing out, on the server, in a way that cannot fail.
 *
 * WHY THIS MOVED OFF THE BROWSER CLIENT.
 *
 * It used to be `getSupabaseBrowser().auth.signOut()` in an onClick. That was
 * fixed once already - the error is now read, and a failed global revoke falls
 * back to a local one - and the owner reported it still not working. Every
 * remaining way it can fail is a property of doing it in the browser at all:
 *
 *  - The button has to be hydrated before it does anything. On a slow phone the
 *    sidebar is on screen and tappable for a second or two before the route's
 *    JavaScript has arrived, and a tap in that window is simply lost. Nothing
 *    is shown, nothing happens, and the reader taps it again.
 *  - Clearing the session means deleting cookies through `document.cookie`,
 *    which only works when the name, path and domain all match what the server
 *    wrote. A long session is split across `sb-<ref>-auth-token.0`, `.1`, and
 *    getting the set of names right is the library's business, not ours - but
 *    the consequence when it gets one wrong is a cookie that survives, so the
 *    next request is still signed in and /login bounces straight back to
 *    /portal. Signed out, then instantly not.
 *  - The default revoke is a network call to Supabase. On two bars in a lorry
 *    yard it hangs, and the reader is watching a button that says
 *    "Signing out..." for as long as the request takes to time out.
 *
 * So the browser is taken out of it. This runs on the server, where the cookie
 * jar is authoritative: whatever supabase-js thinks, every `sb-` cookie on this
 * browser is deleted, unconditionally, and the reply carries the Set-Cookie
 * headers that do it. There is no path through this function that leaves
 * somebody signed in.
 *
 * SCOPE IS DELIBERATELY LOCAL. `scope: "local"` drops this browser's session
 * without calling Supabase at all, so signing out costs no round trip and
 * cannot be defeated by a bad connection - which was the failure above. The
 * cost is that the refresh token is not revoked server-side, so it would still
 * be usable by anyone who had already copied it out of this browser. Nobody
 * holds it after the cookies are gone, and the alternative - a global revoke -
 * signs the same person out of every other device they own, which is not what
 * a button labelled "Sign out" should do.
 */
export async function signOutAction() {
  const supabase = await getSupabaseServer();

  /*
   * Best effort, and its result is deliberately not consulted. It exists to let
   * supabase-js emit its own cookie removals through setAll() - which handles
   * chunked names correctly - and to clear any in-memory state. The sweep below
   * is what actually guarantees the outcome.
   */
  try {
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      console.error("Sign out: supabase-js returned an error, clearing cookies anyway:", error.message);
    }
  } catch (thrown) {
    /*
     * Caught rather than allowed to propagate, because a cookie this call cannot
     * parse is precisely the case where somebody most needs to get out. A
     * truncated chunk, a value from an older cookie format, a half-written
     * refresh - signOut() can throw on any of them, and an unhandled throw here
     * would skip the sweep below and leave the reader permanently stuck with a
     * cookie that breaks every request and a button that 500s.
     */
    console.error("Sign out: supabase-js threw, clearing cookies anyway:", thrown);
  }

  /*
   * The guarantee. Every Supabase auth cookie carries the `sb-` prefix - the
   * session itself, its chunks, and the PKCE code verifier - and all of them
   * are written at path "/", which is where delete(name) removes them from.
   * Deleting a cookie that is already gone is a no-op, so this is safe to run
   * over whatever the call above left behind.
   */
  const store = await cookies();
  for (const cookie of store.getAll()) {
    if (cookie.name.startsWith("sb-")) store.delete(cookie.name);
  }

  /*
   * A redirect from a Server Action is a 303, so the browser makes a fresh GET
   * for /login. That matters more than it looks: the middleware and every
   * Server Component re-read the cookie jar from nothing, so no page rendered
   * for the account that just left can be shown to whoever is holding the phone
   * next. A client-side navigation would have reused what was already in
   * memory.
   *
   * Outside the try/catch above on purpose - redirect() works by throwing, and
   * catching it here would swallow the redirect and leave the reader on the page
   * they were trying to leave.
   */
  redirect("/login");
}
