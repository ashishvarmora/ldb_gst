import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { loadPlaces, loadVehicles, logLive } from "@/lib/live/server";
import { prettyVehicle } from "@/lib/live/shared";

/** v5: options for the history / activity icon filters (archived masters included, marked). */
export async function loadFilterOptions(ownerId: string) {
  const [drv, vehicles, places] = await Promise.all([
    getSupabaseAdmin().from("live_drivers").select("id,name,archived_at").eq("owner_id", ownerId).eq("kind", "own").order("name").limit(500),
    loadVehicles(ownerId),
    loadPlaces(ownerId, { includeArchived: true }),
  ]);
  if (drv.error) logLive("filter drivers", drv.error);
  const drivers = ((drv.data ?? []) as { id: string; name: string; archived_at: string | null }[]).map((d) => ({ v: d.id, label: `${d.name}${d.archived_at ? " (archived)" : ""}` }));
  return {
    drivers,
    trucks: vehicles.map((v) => ({ v: v.id, label: prettyVehicle(v.number) })),
    places: places.map((p) => ({ v: p.id, label: `${p.name}${p.archived_at ? " (archived)" : ""}` })),
  };
}
