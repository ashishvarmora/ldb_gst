"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BatteryMedium, MapPin, Square, Truck, WifiOff } from "lucide-react";

import { REPORT_EVERY_MS, agoText } from "@/lib/live-location-shared";
import type { DriverTripInfo } from "@/lib/live/driver";
import { DriverTripCard } from "./DriverTripCard";

/**
 * The driver's side: one big Start button, one big Stop button.
 *
 * watchPosition (high accuracy) feeds the latest fix; a fix is sent when the
 * truck has moved 100 m (but not more often than every 12 s), and in any case
 * every 30 s - an unchanged position goes as a heartbeat so the owner sees
 * "Live" while the page is open. Anything that cannot be sent (no signal) is
 * kept in localStorage and flushed when the network returns.
 *
 * A web page cannot report while the phone is locked or the browser is in the
 * background. The page says so plainly and keeps the screen awake with the
 * Wake Lock API where the browser has it.
 */

type Fix = {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  t: number;
};

type Phase = "idle" | "starting" | "sharing" | "stopped" | "denied" | "unsupported" | "revoked";

const MOVE_METERS = 100;
const MIN_GAP_MS = 12_000;
const MAX_QUEUE = 600;
const BATCH = 100;

function metersBetween(a: Fix, b: Fix): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function readStore<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full: the in-memory queue still works */
  }
}

export function DriverShare({
  token,
  truckNumber,
  ownerLabel,
  driverName,
  wasSharing,
  trip = null,
  closed = false,
}: {
  token: string;
  truckNumber: string;
  ownerLabel: string;
  driverName: string | null;
  wasSharing: boolean;
  /** Live-module trip (0079) behind this link, or null for an old truck link. */
  trip?: DriverTripInfo | null;
  /** Trip already delivered/cancelled: nothing to share. */
  closed?: boolean;
}) {
  const QUEUE_KEY = `rx-d-q-${token}`;
  const ON_KEY = `rx-d-on-${token}`;

  const [phase, setPhase] = useState<Phase>("idle");
  const [lastFix, setLastFix] = useState<Fix | null>(null);
  const [lastSentAt, setLastSentAt] = useState<number | null>(null);
  const [queued, setQueued] = useState(0);
  const [online, setOnline] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [wakeLockOn, setWakeLockOn] = useState(false);
  const [, setTick] = useState(0);

  const watchId = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const queue = useRef<Fix[]>([]);
  const latest = useRef<Fix | null>(null);
  const lastQueued = useRef<Fix | null>(null);
  const lastPostAt = useRef(0);
  const sending = useRef(false);
  const consentSent = useRef(false);
  const wakeLock = useRef<WakeLockSentinel | null>(null);
  const sharingRef = useRef(false);

  const persistQueue = useCallback(() => {
    writeStore(QUEUE_KEY, queue.current.length ? queue.current : null);
    setQueued(queue.current.length);
  }, [QUEUE_KEY]);

  const stopWatching = useCallback(() => {
    sharingRef.current = false;
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    setWakeLockOn(false);
  }, []);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<Response | null> => {
      try {
        return await fetch(`/api/driver/${encodeURIComponent(token)}/location`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          keepalive: true,
          cache: "no-store",
        });
      } catch {
        return null;
      }
    },
    [token],
  );

  const flush = useCallback(async () => {
    if (sending.current || !sharingRef.current) return;
    sending.current = true;
    try {
      const batch = queue.current.slice(0, BATCH);
      lastPostAt.current = Date.now();
      const res = await post({ points: batch, consent: !consentSent.current ? true : undefined });
      if (!res) {
        setOnline(false);
        return;
      }
      setOnline(true);
      if (res.ok) {
        consentSent.current = true;
        queue.current = queue.current.slice(batch.length);
        persistQueue();
        setLastSentAt(Date.now());
        setMessage(null);
      } else if (res.status === 410 || res.status === 404) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        stopWatching();
        writeStore(ON_KEY, null);
        setPhase("revoked");
        setMessage(data.error ?? "This link has been stopped.");
      }
      // 429 / 5xx: keep the queue, try again on the next tick.
    } finally {
      sending.current = false;
    }
  }, [ON_KEY, persistQueue, post, stopWatching]);

  const enqueue = useCallback(
    (fix: Fix) => {
      queue.current.push(fix);
      if (queue.current.length > MAX_QUEUE) queue.current = queue.current.slice(-MAX_QUEUE);
      lastQueued.current = fix;
      persistQueue();
    },
    [persistQueue],
  );

  const acquireWakeLock = useCallback(async () => {
    try {
      if (!("wakeLock" in navigator) || document.visibilityState !== "visible") return;
      wakeLock.current = await navigator.wakeLock.request("screen");
      setWakeLockOn(true);
      wakeLock.current.addEventListener("release", () => setWakeLockOn(false));
    } catch {
      setWakeLockOn(false);
    }
  }, []);

  const start = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setPhase("unsupported");
      return;
    }
    setMessage(null);
    setPhase("starting");
    sharingRef.current = true;
    writeStore(ON_KEY, true);

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        const fix: Fix = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          speed: pos.coords.speed ?? null,
          heading: pos.coords.heading ?? null,
          t: pos.timestamp || Date.now(),
        };
        latest.current = fix;
        setLastFix(fix);
        setPhase((p) => (p === "starting" ? "sharing" : p));

        const prev = lastQueued.current;
        const moved = !prev || metersBetween(prev, fix) >= MOVE_METERS;
        if (moved && Date.now() - lastPostAt.current >= MIN_GAP_MS) {
          enqueue(fix);
          void flush();
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stopWatching();
          writeStore(ON_KEY, null);
          setPhase("denied");
        } else {
          setMessage(
            err.code === err.TIMEOUT
              ? "Waiting for GPS... go near a window or outside. / GPS का इंतज़ार..."
              : "GPS not available right now. Turn on Location. / लोकेशन (GPS) चालू करें।",
          );
        }
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 60_000 },
    );

    timer.current = setInterval(() => {
      setTick((t) => t + 1);
      const fix = latest.current;
      // No GPS fix yet: say nothing, or the owner would see "Live" with no position.
      if (!fix) return;
      if (fix !== lastQueued.current) enqueue(fix);
      void flush(); // empty queue = heartbeat
    }, REPORT_EVERY_MS);

    void acquireWakeLock();
  }, [ON_KEY, acquireWakeLock, enqueue, flush, stopWatching]);

  const stop = useCallback(async () => {
    stopWatching();
    writeStore(ON_KEY, null);
    setPhase("stopped");
    await post({ stop: true, points: [] });
  }, [ON_KEY, post, stopWatching]);

  // Restore anything left unsent, and resume if sharing was on when the page closed.
  useEffect(() => {
    queue.current = readStore<Fix[]>(QUEUE_KEY, []);
    setQueued(queue.current.length);
    setOnline(navigator.onLine);
    if (!closed && readStore<boolean>(ON_KEY, false)) start();
    return () => stopWatching();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onOnline = () => {
      setOnline(true);
      void flush();
    };
    const onOffline = () => setOnline(false);
    const onVisible = () => {
      if (document.visibilityState === "visible" && sharingRef.current) {
        void acquireWakeLock();
        void flush();
      }
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [acquireWakeLock, flush]);

  const onTripClosed = useCallback(
    (text: string) => {
      stopWatching();
      writeStore(ON_KEY, null);
      setPhase("revoked");
      setMessage(text);
    },
    [ON_KEY, stopWatching],
  );

  const sharing = phase === "sharing" || phase === "starting";
  const speedKmh = lastFix?.speed != null && lastFix.speed >= 0 ? Math.round(lastFix.speed * 3.6) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-4 bg-page px-4 pt-6 pb-10">
      <header className="flex items-center gap-3">
        <span className="inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-mint text-brand-600">
          <Truck size={22} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted">Truck / ट्रक</p>
          <h1 className="font-mono text-2xl font-bold tracking-wide text-strong">{truckNumber}</h1>
        </div>
      </header>

      {driverName ? (
        <p className="text-[15px] text-ink">
          नमस्ते {driverName} / Hello {driverName}
        </p>
      ) : null}

      <section className="panel space-y-2 p-4 text-[15px] leading-relaxed">
        <p className="text-ink">
          आपकी लोकेशन <strong className="text-strong">{ownerLabel}</strong> के साथ शेयर होगी, जब तक यह पेज खुला
          है और शेयरिंग चालू है। आप कभी भी बंद कर सकते हैं।
        </p>
        <p className="text-sm text-muted">
          Your location will be shared with <strong className="text-strong">{ownerLabel}</strong> while this page is
          open and sharing is ON. You can stop anytime.
        </p>
      </section>

      {trip ? (
        <DriverTripCard
          token={token}
          trip={trip}
          lastFix={lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : null}
          onClosed={onTripClosed}
        />
      ) : null}

      {closed ? (
        <section className="panel p-4 text-center">
          <p className="font-bold text-strong">Trip completed / ट्रिप पूरी</p>
          <p className="mt-1 text-sm text-muted">Nothing is being shared. Thank you! / अब कुछ शेयर नहीं हो रहा। धन्यवाद!</p>
        </section>
      ) : phase === "revoked" ? (
        <section className="panel p-4 text-center">
          <p className="font-bold text-strong">Link stopped / लिंक बंद</p>
          <p className="mt-1 text-sm text-muted">{message ?? "The owner has stopped this link. Nothing is being shared."}</p>
        </section>
      ) : sharing ? (
        <>
          <div className="flex items-center justify-center gap-2 rounded-2xl border border-good-500/40 bg-good-500/12 px-4 py-3 text-good-500">
            <span className="relative inline-flex size-3">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-good-500 opacity-60" />
              <span className="relative inline-flex size-3 rounded-full bg-good-500" />
            </span>
            <span className="font-bold">
              {phase === "starting" ? "Finding GPS... / GPS ढूँढ रहे हैं..." : "Sharing ON / शेयरिंग चालू है"}
            </span>
          </div>

          <dl className="panel grid grid-cols-2 gap-3 p-4 text-sm">
            <div>
              <dt className="text-muted">Last sent / आखिरी भेजा</dt>
              <dd className="font-semibold text-strong">{lastSentAt ? agoText(new Date(lastSentAt).toISOString()) : "--"}</dd>
            </div>
            <div>
              <dt className="text-muted">Accuracy / सटीकता</dt>
              <dd className="font-semibold text-strong">
                {lastFix?.accuracy != null ? `± ${Math.round(lastFix.accuracy)} m` : "--"}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Speed / गति</dt>
              <dd className="font-semibold text-strong">{speedKmh != null ? `${speedKmh} km/h` : "--"}</dd>
            </div>
            <div>
              <dt className="text-muted">Waiting to send / बाकी</dt>
              <dd className="font-semibold text-strong">{queued}</dd>
            </div>
          </dl>

          {!online ? (
            <p className="flex items-center gap-2 rounded-xl border border-warn-500/40 bg-warn-500/12 px-3 py-2 text-sm text-warn-500">
              <WifiOff size={16} aria-hidden /> No internet - positions are saved and will be sent later. / नेटवर्क नहीं
              है, बाद में भेजेंगे।
            </p>
          ) : null}
          {message ? <p className="text-sm text-warn-500">{message}</p> : null}

          <button
            type="button"
            onClick={() => void stop()}
            className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl border border-bad-500/50 bg-bad-500/12 text-lg font-bold text-bad-500 active:scale-[0.99]"
          >
            <Square size={20} aria-hidden /> Stop sharing / शेयरिंग बंद करें
          </button>
        </>
      ) : (
        <>
          {phase === "denied" ? (
            <p className="rounded-xl border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
              Location permission is blocked. Allow Location for this site in your browser settings, then tap Start
              again. / ब्राउज़र सेटिंग में इस साइट के लिए Location की अनुमति दें।
            </p>
          ) : null}
          {phase === "unsupported" ? (
            <p className="rounded-xl border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
              This browser cannot share location. Open the link in Chrome. / यह लिंक Chrome में खोलें।
            </p>
          ) : null}
          {phase === "stopped" ? (
            <p className="rounded-xl border border-line bg-sunken px-3 py-2 text-sm text-muted">
              Sharing stopped. Nothing is being sent. / शेयरिंग बंद है।
            </p>
          ) : wasSharing && phase === "idle" ? (
            <p className="text-sm text-muted">You were sharing earlier. Tap Start to continue. / जारी रखने के लिए Start दबाएँ।</p>
          ) : null}

          <button
            type="button"
            onClick={start}
            className="brand-fill flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl border border-brand-600 bg-brand-500 text-lg font-bold text-on-brand active:scale-[0.99]"
          >
            <MapPin size={22} aria-hidden /> Start sharing location / लोकेशन शेयर करें
          </button>
        </>
      )}

      <section className="space-y-2 text-sm text-muted">
        <p className="flex items-start gap-2">
          <BatteryMedium size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Keep this page open. The screen can be dimmed{wakeLockOn ? " (screen is kept awake)" : ""}. If the phone
            locks or you switch apps, sharing pauses until you come back. / यह पेज खुला रखें। फ़ोन लॉक होने पर
            शेयरिंग रुक जाती है।
          </span>
        </p>
        <p>Keep the phone on charge if you can. / हो सके तो फ़ोन चार्ज पर रखें।</p>
        <p className="text-xs text-faint">
          Only your location, accuracy and speed are sent - nothing else from your phone. Rahdari.
        </p>
      </section>
    </main>
  );
}
