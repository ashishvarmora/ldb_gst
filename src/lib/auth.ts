import { redirect } from "next/navigation";

import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

export type SessionUser = { id: string; email: string; profile: Profile };

/** The signed-in user plus their profile row, or null when not signed in. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const supabase = await getSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // Read the profile with the service role: the profiles policy calls
  // is_super_admin(), and we want a straight answer even if that row is odd.
  const admin = getSupabaseAdmin();
  const { data: profile } = await admin
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle<Profile>();

  if (!profile) return null;
  return { id: user.id, email: user.email ?? profile.email, profile };
}

/**
 * Gate for everything under /admin. Redirects rather than throwing so a
 * signed-out visitor lands on the login page instead of an error boundary.
 */
export async function requireSuperAdmin(): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.profile.status !== "active") redirect("/no-access?reason=suspended");
  // An officer landing on an admin URL belongs on their own dashboard.
  if (session.profile.role !== "super_admin") redirect("/portal");
  return session;
}

/** Same check, for Server Actions: returns an error instead of redirecting. */
export async function assertSuperAdmin(): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session || session.profile.role !== "super_admin" || session.profile.status !== "active") {
    throw new Error("Not authorised. Sign in as a super admin.");
  }
  return session;
}
