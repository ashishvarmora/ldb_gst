import { GuideHomeView } from "@/components/GuideHomeView";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";

/* Cached at the edge and rebuilt at most every five minutes - see
   publicHeaderAction in src/components/SiteFooter.tsx. */
export const revalidate = 300;
export async function generateMetadata() { const {brandName}=await publicSettings(); return {title:`Help centre — ${brandName}`,alternates:{canonical:"/guide"},openGraph:{title:`Help centre — ${brandName}`,url:"/guide", images: "/opengraph-image"},description:"Guides for truck search by vehicle number, toll crossing tracking, alerts, credits and your account."}; }
export default async function GuidePage() { const action=await publicHeaderAction(); return <PublicShell action={action} mainClassName="flex-1 px-4 py-6 sm:py-9"><GuideHomeView/></PublicShell>; }
