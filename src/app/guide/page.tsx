import { GuideHomeView } from "@/components/GuideHomeView";
import { PublicShell, publicHeaderAction, publicSettings } from "@/components/SiteFooter";

/* Cached at the edge and rebuilt at most every five minutes - see
   publicHeaderAction in src/components/SiteFooter.tsx. */
export const revalidate = 300;
export async function generateMetadata() { const {brandName}=await publicSettings(); return {title:`How to use ${brandName}`,alternates:{canonical:"/guide"},openGraph:{title:`How to use ${brandName}`,url:"/guide", images: "/opengraph-image"},description:"Simple steps for truck search, tracking, alerts and your account."}; }
export default async function GuidePage() { const action=await publicHeaderAction(); return <PublicShell action={action} mainClassName="flex-1 px-4 py-6 sm:py-9"><GuideHomeView/></PublicShell>; }
