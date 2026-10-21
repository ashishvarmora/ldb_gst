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
 * still verified on every request, exactly once.
 *
 * The verification itself is now getSignedInUser() below, which checks the
 * token's signature here instead of asking Supabase Auth.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const user = await getSignedInUser();
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
 * Who the session cookie belongs to, verified, with no network round trip.
 *
 * getUser() asked Supabase Auth about the cookie on every request - one more
 * wait in front of every page, before any data could be read. The project signs
 * its tokens with an asymmetric key (ES256, published at
 * /auth/v1/.well-known/jwks.json), so getClaims() can check the signature and
 * expiry here: the public key is fetched once per server instance and kept for
 * ten minutes. A forged or expired cookie is refused exactly as before. If a
 * token is ever signed with the old shared secret, getClaims() falls back to
 * getUser() by itself, so the worst case is today's speed.
 *
 * What it does not see is a session revoked before its token expires (an hour
 * at most). That is the trade Supabase recommends, and the account switch that
 * matters - suspension - is profiles.status, which every gate still reads from
 * the database on every request.
 *
 * Split from getSessionUser so a caller that needs only the id can start its
 * own query while the profile is still being read.
 */
export const getSignedInUser = cache(
  async (): Promise<{ id: string; email: string | null } | null> => {
    const supabase = await getSupabaseServer();
    const { data, error } = await supabase.auth.getClaims();
    const sub = data?.claims?.sub;
    if (error || !sub) return null;
    return { id: sub, email: typeof data.claims.email === "string" ? data.claims.email : null };
  },
);

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
