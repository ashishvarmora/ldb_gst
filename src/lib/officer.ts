import { redirect } from "next/navigation";

import { getSessionUser, type SessionUser } from "@/lib/auth";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview } from "@/lib/types";

export type PortalSession = SessionUser & { overview: OfficerOverview };

/**
 * Gate for everything under /portal. Any active account can use the officer
 * dashboard, including the super admin — handy for testing a plan before you
 * hand it to a real officer.
 */
export async function requirePortalSession(): Promise<PortalSession> {
  const session = await getSessionUser();
  if (!session) redirect("/login");
  if (session.profile.status !== "active") redirect("/no-access?reason=suspended");

  const admin = getSupabaseAdmin();
  const { data: overview } = await admin
    .from("officer_overview")
    .select("*")
    .eq("id", session.id)
    .maybeSingle<OfficerOverview>();

  if (!overview) redirect("/no-access");
  return { ...session, overview };
}

/** Same check for Server Actions: returns an error instead of redirecting. */
export async function assertPortalUser(): Promise<SessionUser> {
  const session = await getSessionUser();
  if (!session) throw new Error("Please sign in again.");
  if (session.profile.status !== "active") {
    throw new Error("This account is suspended. Contact your administrator.");
  }
  return session;
}

/** Effective limits + current consumption, for quota checks inside actions. */
export async function loadOverview(userId: string): Promise<OfficerOverview | null> {
  const admin = getSupabaseAdmin();
  const { data } = await admin
    .from("officer_overview")
    .select("*")
    .eq("id", userId)
    .maybeSingle<OfficerOverview>();
  return data ?? null;
}

/**
 * Plain-language reason a search would be refused, or null when it is fine.
 *
 * Usage itself is not checked here: spend_credits() decides that atomically at
 * the moment of spending, and duplicating the balance test would only add a
 * second answer that can disagree with it.
 */
export function blockedReason(overview: OfficerOverview): string | null {
  if (overview.plan_expires_on && new Date(overview.plan_expires_on) < new Date()) {
    return `Your plan expired on ${overview.plan_expires_on}. Ask your administrator to renew it.`;
  }
  if (overview.credits <= 0) {
    return "You have no credits left. Buy more, or ask your administrator to top up your account.";
  }
  return null;
}

/** Whether another truck can go under tracking right now. */
export function truckSlotsLeft(overview: OfficerOverview): number {
  if (overview.truck_limit === -1) return Number.POSITIVE_INFINITY;
  return Math.max(overview.truck_limit - overview.active_trucks, 0);
}
