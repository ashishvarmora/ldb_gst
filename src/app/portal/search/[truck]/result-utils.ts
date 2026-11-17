import { directionLabel } from "@/components/Timeline";
import { fmtDateTime } from "@/lib/format";
import type { TruckEvent } from "@/lib/types";

/** Below this, the newest crossing counts as "on the move". */
export const MOVING_WITHIN_MS = 6 * 60 * 60 * 1000;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A span as people say it: "45m", "4h 13m", "2d 5h". Null for nothing or less. */
export function fmtSpan(ms: number): string | null {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) {
    const h = Math.floor(ms / HOUR);
    const m = Math.floor((ms % HOUR) / MINUTE);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(ms / DAY);
  const h = Math.floor((ms % DAY) / HOUR);
  return h ? `${d}d ${h}h` : `${d}d`;
}

export function msBetween(newer: string | null, older: string | null): number | null {
  if (!newer || !older) return null;
  const a = Date.parse(newer);
  const b = Date.parse(older);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return a - b;
}

/** YYYY-MM-DD in IST, the day a crossing is grouped under. */
export function istDayKey(iso: string | null): string {
  if (!iso) return "unknown";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

export function plazaName(event: Pick<TruckEvent, "loc_name">): string {
  return event.loc_name?.trim() || "Unnamed plaza";
}

/** Pin on the coordinates when the toll network sent them, else a search for the plaza. */
export function mapUrl(event: Pick<TruckEvent, "lat" | "lng" | "loc_name">): string | null {
  const lat = event.lat === null ? NaN : Number(event.lat);
  const lng = event.lng === null ? NaN : Number(event.lng);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return `https://www.google.com/maps?q=${lat},${lng}`;
  }
  if (!event.loc_name?.trim()) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.loc_name.trim())}`;
}

/** The plain wa.me share: no number, so WhatsApp asks who to send it to. */
export function whatsappUrl(truckNumber: string, event: TruckEvent): string {
  const direction = directionLabel(event.direction);
  const text =
    `${truckNumber} was last seen at ${plazaName(event)} on ${fmtDateTime(event.event_time)} IST` +
    (direction ? `, ${direction.toLowerCase()}` : "") +
    ` — via Rahdari https://rahdari.in`;
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}
