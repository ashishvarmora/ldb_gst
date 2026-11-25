"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Crosshair, Loader2, LocateFixed, MapPin, Maximize2, Minimize2, Minus, Plus, Search } from "lucide-react";

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

/**
 * Pan (drag), zoom (+/-, mouse wheel, pinch, double-tap - all anchored where
 * you point), tap to drop the pin, drag the pin to fine-tune, and a full-size
 * toggle for phones. Plain OSM tiles; no library.
 */
function TileMap({ value, onPick }: { value: LL | null; onPick: (p: LL) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(340);
  const [big, setBig] = useState(false);
  const h = big ? 440 : 260;
  const [zoom, setZoom] = useState(value ? 16 : 5);
  const [center, setCenter] = useState<LL>(value ?? INDIA);
  const [pinDrag, setPinDrag] = useState<LL | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ mode: "pan" | "pin" | "pinch"; x: number; y: number; c: { x: number; y: number }; moved: boolean; dist?: number } | null>(null);
  const lastTap = useRef(0);

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
    if (value && !gesture.current) {
      setCenter(value);
      setZoom((z) => Math.max(z, 15));
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
  const shown = pinDrag ?? value;
  const pin = shown ? project(shown, zoom) : null;

  // Wheel zoom without scrolling the page (a passive React listener cannot prevent that).
  const zoomRef = useRef<(dz: number, px?: number, py?: number) => void>(() => undefined);
  useEffect(() => {
    zoomRef.current = zoomAt;
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const t = Date.now();
      if (t - last < 220) return;
      last = t;
      const r = el.getBoundingClientRect();
      zoomRef.current(e.deltaY < 0 ? 1 : -1, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const local = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  /** Zoom by `dz` keeping the map point under (px, py) where it is. */
  const zoomAt = (dz: number, px = w / 2, py = h / 2) => {
    const z2 = Math.min(19, Math.max(3, zoom + dz));
    if (z2 === zoom) return;
    const under = unproject(left + px, top + py, zoom);
    const u2 = project(under, z2);
    setCenter(unproject(u2.x - px + w / 2, u2.y - py + h / 2, z2));
    setZoom(z2);
  };

  return (
    <div className="live-picker-map" ref={box} style={{ height: h }}>
      <div
        className="live-picker-surface"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            gesture.current = { mode: "pinch", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, c, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y) };
            return;
          }
          const onPin = (e.target as HTMLElement).closest?.(".live-picker-pin");
          gesture.current = { mode: onPin ? "pin" : "pan", x: e.clientX, y: e.clientY, c, moved: false };
        }}
        onPointerMove={(e) => {
          if (!pointers.current.has(e.pointerId)) return;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          const g = gesture.current;
          if (!g) return;
          if (g.mode === "pinch" && pointers.current.size === 2) {
            const [a, b] = [...pointers.current.values()];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            const ratio = d / (g.dist || d);
            if (ratio > 1.35 || ratio < 0.74) {
              const mid = local((a.x + b.x) / 2, (a.y + b.y) / 2);
              zoomAt(ratio > 1 ? 1 : -1, mid.x, mid.y);
              g.dist = d;
            }
            return;
          }
          const dx = e.clientX - g.x;
          const dy = e.clientY - g.y;
          if (!g.moved && Math.hypot(dx, dy) < 5) return;
          g.moved = true;
          if (g.mode === "pin") {
            const p = local(e.clientX, e.clientY);
            setPinDrag(unproject(left + p.x, top + p.y + 13, zoom));
          } else {
            setCenter(unproject(g.c.x - dx, g.c.y - dy, zoom));
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          const g = gesture.current;
          if (pointers.current.size > 0) return;
          gesture.current = null;
          if (!g) return;
          if (g.mode === "pin" && pinDrag) {
            onPick(pinDrag);
            setPinDrag(null);
            return;
          }
          if (g.moved || g.mode === "pinch") return;
          const p = local(e.clientX, e.clientY);
          const now = Date.now();
          if (now - lastTap.current < 300) {
            lastTap.current = 0;
            zoomAt(1, p.x, p.y);
            return;
          }
          lastTap.current = now;
          onPick(unproject(left + p.x, top + p.y, zoom));
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          gesture.current = null;
          setPinDrag(null);
        }}
      >
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={t.k} src={t.src} alt="" width={TILE} height={TILE} draggable={false} style={{ left: t.x, top: t.y }} />
        ))}
        {pin ? (
          <span className="live-picker-pin" style={{ left: pin.x - left, top: pin.y - top }} aria-label="Pin - drag to adjust">
            <MapPin size={30} strokeWidth={2.4} />
          </span>
        ) : null}
      </div>
      <div className="live-picker-zoom">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(1)}>
          <Plus size={15} />
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(-1)}>
          <Minus size={15} />
        </button>
        <button type="button" aria-label={big ? "Smaller map" : "Bigger map"} onClick={() => setBig((b) => !b)}>
          {big ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>
        {value ? (
          <button type="button" aria-label="Back to the pin" onClick={() => setCenter(value)}>
            <LocateFixed size={14} />
          </button>
        ) : null}
      </div>
      <span className="live-picker-credit">© OpenStreetMap</span>
      <span className="live-picker-tip">{value ? "Drag the pin to adjust · pinch or scroll to zoom" : "Tap the exact gate to drop the pin"}</span>
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
        {point ? (
          <span className="self-center text-[11px] text-good-500">Pinned ✓</span>
        ) : /^https:\/\//i.test(loc.trim()) ? (
          <span className="self-center text-[11px] text-warn-500">Link kept · pin it on the map for ETA</span>
        ) : null}
      </div>
      {map ? <TileMap value={point} onPick={(p) => { setLoc(fmt(p)); setMsg(null); }} /> : null}
      {msg ? <p className={msg.tone === "good" ? "mt-1 text-[11px] text-good-500" : "mt-1 text-[11px] text-bad-500"}>{msg.text}</p> : null}
      {hint ? <p className="field-hint">{hint}</p> : null}
    </div>
  );
}
