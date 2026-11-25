"use client";

import { useState } from "react";
import { CheckCircle2, Flag, Loader2, Navigation, PackageCheck, PlayCircle } from "lucide-react";

import type { DriverTripInfo } from "@/lib/live/driver";
import type { TripStatus } from "@/lib/live/shared";

/**
 * The trip behind a driver link (live module, 0079): where to go, what is on
 * board, and one big button for the next step. Hindi first, English below -
 * the driver reads Hindi; the dispatcher who tests the link reads English.
 */

const STATUS_HI: Record<TripStatus, string> = {
  planned: "तैयार / Planned",
  loading: "लोडिंग / Loading",
  in_transit: "रास्ते में / On the way",
  arrived: "पहुँच गए / Reached",
  delivered: "डिलीवर / Delivered",
  cancelled: "रद्द / Cancelled",
};

export function DriverTripCard({
  token,
  trip,
  lastFix,
  onClosed,
}: {
  token: string;
  trip: DriverTripInfo;
  lastFix: { lat: number; lng: number } | null;
  onClosed: (message: string) => void;
}) {
  const [status, setStatus] = useState<TripStatus>(trip.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const next: { action: "started" | "reached" | "delivered"; hi: string; en: string; icon: typeof PlayCircle } | null =
    status === "planned" || status === "loading"
      ? { action: "started", hi: "माल लोड हो गया - ट्रिप शुरू", en: "Loaded - start trip", icon: PlayCircle }
      : status === "in_transit"
        ? { action: "reached", hi: "पहुँच गए", en: "Reached destination", icon: Flag }
        : status === "arrived"
          ? { action: "delivered", hi: "माल उतर गया - डिलीवर", en: "Unloaded - delivered", icon: PackageCheck }
          : null;

  async function send(action: "started" | "reached" | "delivered") {
    if (action === "delivered" && !window.confirm("डिलीवरी पूरी? / Mark delivered?")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/driver/${encodeURIComponent(token)}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, lat: lastFix?.lat, lng: lastFix?.lng, note: note || undefined }),
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: TripStatus; error?: string };
      if (!res.ok || !data.ok || !data.status) {
        setError(data.error ?? "नहीं हुआ, फिर से दबाएँ। / Could not update, try again.");
        return;
      }
      setStatus(data.status);
      if (data.status === "delivered" || data.status === "cancelled") {
        onClosed("Trip delivered. Thank you! / ट्रिप पूरी हुई, धन्यवाद!");
      }
    } catch {
      setError("नेटवर्क नहीं है। / No internet - try again.");
    } finally {
      setBusy(false);
    }
  }

  const dest = [trip.toName, trip.toCity && trip.toName && trip.toName.includes(trip.toCity) ? null : trip.toCity]
    .filter(Boolean)
    .join(", ");
  const navHref =
    trip.destLat != null && trip.destLng != null
      ? `https://www.google.com/maps/dir/?api=1&destination=${trip.destLat},${trip.destLng}`
      : dest
        ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`
        : null;

  return (
    <section className="panel space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-sm font-semibold text-muted">{trip.tripNo}</p>
        <span className="rounded-full border border-line bg-sunken px-2.5 py-0.5 text-xs font-semibold text-ink">{STATUS_HI[status]}</span>
      </div>
      <dl className="space-y-2 text-[15px]">
        {trip.fromName ? (
          <div>
            <dt className="text-xs text-muted">कहाँ से / From</dt>
            <dd className="font-semibold text-strong">{trip.fromName}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted">कहाँ जाना है / To</dt>
          <dd className="text-lg font-bold text-strong">{dest || "-"}</dd>
          {trip.consignee && trip.consignee !== trip.toName ? <dd className="text-sm text-ink">{trip.consignee}</dd> : null}
        </div>
        {trip.material ? (
          <div>
            <dt className="text-xs text-muted">माल / Material</dt>
            <dd className="text-ink">{trip.material}</dd>
          </div>
        ) : null}
        {trip.invoiceNo ? (
          <div>
            <dt className="text-xs text-muted">बिल / Invoice</dt>
            <dd className="font-mono text-ink">{trip.invoiceNo}</dd>
          </div>
        ) : null}
      </dl>

      {navHref ? (
        <a
          href={navHref}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-panel text-base font-semibold text-ink"
        >
          <Navigation size={18} aria-hidden /> रास्ता देखें / Navigate
        </a>
      ) : null}

      {next ? (
        <>
          {next.action === "delivered" ? (
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder="नोट (कोई कमी/टूट-फूट) / Note (optional)"
              className="field"
            />
          ) : null}
          <button
            type="button"
            disabled={busy}
            onClick={() => void send(next.action)}
            className="brand-fill flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl border border-brand-600 bg-brand-500 px-3 text-center text-lg font-bold text-on-brand disabled:opacity-60"
          >
            {busy ? <Loader2 size={22} className="animate-spin" aria-hidden /> : <next.icon size={22} aria-hidden />}
            <span>
              {next.hi}
              <span className="block text-sm font-semibold opacity-90">{next.en}</span>
            </span>
          </button>
        </>
      ) : status === "delivered" ? (
        <p className="flex items-center justify-center gap-2 rounded-2xl border border-good-500/40 bg-good-500/12 px-4 py-3 font-bold text-good-500">
          <CheckCircle2 size={20} aria-hidden /> डिलीवर हो गया / Delivered
        </p>
      ) : null}
      {error ? <p className="text-sm text-bad-500">{error}</p> : null}
    </section>
  );
}
