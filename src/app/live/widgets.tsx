"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, MapPin, Share2 } from "lucide-react";

import { buttonClass, cx } from "@/components/ui";
import { useCopy } from "@/components/useCopy";
import { agoShort, mapsHref, osmEmbed } from "@/lib/live/shared";

/** Re-reads the page every `ms` while it is visible (trip detail, dashboard). */
export function AutoRefresh({ ms = 30_000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, ms);
    const onVisible = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ms, router]);
  return null;
}

export function CopyButton({ value, label = "Copy link", className }: { value: string; label?: string; className?: string }) {
  const { copied, problem, copy } = useCopy();
  return (
    <span className="inline-flex flex-col">
      <button type="button" onClick={() => void copy(value)} className={buttonClass("secondary", "sm", className)}>
        {copied ? <Check size={15} className="text-good-500" /> : <Copy size={15} />}
        {copied ? "Copied" : label}
      </button>
      {problem ? <span className="mt-1 text-xs text-bad-500">{problem}</span> : null}
    </span>
  );
}

/** Native share sheet where the phone has one; WhatsApp link otherwise. */
export function ShareButton({ text, title, fallbackHref, label = "Share" }: { text: string; title: string; fallbackHref: string; label?: string }) {
  const [canShare, setCanShare] = useState(false);
  useEffect(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), []);
  if (!canShare) {
    return (
      <a href={fallbackHref} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
        <Share2 size={15} /> {label}
      </a>
    );
  }
  return (
    <button
      type="button"
      className={buttonClass("secondary", "sm")}
      onClick={() => {
        navigator.share({ title, text }).catch(() => undefined);
      }}
    >
      <Share2 size={15} /> {label}
    </button>
  );
}

export type MapTruck = {
  id: string;
  label: string;
  sub: string;
  lat: number;
  lng: number;
  at: string | null;
  tone: "good" | "warn" | "bad" | "neutral";
};

/**
 * The dashboard's map: OpenStreetMap shows one marker per embed, so the list
 * picks which truck the map shows. Free, no key, allowed by the CSP.
 */
export function FleetMap({ trucks }: { trucks: MapTruck[] }) {
  const [selected, setSelected] = useState(trucks[0]?.id ?? null);
  const current = trucks.find((t) => t.id === selected) ?? trucks[0];
  if (!current) return null;
  return (
    <div className="live-fleetmap">
      <div className="live-map-frame">
        <iframe
          key={current.id}
          title={`Map: ${current.label}`}
          src={osmEmbed(current)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
        <a href={mapsHref(current.lat, current.lng)} target="_blank" rel="noopener noreferrer" className="live-map-open">
          <ExternalLink size={13} /> Open in Maps
        </a>
      </div>
      <ul className="live-fleetmap-list" aria-label="Trucks on the map">
        {trucks.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setSelected(t.id)} aria-pressed={t.id === current.id} className={cx(t.id === current.id && "is-on")}>
              <MapPin size={15} className={cx("shrink-0", `live-tone-${t.tone}`)} />
              <span className="min-w-0 flex-1 text-left">
                <strong className="block truncate font-mono text-[13px]">{t.label}</strong>
                <small className="block truncate">{t.sub}</small>
              </span>
              <small className="shrink-0" suppressHydrationWarning>{agoShort(t.at)}</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
