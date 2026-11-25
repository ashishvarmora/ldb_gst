/**
 * v6: old History / Activity URLs -> the Logbook, keeping their filters.
 * ?driver= / ?truck= / ?place= alone open that driver / truck / warehouse; anything else opens Trips.
 */
export function logbookUrl(sp: Record<string, string | undefined>): string {
  const id = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : "");
  const keep = new URLSearchParams();
  for (const k of ["q", "range", "view", "page"]) if (sp[k]) keep.set(k, String(sp[k]).slice(0, 40));
  const one = [id(sp.driver) && ["drivers", id(sp.driver)], id(sp.truck) && ["trucks", id(sp.truck)], id(sp.place) && ["warehouses", id(sp.place)]].filter(Boolean) as [string, string][];
  if (one.length === 1) {
    const qs = keep.toString();
    return `/live/logbook/${one[0][0]}/${one[0][1]}${qs ? `?${qs}` : ""}`;
  }
  for (const k of ["driver", "truck", "place"]) if (id(sp[k])) keep.set(k, id(sp[k]));
  keep.delete("view");
  const qs = keep.toString();
  return `/live/logbook/trips${qs ? `?${qs}` : ""}`;
}
