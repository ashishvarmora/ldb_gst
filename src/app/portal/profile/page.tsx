import { ProfileView } from "@/components/ProfileView";
import { SignOutButton } from "@/components/SignOutButton";
import { publicSettings } from "@/components/SiteFooter";
import { formatCredits } from "@/lib/credits";
import { initials } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { loadLiveProfile } from "@/lib/live/server";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Profile — ${brandName}` };
}

export default async function ProfilePage() {
  const [{ id, overview, profile, email }, { referralEnabled }] = await Promise.all([requirePortalSession(), publicSettings()]);
  const modules = (profile as unknown as { modules?: unknown }).modules;
  const hasLive = Array.isArray(modules) && modules.includes("live");
  const liveProfile = hasLive ? await loadLiveProfile(id).catch(() => null) : null;
  return <ProfileView model={{ name: profile.full_name || email.split("@")[0], email,
    initials: initials(profile.full_name, email), credits: formatCredits(overview.credits),
    planName: overview.plan_name ?? "No active plan", planActive: overview.plan_active,
    referralsEnabled: referralEnabled, isAdmin: profile.role === "super_admin",
    live: hasLive ? { businessName: liveProfile?.business_name ?? null } : null }}
    signOut={<SignOutButton label="Sign out of your account" className="w-full" variant="secondary" />} />;
}
