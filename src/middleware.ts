import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth cookie on every request so Server Components
 * never see an expired session. Route protection itself lives in
 * requireSuperAdmin(), which also knows about roles.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  /*
   * BOTH NAMES, READ LITERALLY, AND A LOUD COMPLAINT IF NEITHER IS SET.
   *
   * This was `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY` alone, followed by a
   * silent `return response`. On production that variable did not exist - the
   * Supabase/Vercel integration injects NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   * instead, which is the same trap documented at length in src/lib/env.ts -
   * so this middleware did nothing on every request the live site ever served.
   * Sessions were therefore never refreshed here, and each Server Component
   * that needed a fresh token had to fetch one itself and could not persist it,
   * because a component render cannot write cookies. An extra Supabase round
   * trip on every navigation, which is a large part of why the owner reported
   * page changes being slow.
   *
   * It went unnoticed for exactly one reason: the early return said nothing.
   * env.ts's own health check reports these as configured, because it reads
   * them through firstOf() and finds the integration's spelling - so the admin
   * panel showed green while this file was inert.
   *
   * The names are spelled out rather than looked up in a loop because Next.js
   * inlines NEXT_PUBLIC_* at build time only when it can see the literal
   * property access. A dynamic process.env[name] is not substituted, so the
   * helper in env.ts - correct everywhere else - would read undefined here.
   */
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    console.error(
      "Middleware is not refreshing sessions: " +
        `${!url ? "NEXT_PUBLIC_SUPABASE_URL" : "NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)"}` +
        " is not set at build time. Every request will re-fetch its own token.",
    );
    return response;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();
  return response;
}

export const config = {
  /*
   * sw.js and the manifest are excluded for the same reason the static folders
   * are: they are fetched by the browser itself, outside any session, and
   * refreshing an auth cookie on those requests is a Supabase round trip that
   * nothing reads - and one that would attach Set-Cookie to a response the
   * service worker may cache.
   *
   * The webhook and the cron worker are excluded on top of that. Neither is a
   * browser and neither carries a session, so the refresh above can only fail;
   * more to the point, both authenticate themselves - Razorpay with an HMAC
   * over the raw body, the scheduler with CRON_SECRET - and neither should have
   * a Set-Cookie attached to a reply that Razorpay stores and replays. Running
   * a Supabase round trip in front of a webhook that Razorpay retries on
   * timeout is also the wrong latency to add to the one path where a timeout
   * costs somebody their credits.
   */
  /*
   * api/version is excluded for the sw.js reason exactly: every open tab and
   * every installed app polls it on each return to the foreground, it reads no
   * cookie and nothing reads the refreshed one back. Leaving it in would put a
   * Supabase round trip in front of the smallest and most frequent request the
   * app makes.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|api/webhooks|api/cron|api/version|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
