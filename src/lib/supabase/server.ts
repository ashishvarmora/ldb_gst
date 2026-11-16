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
