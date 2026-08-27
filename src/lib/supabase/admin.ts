import { createClient } from "@supabase/supabase-js";

import { env } from "@/lib/env";

/**
 * Service-role client. Bypasses Row Level Security, so it must never be
 * imported into a Client Component. Every caller in this app first proves the
 * request comes from a super admin via requireSuperAdmin().
 */
export function getSupabaseAdmin() {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
