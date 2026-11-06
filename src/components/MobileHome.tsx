import Link from "next/link";
import { ArrowRight, BellRing, BookOpen, ChevronRight, Headset, Layers, MapPin, Plus, Search, ShieldCheck, Truck } from "lucide-react";
import { JourneyCarousel } from "@/components/JourneyCarousel";

export function MobileHome({ firstName, hasTrucks, planActive }: { firstName: string; hasTrucks: boolean; planActive: boolean }) {
  return <div className="app-home">
    <header className="app-welcome"><div><p>{firstName ? `Hello, ${firstName}` : "Welcome to Rahdari"}</p><h1>Let’s get moving.</h1></div><span className="app-welcome-symbol" aria-hidden="true"><MapPin size={24} strokeWidth={1.6} /></span></header>
    <JourneyCarousel />
    <Link className="app-search-entry" href="/portal/search"><span><Search size={22} /></span><div><strong>Where’s your truck?</strong><small>Search by registration number</small></div><ArrowRight size={20} /></Link>
    <section className="app-quick-section" aria-labelledby="quick-title"><div className="app-section-heading"><h2 id="quick-title">A shortcut to your day</h2></div><nav className="app-quick-grid" aria-label="Quick actions">
      {[{ label: "My trucks", href: "/portal/trucks", icon: Truck, tone: "blue" }, { label: "Add truck", href: "/portal/trucks#add-truck", icon: Plus, tone: "orange" }, { label: "Groups", href: "/portal/cases", icon: Layers, tone: "mint" }, { label: "Alert settings", href: "/portal/settings#alerts", icon: BellRing, tone: "violet" }].map(({ label, href, icon: Icon, tone }) => <Link key={label} href={href}><span className={`app-quick-icon app-tone-${tone}`}><Icon size={24} strokeWidth={1.7} /></span><strong>{label}</strong></Link>)}
    </nav></section>
    <section className="app-fleet-section" aria-labelledby="fleet-title"><div className="app-section-heading"><h2 id="fleet-title">Your road ahead</h2><Link href="/portal/trucks">My trucks<ChevronRight size={15} /></Link></div><div className="app-fleet-prompt"><div className="app-fleet-art" aria-hidden="true"><Truck size={43} strokeWidth={1.5} /><span><MapPin size={16} /></span></div><div><h3>{hasTrucks ? "Your fleet is one tap away." : "Your first truck starts here."}</h3><p>{hasTrucks ? "Open your trucks to see recorded crossings and manage alerts." : "Add a truck to keep its crossing history close at hand."}</p><Link href="/portal/trucks" className="app-inline-action">{hasTrucks ? "Open my trucks" : "Add my first truck"}<ArrowRight size={16} /></Link></div></div></section>
    {!planActive && <Link href="/portal/plan" className="app-plan-prompt"><span className="app-tone-orange"><ShieldCheck size={22} /></span><div><strong>Ready for automatic tracking?</strong><small>Choose a plan to start watching your trucks.</small></div><ChevronRight size={18} /></Link>}
    <section aria-labelledby="help-title"><div className="app-section-heading"><h2 id="help-title">Here for every mile</h2></div><div className="app-help-grid"><Link href="/portal/guide"><span className="app-tone-blue"><BookOpen size={21} /></span><strong>A little guidance</strong><small>Learn how tracking works</small><ArrowRight size={17} /></Link><Link href="/portal/support"><span className="app-tone-mint"><Headset size={21} /></span><strong>Talk to us</strong><small>Help when you need it</small><ArrowRight size={17} /></Link></div></section>
    <p className="app-home-footnote"><ShieldCheck size={14} /> Toll crossing records. A clearer journey.</p>
  </div>;
}
