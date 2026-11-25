"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Crosshair, Loader2, MapPin, Minus, Plus, Search } from "lucide-react";

import { parseLatLng } from "@/lib/live/shared";

import { geocodeAddress } from "./actions";

/**
 * Exact location, three ways (any one is enough):
 *   1. search the address (OpenStreetMap search, on tap only);
 *   2. pick on the map (tap to drop the pin, drag to move the map);
 *   3. paste a Google Maps link or "lat, lng".
 * Also "Use my location" (this phone's GPS). The chosen point is posted as
 * "lat, lng" in `name`; the typed address is posted in `addressName`.
 *
 * The map is plain OpenStreetMap tiles (no library, no key): Web Mercator
 * maths below, pointer events for pan and tap.
 */

const TILE = 256;
const INDIA = { lat: 22.6, lng: 72.4 };

type LL = { lat: number; lng: number };

function project(p: LL, z: number) {
  const s = TILE * 2 ** z;
  const sin = Math.sin((Math.max(-85, Math.min(85, p.lat)) * Math.PI) / 180);
  return { x: ((p.lng + 180) / 360) * s, y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s };
}

function unproject(x: number, y: number, z: number): LL {
  const s = TILE * 2 ** z;
  const lng = (x / s) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / s;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

const fmt = (p: LL) => `${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;

function TileMap({ value, onPick }: { value: LL | null; onPick: (p: LL) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const h = 230;
  const [zoom, setZoom] = useState(value ? 15 : 5);
  const [center, setCenter] = useState<LL>(value ?? INDIA);
  const drag = useRef<{ x: number; y: number; c: { x: number; y: number }; moved: boolean } | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 340));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Follow a point set from outside (search, paste, GPS).
  const key = value ? fmt(value) : "";
  useEffect(() => {
    if (value) {
      setCenter(value);
      setZoom((z) => Math.max(z, 14));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const c = project(center, zoom);
  const left = c.x - w / 2;
  const top = c.y - h / 2;
  const n = 2 ** zoom;
  const tiles: { k: string; src: string; x: number; y: number }[] = [];
  for (let tx = Math.floor(left / TILE); tx <= Math.floor((left + w) / TILE); tx++) {
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + h) / TILE); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      tiles.push({ k: `${zoom}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${zoom}/${wx}/${ty}.png`, x: tx * TILE - left, y: ty * TILE - top });
    }
  }
  const pin = value ? project(value, zoom) : null;

  return (
    <div className="live-picker-map" ref={box} style={{ height: h }}>
      <div
        className="live-picker-surface"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, c, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          const dy = e.clientY - d.y;
          if (!d.moved && Math.hypot(dx, dy) < 5) return;
          d.moved = true;
          setCenter(unproject(d.c.x - dx, d.c.y - dy, zoom));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved) return;
          const r = e.currentTarget.getBoundingClientRect();
          onPick(unproject(left + (e.clientX - r.left), top + (e.clientY - r.top), zoom));
        }}
        onPointerCancel={() => (drag.current = null)}
      >
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={t.k} src={t.src} alt="" width={TILE} height={TILE} draggable={false} style={{ left: t.x, top: t.y }} />
        ))}
        {pin ? (
          <span className="live-picker-pin" style={{ left: pin.x - left, top: pin.y - top }} aria-hidden>
            <MapPin size={26} strokeWidth={2.4} />
          </span>
        ) : null}
      </div>
      <div className="live-picker-zoom">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(18, z + 1))}>
          <Plus size={15} />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(3, z - 1))}>
          <Minus size={15} />
        </button>
      </div>
      <span className="live-picker-credit">© OpenStreetMap</span>
      {!value ? <span className="live-picker-tip">Tap the exact gate to drop the pin</span> : null}
    </div>
  );
}

export function LocationField({
  name,
  addressName,
  defaultLocation = "",
  defaultAddress = "",
  searchExtra,
  label = "Exact location",
  hint,
  onPoint,
}: {
  name: string;
  addressName?: string;
  defaultLocation?: string;
  defaultAddress?: string;
  /** Read at search time and appended to the address (e.g. the place name). */
  searchExtra?: () => string;
  label?: string;
  hint?: string;
  /** Told whenever the chosen point changes (for the ETA estimate). */
  onPoint?: (p: LL | null) => void;
}) {
  const [loc, setLoc] = useState(defaultLocation);
  const [address, setAddress] = useState(defaultAddress);
  const [map, setMap] = useState(false);
  const [msg, setMsg] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [searching, startSearch] = useTransition();
  const [gps, setGps] = useState(false);
  const point = parseLatLng(loc);
  const pointKey = point ? fmt(point) : "";
  useEffect(() => {
    onPoint?.(point);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointKey]);

  function search() {
    const q = [address, searchExtra?.()].filter((x) => x && x.trim()).join(", ");
    setMsg(null);
    startSearch(async () => {
      const res = await geocodeAddress(q);
      if (!res.ok) return setMsg({ tone: "bad", text: res.error });
      setLoc(fmt(res));
      setMap(true);
      setMsg({ tone: "good", text: `Found: ${res.label.slice(0, 90)}. Tap the map to fine-tune.` });
    });
  }

  function here() {
    if (!("geolocation" in navigator)) return setMsg({ tone: "bad", text: "This browser cannot read location." });
    setGps(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc(fmt({ lat: p.coords.latitude, lng: p.coords.longitude }));
        setMsg({ tone: "good", text: `Set to where you are (± ${Math.round(p.coords.accuracy)} m).` });
        setGps(false);
      },
      () => {
        setMsg({ tone: "bad", text: "Could not get location. Allow Location for this site." });
        setGps(false);
      },
      { enableHighAccuracy: true, timeout: 20_000 },
    );
  }

  return (
    <div className="live-loc">
      {addressName ? (
        <div className="live-loc-row">
          <input
            name={addressName}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            maxLength={300}
            placeholder="Address / area, city"
            aria-label="Address"
            className="field min-w-0 flex-1"
          />
          <button type="button" onClick={search} disabled={searching || (address.trim().length < 3 && !searchExtra?.())} className="live-btn-sm">
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find
          </button>
        </div>
      ) : null}
      <span className="field-label mt-2 block">{label}</span>
      <input
        name={name}
        value={loc}
        onChange={(e) => setLoc(e.target.value)}
        placeholder="Google Maps link or lat, lng"
        aria-label={label}
        className="field w-full"
      />
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => setMap((m) => !m)} className="live-btn-sm" aria-expanded={map}>
          <MapPin size={14} /> {map ? "Hide map" : "Pick on map"}
        </button>
        {!addressName && searchExtra ? (
          <button type="button" onClick={search} disabled={searching} className="live-btn-sm">
            {searching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} Find from address
          </button>
        ) : null}
        <button type="button" onClick={here} disabled={gps} className="live-btn-sm">
          {gps ? <Loader2 size={14} className="animate-spin" /> : <Crosshair size={14} />} My location
        </button>
        {point ? <span className="self-center text-[11px] text-good-500">Pinned ✓</span> : null}
      </div>
      {map ? <TileMap value={point} onPick={(p) => { setLoc(fmt(p)); setMsg(null); }} /> : null}
      {msg ? <p className={msg.tone === "good" ? "mt-1 text-[11px] text-good-500" : "mt-1 text-[11px] text-bad-500"}>{msg.text}</p> : null}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}
