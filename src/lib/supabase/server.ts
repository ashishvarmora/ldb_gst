import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";

import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/supabase/timeout";

/**
 * Session-bound client. Reads the signed-in user from cookies and is subject to
 * Row Level Security. Use this for anything that must respect who is asking.
 */
export async function getSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    // A signed-in customer is waiting on every call made through this client.
    global: { fetch: fetchWithTimeout(15_000) },
    /*
     * HttpOnly and Secure (16 Nov 2026). The library default leaves the session
     * readable by page scripts, which only a browser Supabase client needs -
     * and this app has none: every read and write goes through the server. So
     * a script that ever slipped into a page still could not take the session.
     */
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component render, where cookies are readonly.
          // The middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}
