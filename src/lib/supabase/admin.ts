import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";
import { fetchWithTimeout } from "@/lib/supabase/timeout";

/**
 * Service-role client. Bypasses Row Level Security, so it must never be
 * imported into a Client Component. Every caller in this app first proves the
 * request comes from a super admin via requireSuperAdmin(), or from the account
 * itself via requirePortalSession().
 *
 * ONE INSTANCE, REUSED. This used to call createClient() on every invocation,
 * and it is called at nearly every query site in the app - a page that reads
 * six things built six clients. Two costs came with that:
 *
 *   Each client carries its own fetch setup and its own connection state, so
 *   nothing could be kept warm between queries in a single render.
 *
 *   Anything trying to memoise a query keyed on the client could never hit,
 *   because the key was a fresh object every time. That is not hypothetical:
 *   the app_settings read in settings.ts is cache()d on this argument, and it
 *   was a permanent miss until this became a singleton.
 *
 * Safe to share, and specifically because of the options below: no session is
 * persisted and no token is refreshed, so this client holds no per-user state
 * that could leak from one request into the next. It is a bearer of one fixed
 * key. A browser client, which does hold a session, must never be treated this
 * way - see supabase/server.ts, which builds one per request on purpose.
 *
 * Lazy rather than eagerly constructed at module load: env reads throw when a
 * variable is missing, and a throw at import time takes down the whole route
 * rather than the one request that needed the key.
 */
let client: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  client = createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    /* Generous, because the cron jobs use this client for long sweeps and
       exports; tight enough that nothing hangs until the function is killed. */
    global: { fetch: fetchWithTimeout(45_000) },
  });
  return client;
}
