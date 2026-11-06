import Link from "next/link";
import { ArrowDownLeft, ArrowLeft, ArrowRight, Bell, Check, ChevronDown, ChevronRight, Coins, CreditCard, Gift, Headset, Layers, Plus, Search, ShieldCheck, Truck, Wallet } from "lucide-react";
import { TOPUP_HREF } from "@/lib/credits";
import { LinkPending } from "@/components/NavPending";

export type DashboardHomeModel = {
  firstName: string;
  dateLabel: string;
  credits: string;
  standing: "ok" | "low" | "empty";
  balanceHint: string;
  spentToday: string;
  spentMonth: string;
  trucks: string;
  truckLimit: string;
  hasTrucks: boolean;
  alerts: string;
  searches: string;
  checks: string;
  planName: string;
  planState: "active" | "inactive" | "new";
  planPrice: string | null;
  planExpiry: string;
  planAttention: boolean;
  referralsEnabled: boolean;
  setup: { label: string; href: string; done: boolean }[];
};

const shortcuts = [
  { label: "My trucks", detail: "Manage tracking", href: "/portal/trucks", icon: Truck, tone: "blue" },
  { label: "Groups", detail: "Organise your trucks", href: "/portal/cases", icon: Layers, tone: "purple" },
  { label: "Payments", detail: "View transactions", href: "/portal/payments", icon: CreditCard, tone: "green" },
  { label: "Credit history", detail: "Review your balance", href: "/portal/credits", icon: Coins, tone: "amber" },
];

/** A phone-first home. Links use the existing authenticated application routes. */
export function PortalHomeView({ model: m }: { model: DashboardHomeModel }) {
  const completed = m.setup.filter(step => step.done).length;
  return (
    <div className="mobile-dashboard">
      <Link href="/portal/profile" className="app-back-link"><ArrowLeft size={17} />Profile</Link>
      <header className="dash-intro">
        <div><p>Your daily overview</p><h1>Dashboard</h1></div>
        <span className="dash-date">{m.dateLabel}</span>
      </header>

      <Link href="/portal/search" className="dash-search-launch">
        <span className="dash-search-icon"><Search size={23} strokeWidth={1.8} /></span>
        <span><strong>Find a truck</strong><small>Search by registration number</small></span>
        <ArrowRight size={21} /><LinkPending />
      </Link>

      {m.planState !== "active" && (
        <section className="dash-plan-notice" aria-label="Tracking plan">
          <span className="dash-notice-icon"><ShieldCheck size={21} /></span>
          <div><h2>{m.planState === "new" ? "Start watching your trucks" : "Your tracking plan is inactive"}</h2><p>{m.planState === "new" ? "Choose a plan to enable automatic checks and alerts." : "Renew your plan to resume automatic checks. Your credits still work for searches."}</p><Link href="/portal/plan">{m.planState === "new" ? "Choose a plan" : "Renew your plan"}<ArrowRight size={15} /></Link></div>
        </section>
      )}

      <section className="dash-wallet dash-card" aria-labelledby="dash-balance-title">
        <div className="dash-wallet-top"><h2 id="dash-balance-title"><Wallet size={17} />Available credits</h2><Link className="dash-history-link" href="/portal/credits" aria-label="View credit history"><ArrowDownLeft size={18} /></Link></div>
        <div className="dash-wallet-balance"><div><p className="dash-balance-number">{m.credits}</p></div><Link href={TOPUP_HREF} className="dash-topup"><Plus size={16} />Top up<LinkPending /></Link></div>
        {m.planState !== "new" && m.standing !== "ok" && <p className={`dash-balance-warning dash-warning-${m.standing}`} role={m.standing === "empty" ? "alert" : undefined}>{m.balanceHint}</p>}
        <dl className="dash-wallet-usage"><div><dt>Used today</dt><dd>{m.spentToday}<span> credits</span></dd></div><div><dt>This month</dt><dd>{m.spentMonth}<span> credits</span></dd></div></dl>
      </section>

      <div className="dash-metrics">
        <Link href="/portal/trucks" className="dash-metric dash-card"><span className="dash-metric-icon dash-tone-blue"><Truck size={21} /></span><h2>Trucks watched</h2><p>{m.trucks}<span> / {m.truckLimit}</span></p><span className="dash-metric-caption">{m.hasTrucks ? "Manage your trucks" : "Add your first truck"}<ChevronRight size={14} /></span><LinkPending /></Link>
        <section className="dash-metric dash-card" aria-labelledby="dash-alerts-title"><span className="dash-metric-icon dash-tone-purple"><Bell size={20} /></span><h2 id="dash-alerts-title">Alerts today</h2><p>{m.alerts}</p><span className="dash-metric-caption">{m.alerts === "0" ? "No alerts so far today" : "Updates in your notification bell"}</span></section>
      </div>

      {m.planState === "active" && <Link href="/portal/plan" className={`dash-plan-strip ${m.planAttention ? 'dash-plan-attention' : ''}`}><span className="dash-plan-icon"><ShieldCheck size={21} /></span><span className="dash-plan-copy"><strong>{m.planName}<span>{m.planAttention ? "Review plan" : "Your plan"}</span></strong><small>{m.planPrice ? `${m.planPrice} · ` : ""}{m.planExpiry}</small></span><ChevronRight size={18} /><LinkPending /></Link>}

      <section className="dash-today dash-card" aria-labelledby="dash-today-title"><div className="dash-section-title"><h2 id="dash-today-title">Today’s activity</h2><Link href="/portal/activity">View all<ChevronRight size={14} /></Link></div><dl><div><dt>Truck searches</dt><dd>{m.searches}</dd></div><div><dt>Automatic checks</dt><dd>{m.checks}</dd></div></dl></section>

      <section className="dash-workspace" aria-labelledby="dash-workspace-title"><h2 id="dash-workspace-title">Your workspace</h2><nav className="dash-shortcuts" aria-label="Workspace shortcuts">{shortcuts.map(({label,detail,href,icon:Icon,tone})=><Link href={href} key={href}><span className={`dash-shortcut-icon dash-tone-${tone}`}><Icon size={20} strokeWidth={1.8} /></span><strong>{label}</strong><small>{detail}</small><ChevronRight className="dash-shortcut-arrow" size={15} /><LinkPending /></Link>)}</nav></section>

      {completed < m.setup.length && <details className="dash-setup dash-card"><summary><span className="dash-setup-icon"><Check size={17}/></span><span>Finish setting up<small>{completed} of {m.setup.length} complete</small></span><ChevronDown size={18}/></summary><ol>{m.setup.map(step=><li key={step.href+step.label}><Link href={step.href}><span className={step.done ? "dash-step-done" : "dash-step-pending"}>{step.done ? <Check size={13}/> : null}</span>{step.label}<ChevronRight size={15}/></Link></li>)}</ol></details>}

      {m.referralsEnabled && <Link href="/portal/referrals" className="dash-referral"><span><Gift size={23}/></span><span><strong>Good journeys are better shared.</strong><small>Invite a friend. Earn credits on their first payment.</small></span><ChevronRight size={18}/><LinkPending /></Link>}

      <Link href="/portal/support" className="dash-support"><Headset size={21}/><span>Need a hand?<strong>Talk to support</strong></span><ArrowRight size={18}/><LinkPending /></Link>
    </div>
  );
}
