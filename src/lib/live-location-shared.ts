/**
 * Live location (migration 0078) - the parts both the browser and the server
 * need: the JSON shapes the owner card reads, and a few pure helpers. No
 * database access here, so a Client Component may import it.
 */

export type DriverStatus = "invited" | "active" | "stopped" | "revoked";

/** What the owner card shows as the headline state. */
export type LiveState = "none" | "invited" | "live" | "recent" | "stopped";

export type LivePoint = {
  lat: number;
  lng: number;
  accuracy_m: number | null;
  speed_kmh: number | null;
  heading: number | null;
  recorded_at: string;
};

export type LiveDriverView = {
  id: string;
  driver_name: string | null;
  /** Masked: +91 98xxx xx210. The full number never leaves the server except in waHref. */
  phone_masked: string | null;
  owner_label: string | null;
  status: DriverStatus;
  consent_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  link: string;
  /** wa.me link with the invite text prefilled, or null without a phone. */
  wa_href: string | null;
};

export type LiveLocationView = {
  /** false until 0078 is applied - the card then says so instead of erroring. */
  available: boolean;
  state: LiveState;
  driver: LiveDriverView | null;
  latest: LivePoint | null;
  /** Last ~2 hours, newest first, capped. */
  trail: LivePoint[];
  /** Server time, so "x min ago" is not skewed by the viewer's clock. */
  now: string;
};

/** A position this recent, from an active link, counts as Live. */
export const LIVE_WINDOW_MS = 2.5 * 60 * 1000;

/** How often the driver page reports, and how often the owner card re-reads. */
export const REPORT_EVERY_MS = 30_000;

/** Rough box around India (plus a margin), for sanity-checking a fix. */
export const INDIA_BBOX = { minLat: 6, maxLat: 37.6, minLng: 68, maxLng: 97.5 } as const;

export function inIndia(lat: number, lng: number): boolean {
  return (
    lat >= INDIA_BBOX.minLat &&
    lat <= INDIA_BBOX.maxLat &&
    lng >= INDIA_BBOX.minLng &&
    lng <= INDIA_BBOX.maxLng
  );
}

/** "https://www.google.com/maps?q=23.02,72.57" */
export function googleMapsHref(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/**
 * OpenStreetMap's embeddable map, centred on the point with a marker. `spanDeg`
 * is the half-width of the box; 0.01 is roughly a kilometre each way.
 */
export function osmEmbedSrc(lat: number, lng: number, spanDeg = 0.012): string {
  const bbox = [lng - spanDeg * 1.6, lat - spanDeg, lng + spanDeg * 1.6, lat + spanDeg]
    .map((n) => n.toFixed(5))
    .join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/** "just now", "4 min ago", "2 h ago", "3 days ago". */
export function agoText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "never";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "never";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}
