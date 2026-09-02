import { cache } from "react";
import { redirect } from "next/navigation";

import { getSessionUser, type SessionUser } from "@/lib/auth";
import { CREDIT_ACTIONS, costOf, loadRate } from "@/lib/credits";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { OfficerOverview } from "@/lib/types";

export type PortalSession = SessionUser & { overview: OfficerOverview };

/**
 * What one manual search costs this account today, in credits.
 *
 * Lives here rather than in credits.ts because a Client Component imports that
 * file for formatCredits(), and the service-role client must not follow it into
 * a browser bundle.
 *
 * Cached per request: the layout shows the balance on every page and the page
 * under it usually shows it again, so both read the same rate off one query.
 */
export const loadSearchCost = cache(async (): Promise<number> => {
  return costOf(await loadRate(getSupabaseAdmin(), CREDIT_ACTIONS.manualSearch));
});

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
    throw new Error("This account has been suspended. Contact support if you think that is wrong.");
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
  if (!overview.plan_active) {
    return overview.plan_expires_on && new Date(overview.plan_expires_on) < new Date()
      ? `Your plan ended on ${overview.plan_expires_on}. Renew it on the Plan and credits page.`
      : "Choose a plan to get started. You can pick one on the Plan and credits page.";
  }
  if (overview.credits <= 0) {
    return "You have run out of credits. Top up on the Plan and credits page.";
  }
  return null;
}

/** Whether another truck can go under tracking right now. */
export function truckSlotsLeft(overview: OfficerOverview): number {
  if (overview.truck_limit === -1) return Number.POSITIVE_INFINITY;
  return Math.max(overview.truck_limit - overview.active_trucks, 0);
}
