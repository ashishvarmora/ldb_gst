import Link from "next/link";
import { ArrowRight, BellRing, BookOpen, ChevronRight, Coins, CreditCard, Gift, Headset, History, LayoutDashboard, Layers, Settings, ShieldCheck, UserRound, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { TOPUP_HREF } from "@/lib/credits";

export type ProfileModel = { name: string; email: string; initials: string; credits: string; planName: string; planActive: boolean; referralsEnabled: boolean; isAdmin: boolean };

export function ProfileView({ model: m, signOut }: { model: ProfileModel; signOut?: ReactNode }) {
  const sections = [
    { title: "Your workspace", items: [
      { href: "/portal/dashboard", title: "Dashboard", detail: "Your balance, usage and daily overview", icon: LayoutDashboard, tone: "blue" },
      { href: "/portal/cases", title: "Truck groups", detail: "Keep related trucks together", icon: Layers, tone: "mint" },
    ] },
    { title: "Plan & payments", items: [
      { href: "/portal/plan", title: "My plan", detail: m.planName, icon: Wallet, tone: "orange" },
      { href: "/portal/payments", title: "Payments", detail: "Receipts and transactions", icon: CreditCard, tone: "blue" },
      { href: "/portal/credits", title: "Credit history", detail: "Credits added and used", icon: Coins, tone: "mint" },
      { href: "/portal/activity", title: "Activity", detail: "Search and tracking usage", icon: History, tone: "violet" },
      ...(m.referralsEnabled ? [{ href: "/portal/referrals", title: "Invite & earn", detail: "Share Rahdari and earn credits", icon: Gift, tone: "orange" }] : []),
    ] },
    { title: "Make it yours", items: [
      { href: "/portal/profile/edit", title: "Edit profile", detail: "Your name and contact details", icon: UserRound, tone: "blue" },
      { href: "/portal/settings#alerts", title: "Notifications & alerts", detail: "Choose where updates reach you", icon: BellRing, tone: "violet" },
      { href: "/portal/settings", title: "Settings", detail: "Connections and saved history", icon: Settings, tone: "mint" },
    ] },
    { title: "We’re here to help", items: [
      { href: "/portal/support", title: "Help & support", detail: "Talk to our team", icon: Headset, tone: "mint" },
      { href: "/portal/guide", title: "How to use Rahdari", detail: "Simple guides for every step", icon: BookOpen, tone: "blue" },
      ...(m.isAdmin ? [{ href: "/admin", title: "Admin console", detail: "Manage your platform", icon: ShieldCheck, tone: "orange" }] : []),
    ] },
  ];
  return <div className="app-profile"><header className="app-profile-heading"><div><p>Your space</p><h1>Profile</h1></div><Link href="/portal/profile/edit" aria-label="Edit your profile"><Settings size={21} /></Link></header>
    <section className="app-identity" aria-label="Your account"><div className="app-avatar">{m.initials}</div><h2>{m.name}</h2><p>{m.email}</p><Link href="/portal/plan" className={`app-plan-badge ${m.planActive ? "is-active" : ""}`}><ShieldCheck size={14} />{m.planActive ? m.planName : "Choose a tracking plan"}<ChevronRight size={13} /></Link></section>
    <section className="app-profile-wallet" aria-label="Credit balance"><div><span><Wallet size={16} />Available credits</span><strong>{m.credits}</strong><Link href="/portal/credits">View credit history<ChevronRight size={14} /></Link></div><Link className="app-primary" href={TOPUP_HREF}>Top up<ArrowRight size={16} /></Link></section>
    <div className="app-profile-sections">{sections.map(section => <section key={section.title}><h2>{section.title}</h2><nav className="app-menu-list" aria-label={section.title}>{section.items.map(({ href, title, detail, icon: Icon, tone }) => <Link key={href} href={href}><span className={`app-menu-icon app-tone-${tone}`}><Icon size={20} strokeWidth={1.8} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={17} /></Link>)}</nav></section>)}</div>
    <div className="app-signout">{signOut}</div><nav className="app-legal" aria-label="Legal"><Link href="/privacy">Privacy policy</Link><Link href="/terms">Terms of use</Link><Link href="/about">About Rahdari</Link></nav>
  </div>;
}
