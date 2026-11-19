import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, ChevronRight, Clock3, History, MapPin, Search, ShieldCheck, Star, Truck } from "lucide-react";

import { SaveTruckButton } from "@/components/SaveTruckButton";

export type SearchHistoryItem = {
  id: string | number;
  truck: string;
  date: string;
  crossings: number;
  ok: boolean;
  /** How many times this number was searched (one row per truck since 17 Nov 2026). */
  times?: number;
  saved?: boolean;
};

/** The top of the Saved trucks list, shown above the search history (0066). */
export type SavedStripItem = { truck: string; label: string | null; status: string };
export function SearchWorkspace({ form, history, total, notice, pager, saved = [], savedTotal = 0 }: { form: ReactNode; history: SearchHistoryItem[]; total: number; notice?: ReactNode; pager?: ReactNode; saved?: SavedStripItem[]; savedTotal?: number }) {
  return <div className="search-workspace"><header className="workspace-title"><span className="workspace-title-icon app-tone-blue"><Search size={24}/></span><div><p>Search by truck number</p><h1>Find a truck</h1></div></header>
    {notice}
    <section className="search-compose" aria-labelledby="search-title"><div className="search-compose-heading"><span className="app-tone-orange"><Truck size={25}/></span><div><h2 id="search-title">Check toll crossings</h2><p>Enter a registration number to see recorded toll crossings.</p></div></div>{form}<p className="search-privacy"><ShieldCheck size={14}/>Shows toll records, not live GPS.</p></section>
    <div className="search-benefits"><span><MapPin size={17}/>Crossing locations</span><span><Clock3 size={17}/>Recorded times</span><span><History size={17}/>Saved results</span></div>
    <section className="search-history" aria-labelledby="saved-title">
      <div className="app-section-heading"><h2 id="saved-title" className="inline-flex items-center gap-1.5"><Star size={16} className="fill-amber-400 text-amber-500"/>Saved trucks</h2><span className="workspace-count">{savedTotal}</span></div>
      {saved.length ? (
        <>
          <ul className="search-history-list">{saved.map(item => <li key={item.truck}><Link href={`/portal/search/${encodeURIComponent(item.truck)}`}><span className="search-result-icon"><Star size={18} className="fill-amber-400 text-amber-500"/></span><span className="search-result-copy"><strong>{item.truck}</strong><small>{item.label ? `${item.label} · ` : ""}{item.status}</small></span><ChevronRight size={17}/></Link></li>)}</ul>
          <Link href="/portal/saved" className="mt-2 inline-flex min-h-10 items-center gap-1 text-sm font-medium text-brand-500">Open Saved trucks · check them all<ChevronRight size={15}/></Link>
        </>
      ) : <p className="workspace-description">Tap ★ on a truck to keep it here and check it again with one tap.</p>}
    </section>
    <section className="search-history" aria-labelledby="history-title"><div className="app-section-heading"><h2 id="history-title">Recent searches</h2><span className="workspace-count">{total}</span></div><p className="workspace-description">One row per truck. Open a result again at no charge.</p>
      {history.length ? <ul className="search-history-list">{history.map(log => <li key={log.id} className="flex items-center gap-1"><Link href={`/portal/search/${encodeURIComponent(log.truck)}`} className="min-w-0 flex-1"><span className="search-result-icon"><Truck size={20}/></span><span className="search-result-copy"><strong>{log.truck}</strong><small>{log.date}{log.times && log.times > 1 ? ` · searched ${log.times}×` : ""}</small></span><span className={`search-result-status ${log.ok ? "" : "is-failed"}`}>{log.ok ? `${log.crossings} crossing${log.crossings === 1 ? "" : "s"}` : "Not completed"}</span><ChevronRight size={17}/></Link><SaveTruckButton truckNumber={log.truck} saved={Boolean(log.saved)} compact /></li>)}</ul> : <div className="workspace-empty"><span><Search size={29} strokeWidth={1.6}/></span><h3>No searches yet</h3><p>Your searches will appear here after your first lookup.</p></div>}{pager}</section>
    <details className="workspace-explainer"><summary>Good to know<ChevronRight size={17}/></summary><div><p>Enter the number with or without spaces or dashes. Each search uses credits at the current rate.</p><p>Searching a truck does not start automatic tracking. To track it, add it to My trucks and choose an alert. To check it again quickly, tap ★ to save it.</p><Link href="/portal/guide">Read the guide<ArrowUpRight size={15}/></Link></div></details>
  </div>;
}
