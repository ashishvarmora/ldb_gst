import { redirect } from "next/navigation";
import { AppDownload } from "@/components/AppDownload";
import { HomeLanding } from "@/components/HomeLanding";
import { SiteFooter, publicSettings } from "@/components/SiteFooter";
import { formatCredits, planChargeInr, planTermSuffix } from "@/lib/credits";
import { reportError } from "@/lib/errors";
import { fmtRupees } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/auth";
import type { AlertRuleTemplate, Plan } from "@/lib/types";

/** Plans in the teaser. Three fit a phone screen; the rest are on /pricing. */
const TEASER_PLANS = 3;

/**
 * The landing page, for someone who has never seen this before.
 *
 * Everything on it is either true of the code as it stands or read out of the
 * database, and nothing else is on it. No customer counts, no uptime figures,
 * no testimonials: this is a small product and the honest description of it is
 * a better argument than an invented one.
 *
 * Signed-in visitors never see it - the server decides where they belong and
 * sends them there, which is also what the sign-in form relies on.
 */
export default async function Home() {
  const session = await getSessionUser();
  if (session) {
    if (session.profile.status !== "active") redirect("/no-access?reason=suspended");
    redirect(session.profile.role === "super_admin" ? "/admin" : "/portal");
  }

  // Read alongside the settings rather than after them: neither depends on the
  // other, and a landing page waiting on two round trips in series is a slow one.
  const [{ brandName, signupEnabled }, { plans, alertRules }] = await Promise.all([
    publicSettings(),
    loadCatalogue(),
  ]);

  return (
    <div className="theme-light flex min-h-screen flex-col">
      <HomeLanding
        brandName={brandName}
        signupEnabled={signupEnabled}
        plans={plans.map(plan => ({
          id: plan.id, name: plan.name, description: plan.description,
          price: fmtRupees(planChargeInr(plan)), term: planTermSuffix(plan),
          trucks: plan.truck_limit === -1 ? "Unlimited trucks" : `${plan.truck_limit} truck${plan.truck_limit === 1 ? "" : "s"} to watch`,
          credits: formatCredits(plan.included_credits),
        }))}
        alertRules={alertRules}
        appSection={<AppDownload className="mt-5" />}
      />
      <footer className="welcome-footer"><span>{brandName}</span><nav aria-label="Footer"><a href="/contact">Contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav></footer>
    </div>
  );
}

/**
 * The two lists this page reads out of the database - the plans it teases, and
 * the alert rules the admin currently offers.
 *
 * Failure is answered with empty lists rather than an exception. This is the
 * page a stranger sees first, and it still says everything true about the
 * product with its pricing teaser missing; an error page says nothing at all.
 */
async function loadCatalogue(): Promise<{ plans: Plan[]; alertRules: AlertRuleTemplate[] }> {
  try {
    const admin = getSupabaseAdmin();
    const [planResult, alertResult] = await Promise.all([
      admin
        .from("plans")
        .select("*")
        .eq("is_active", true)
        .order("sort_order")
        .order("price_inr")
        .limit(TEASER_PLANS),
      admin.from("alert_rule_templates").select("*").eq("is_active", true).order("sort_order"),
    ]);

    return {
      plans: (planResult.data ?? []) as Plan[],
      alertRules: (alertResult.data ?? []) as AlertRuleTemplate[],
    };
  } catch (error) {
    reportError("Landing page: plans and alert rules", error);
    return { plans: [], alertRules: [] };
  }
}
