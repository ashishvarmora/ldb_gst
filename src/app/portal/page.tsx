import { MobileHome } from "@/components/MobileHome";
import { publicSettings } from "@/components/SiteFooter";
import { requirePortalSession } from "@/lib/officer";

export async function generateMetadata() {
  const { brandName } = await publicSettings();
  return { title: `Home — ${brandName}` };
}

export default async function PortalHome() {
  const { overview, profile } = await requirePortalSession();
  return <MobileHome firstName={(profile.full_name ?? "").trim().split(/\s+/)[0]}
    hasTrucks={overview.total_trucks > 0} planActive={overview.plan_active} />;
}
