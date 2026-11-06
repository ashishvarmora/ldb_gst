import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, BookOpen, ChevronRight, Headset, MessageCircle, ShieldCheck } from "lucide-react";

/** A stable, static layout shared by the real conversation and the design preview. */
export function SupportChatShell({children}:{children:ReactNode}) {
  return <section className="support-page" aria-labelledby="support-title"><header className="support-page-title"><div><Link href="/portal/profile" className="support-back" aria-label="Back to profile"><ArrowLeft size={20}/></Link><h1 id="support-title">Messages</h1></div><Link href="/portal/guide" aria-label="Open help guide"><BookOpen size={20}/></Link></header><div className="support-conversation"><header className="support-team"><span><Headset size={22}/></span><div><h2>Rahdari support</h2><p>Your conversation with our team</p></div><ShieldCheck size={18}/></header>{children}</div></section>;
}

export function SupportEmptyState() {
  return <div className="support-empty"><span className="support-empty-icon"><MessageCircle size={32} strokeWidth={1.5}/></span><h3>Let’s make things clearer.</h3><p>Tell us what you need help with.<br/>Your replies will appear right here.</p><nav aria-label="Support guides"><Link href="/guide/trucks">Truck tracking<ChevronRight size={13}/></Link><Link href="/guide/payments">Payments<ChevronRight size={13}/></Link><Link href="/guide/account">My account<ChevronRight size={13}/></Link></nav></div>;
}
