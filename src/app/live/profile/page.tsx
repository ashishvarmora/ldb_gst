import { ArrowLeftRight, BellRing, Building2, Database, History, ListChecks, Settings } from "lucide-react";
import Link from "next/link";

import { ACCOUNT_ITEMS, ProfileFooter, ProfileIdentity, ProfileMenu, type ProfileMenuSection } from "@/components/ProfileView";
import { SignOutButton } from "@/components/SignOutButton";
import { initials } from "@/lib/format";
import { loadLiveProfile, requireLiveSession } from "@/lib/live/server";

export const metadata = { title: "Live tracking - Profile" };
export const dynamic = "force-dynamic";

/**
 * Live tracking's own profile (v5, docs/LIVE-PLAN-v5.md §5). Same account card
 * and account items as the toll profile (shared components); the menu is Live only.
 */
export default async function LiveProfilePage() {
  const live = await requireLiveSession();
  const { profile, email } = live.session;
  const lp = await loadLiveProfile(live.ownerId);
  const sections: ProfileMenuSection[] = [
    {
      title: "Live tracking",
      items: [
        { href: "/live/profile/settings", title: "Business settings", detail: lp.business_name ? `${lp.business_name} · trip defaults, customer page` : "Business, default warehouse, customer page", icon: Building2, tone: "orange" },
        { href: "/live/profile/alerts", title: "Alerts", detail: "Default trip alerts and thresholds", icon: BellRing, tone: "violet" },
        { href: "/live/masters", title: "Masters", detail: "Drivers, trucks, warehouses", icon: Database, tone: "mint" },
        { href: "/live/history", title: "History", detail: "Past trips, search and filters", icon: ListChecks, tone: "blue" },
        { href: "/live/activity", title: "Activity", detail: "Events per trip; driver day view", icon: History, tone: "violet" },
        { href: "/portal", title: "Switch app", detail: "Toll tracking", icon: ArrowLeftRight, tone: "orange" },
      ],
    },
    { title: "Account", items: ACCOUNT_ITEMS },
  ];
  return (
    <div className="app-profile">
      <header className="app-profile-heading">
        <div>
          <p>Live tracking</p>
          <h1>Profile</h1>
        </div>
        <Link href="/live/profile/settings" aria-label="Live settings">
          <Settings size={21} />
        </Link>
      </header>
      <ProfileIdentity name={profile.full_name || email.split("@")[0]} email={email} initials={initials(profile.full_name, email)} />
      <ProfileMenu sections={sections} />
      <ProfileFooter signOut={<SignOutButton label="Sign out of your account" className="w-full" variant="secondary" />} />
    </div>
  );
}
