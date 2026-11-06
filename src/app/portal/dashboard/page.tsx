import { PortalHomeView, type DashboardHomeModel } from "@/components/PortalHomeView";
import { publicSettings } from "@/components/SiteFooter";
import { creditStanding, formatCredits, searchesLeft, searchesLeftLabel } from "@/lib/credits";
import { fmtDate, fmtNumber, fmtRupees, istToday } from "@/lib/format";
import { loadSearchCost, requirePortalSession } from "@/lib/officer";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Dashboard — ${brandName}` };
}

export default async function PortalDashboard() {
  const [{ overview: o, profile }, { referralEnabled }, searchCost] = await Promise.all([
    requirePortalSession(), publicSettings(), loadSearchCost(),
  ]);
  const standing = creditStanding(o.credits, searchCost);
  const expired = o.plan_expires_on !== null && o.plan_expires_on < istToday();
  const daysLeft = o.plan_expires_on
    ? Math.ceil((new Date(`${o.plan_expires_on}T23:59:59+05:30`).getTime() - Date.now()) / 86_400_000)
    : null;
  const model: DashboardHomeModel = {
    firstName: (profile.full_name ?? "").trim().split(/\s+/)[0],
    dateLabel: new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).format(new Date()),
    credits: formatCredits(o.credits), standing,
    balanceHint: standing === "empty"
      ? "Your balance is too low for searches and automatic checks. Top up to continue."
      : `Low balance: ${searchesLeftLabel(searchesLeft(o.credits, searchCost))} at today’s rate.`,
    spentToday: formatCredits(o.credits_spent_today), spentMonth: formatCredits(o.credits_spent_month),
    trucks: fmtNumber(o.active_trucks), truckLimit: o.truck_limit === -1 ? "Unlimited" : fmtNumber(o.truck_limit),
    hasTrucks: o.total_trucks > 0, alerts: fmtNumber(o.alerts_today),
    searches: fmtNumber(o.manual_searches_today), checks: fmtNumber(o.tracking_queries_today),
    planName: o.plan_name ?? "Your plan",
    planState: o.plan_active ? "active" : (o.plan_id || o.plan_name || o.plan_expires_on) ? "inactive" : "new",
    planPrice: o.price_inr ? fmtRupees(o.price_inr) : null,
    planExpiry: o.plan_expires_on === null ? "No end date" : `${expired ? "Ended" : "Ends"} ${fmtDate(o.plan_expires_on)}`,
    planAttention: expired || (daysLeft !== null && daysLeft <= 14),
    referralsEnabled: referralEnabled,
    setup: [
      { label: "Choose a tracking plan", href: "/portal/plan", done: o.plan_active },
      { label: "Search your first truck", href: "/portal/search", done: o.manual_searches_month > 0 || o.total_events > 0 },
      { label: "Add a truck to watch", href: "/portal/trucks", done: o.total_trucks > 0 },
      { label: "Set up a movement alert", href: "/portal/trucks", done: o.active_alerts > 0 },
    ],
  };
  return <PortalHomeView model={model} />;
}
