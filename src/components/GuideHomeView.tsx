import Link from "next/link";
import { ArrowLeft, ArrowRight, BellRing, BookOpen, ChevronRight, Headset, Search, Truck } from "lucide-react";
import { GuideSearch } from "@/app/guide/Search";
import { CATEGORIES, SEARCH_INDEX, articleCount, articleHref, startHere } from "@/app/guide/lib";

export function GuideHomeView({ signedIn = false }: { signedIn?: boolean }) {
  const labels = Object.fromEntries(CATEGORIES.map(category => [category.id, category.title]));
  const steps = [
    { title: "Find a truck", body: "Enter its registration number. Read the toll crossings and recorded times.", icon: Search, href: signedIn ? "/portal/search" : "/guide/trucks", tone: "blue" },
    { title: "Keep it on your list", body: "Choose a plan, then add the truck you want to follow.", icon: Truck, href: signedIn ? "/portal/trucks" : "/guide/plans", tone: "mint" },
    { title: "Get movement updates", body: "Choose an alert and connect your phone or Telegram notifications.", icon: BellRing, href: signedIn ? "/portal/settings#alerts" : "/guide/alerts", tone: "orange" },
  ];
  return <div className="guide-workspace account-workspace">
    {signedIn && <Link href="/portal/profile" className="app-back-link"><ArrowLeft size={17}/>Profile</Link>}
    <header className="guide-welcome"><span className="workspace-title-icon app-tone-mint"><BookOpen size={26}/></span><h1>A little help.<br/>A clearer journey.</h1><p>Learn the essentials, one simple step at a time.</p><GuideSearch index={SEARCH_INDEX} labels={labels} placeholder="Search help, e.g. alerts or credits"/></header>
    <section aria-labelledby="guide-start"><div className="app-section-heading"><h2 id="guide-start">Get started in 3 steps</h2></div><ol className="guide-step-cards">{steps.map(({title,body,icon:Icon,href,tone},i) => <li key={title}><Link href={href}><span className={`guide-step-icon app-tone-${tone}`}><Icon size={24}/><small>{i+1}</small></span><div><h3>{title}</h3><p>{body}</p></div><ChevronRight size={18}/></Link></li>)}</ol></section>
    <section><div className="app-section-heading"><h2>Useful first reads</h2></div><nav className="guide-reading-list" aria-label="First guides">{startHere(4).map(article => <Link key={article.slug} href={articleHref(article)}><span><strong>{article.title}</strong><small>{article.minutes} min read</small></span><ArrowRight size={17}/></Link>)}</nav></section>
    <section><div className="app-section-heading"><h2>What would you like help with?</h2></div><nav className="guide-topic-grid" aria-label="Guide topics">{CATEGORIES.map(({id,title,icon:Icon,blurb},i) => <Link key={id} href={`/guide/${id}`}><span className={`app-tone-${["blue","mint","orange","violet"][i%4]}`}><Icon size={21}/></span><h3>{title}</h3><p>{blurb}</p><small>{articleCount(id)} {articleCount(id) === 1 ? "guide" : "guides"}<ChevronRight size={14}/></small></Link>)}</nav></section>
    <Link href={signedIn ? "/portal/support" : "/contact"} className="guide-support"><Headset size={26}/><span><strong>Still need a hand?</strong><small>Our team can help you get moving.</small></span><ArrowRight size={19}/></Link>
  </div>;
}
