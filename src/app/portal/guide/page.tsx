import { GuideHomeView } from "@/components/GuideHomeView";
import { requirePortalSession } from "@/lib/officer";
export const metadata = { title: "How to use Rahdari" };
export default async function GuidePage() { await requirePortalSession(); return <GuideHomeView signedIn/>; }
