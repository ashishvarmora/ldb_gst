import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowUpRight, ChevronRight, Clock3, History, MapPin, Search, ShieldCheck, Truck } from "lucide-react";

export type SearchHistoryItem = { id: string | number; truck: string; date: string; crossings: number; ok: boolean };
export function SearchWorkspace({ form, history, total, notice, pager }: { form: ReactNode; history: SearchHistoryItem[]; total: number; notice?: ReactNode; pager?: ReactNode }) {
  return <div className="search-workspace"><header className="workspace-title"><span className="workspace-title-icon app-tone-blue"><Search size={24}/></span><div><p>A number plate is all you need</p><h1>Find a truck</h1></div></header>
    {notice}
    <section className="search-compose" aria-labelledby="search-title"><div className="search-compose-heading"><span className="app-tone-orange"><Truck size={25}/></span><div><h2 id="search-title">Where did it cross?</h2><p>Enter a registration number to see recorded toll crossings.</p></div></div>{form}<p className="search-privacy"><ShieldCheck size={14}/>Toll records, rather than continuous GPS location.</p></section>
    <div className="search-benefits"><span><MapPin size={17}/>Crossing locations</span><span><Clock3 size={17}/>Recorded times</span><span><History size={17}/>Saved results</span></div>
    <section className="search-history" aria-labelledby="history-title"><div className="app-section-heading"><h2 id="history-title">Recent searches</h2><span className="workspace-count">{total}</span></div><p className="workspace-description">Reopen a saved result without another search charge.</p>
      {history.length ? <ul className="search-history-list">{history.map(log => <li key={log.id}><Link href={`/portal/search/${encodeURIComponent(log.truck)}`}><span className="search-result-icon"><Truck size={20}/></span><span className="search-result-copy"><strong>{log.truck}</strong><small>{log.date}</small></span><span className={`search-result-status ${log.ok ? "" : "is-failed"}`}>{log.ok ? `${log.crossings} crossing${log.crossings === 1 ? "" : "s"}` : "Search failed"}</span><ChevronRight size={17}/></Link></li>)}</ul> : <div className="workspace-empty"><span><Search size={29} strokeWidth={1.6}/></span><h3>Your next journey starts here</h3><p>Your searches will appear here after your first lookup.</p></div>}{pager}</section>
    <details className="workspace-explainer"><summary>Good to know<ChevronRight size={17}/></summary><div><p>Spaces and dashes in a registration number are ignored. Searches use credits at the current rate.</p><p>Searching a truck does not start automatic tracking. Add it to My Truck and choose an alert to watch it.</p><Link href="/portal/guide">Explore the quick guide<ArrowUpRight size={15}/></Link></div></details>
  </div>;
}
