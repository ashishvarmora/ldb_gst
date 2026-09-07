import { cache } from "react";
import { redirect } from "next/navigation";

import { getSupabaseServer } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Profile } from "@/lib/types";

export type SessionUser = { id: string; email: string; profile: Profile };

/**
 * The signed-in user plus their profile row, or null when not signed in.
 *
 * CACHED PER REQUEST, and this is the single largest thing that was wrong with
 * how long a page took to arrive.
 *
 * Two network round trips live in here: auth.getUser(), which asks Supabase
 * Auth to verify the cookie rather than trusting it, and a read of the profile
 * row. Neither is avoidable - getUser() is the check that makes a forged cookie
 * useless, and the profile carries the role every gate reads.
 *
 * What was avoidable was doing them repeatedly. Nothing was memoised, and every
 * gate calls this: a portal layout calls requirePortalSession, the page inside
 * it calls the same thing again, and a component further down calls
 * loadOverview. That is the same verification three times in one render. On a
 * database in Tokyo answering a function that used to run in Virginia, each
 * round trip cost about 150ms, so the duplication alone was most of a second
 * before the page had read anything it meant to show.
 *
 * React's cache() dedupes within a single request and nothing further: two
 * different visitors never share an entry, and the next request re-verifies. So
 * this is a saving in round trips, not a weakening of the check - the cookie is
 * still verified against Supabase on every request, exactly once.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
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
});

/**
 * Gate for everything under /admin. Redirects rather than throwing so a
 * signed-out visitor lands on the login page instead of an error boundary.
 */
export const requireSuperAdmin = cache(async (): Promise<SessionUser> => {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.profile.status !== "active") redirect("/no-access?reason=suspended");
  // An officer landing on an admin URL belongs on their own dashboard.
  if (session.profile.role !== "super_admin") redirect("/portal");
  return session;
});

/** Same check, for Server Actions: returns an error instead of redirecting. */
export async function assertSuperAdmin(): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session || session.profile.role !== "super_admin" || session.profile.status !== "active") {
    throw new Error("Not authorised. Sign in as a super admin.");
  }
  return session;
}
