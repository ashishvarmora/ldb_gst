import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase auth cookie on every request so Server Components
 * never see an expired session. Route protection itself lives in
 * requireSuperAdmin(), which also knows about roles.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

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
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|api/webhooks|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
