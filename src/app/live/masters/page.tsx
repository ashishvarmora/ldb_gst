import Link from "next/link";
import { ChevronRight, Receipt, Truck, UserRound, Warehouse } from "lucide-react";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireLiveSession } from "@/lib/live/server";

export const metadata = { title: "Live tracking - Masters" };
export const dynamic = "force-dynamic";

/**
 * Masters: the fixed data the account owns - the ONLY place to add / edit /
 * archive our drivers, trucks and warehouses (0082). Trips pick from here.
 * Trips are not here - they are day-to-day work and have their own tab.
 */
async function count(table: string, ownerId: string): Promise<number> {
  let q = getSupabaseAdmin().from(table).select("id", { count: "exact", head: true }).eq("owner_id", ownerId).is("archived_at", null);
  if (table === "live_drivers") q = q.eq("kind", "own");
  const { count: n } = await q;
  return n ?? 0;
}

export default async function MastersPage() {
  const { ownerId } = await requireLiveSession();
  const [places, trucks, drivers] = await Promise.all([count("live_places", ownerId), count("live_vehicles", ownerId), count("live_drivers", ownerId)]);
  const items = [
    { href: "/live/masters/drivers", icon: UserRound, title: "Drivers", sub: "Your drivers, live status and last seen", n: drivers },
    { href: "/live/masters/trucks", icon: Truck, title: "Trucks", sub: "Your trucks and hired trucks", n: trucks },
    { href: "/live/places", icon: Warehouse, title: "Warehouses & places", sub: "Factories, godowns, saved customers", n: places },
  ];
  return (
    <div className="live-page mx-auto max-w-2xl space-y-3">
      <header className="live-page-head">
        <div>
          <h1>Masters</h1>
          <p>The only place to add your drivers, trucks and warehouses. Trips pick from here.</p>
        </div>
      </header>
      <nav className="live-menu" aria-label="Masters">
        {items.map((i) => (
          <Link key={i.href} href={i.href}>
            <span className="live-list-icon">
              <i.icon size={18} />
            </span>
            <span className="min-w-0 flex-1">
              <strong>{i.title}</strong>
              <small>{i.sub}</small>
            </span>
            <span className="live-menu-count">{i.n}</span>
            <ChevronRight size={16} className="text-faint" />
          </Link>
        ))}
      </nav>
      <nav className="live-menu" aria-label="Other">
        <Link href="/live/today">
          <span className="live-list-icon">
            <Receipt size={18} />
          </span>
          <span className="min-w-0 flex-1">
            <strong>Today&apos;s summary</strong>
            <small>Trips in transit, late, e-way bills, deliveries</small>
          </span>
          <ChevronRight size={16} className="text-faint" />
        </Link>
      </nav>
    </div>
  );
}
