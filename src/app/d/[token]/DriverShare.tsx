"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BatteryMedium,
  CheckCircle2,
  CircleAlert,
  Crosshair,
  Gauge,
  HelpCircle,
  Inbox,
  MapPin,
  MapPinOff,
  PauseCircle,
  Send,
  Settings,
  Smartphone,
  Square,
  Truck,
  WifiOff,
} from "lucide-react";

import "@/app/live/live.css";

import { REPORT_EVERY_MS, agoText } from "@/lib/live-location-shared";
import type { DriverTripInfo } from "@/lib/live/driver";
import { DriverTripCard } from "./DriverTripCard";
// [native-app bg location] Android app hand-off - see src/lib/native-bg-location.ts
import {
  isAndroidBrowser,
  nativeBgLocation,
  nativePostJson,
  openInAppHref,
  openNativeSettings,
  startNativeWatch,
  stopNativeWatch,
  disclose,
  nativeTracker,
  type TrackerStatus,
} from "@/lib/native-bg-location";

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
  /** Sharing has ended (one-time driver after his trip): nothing to share. */
  closed?: boolean;
}) {
  const QUEUE_KEY = `rx-d-q-${token}`;
  const ON_KEY = `rx-d-on-${token}`;

  const [phase, setPhase] = useState<Phase>("idle");
  /** v7: the native tracker's view of things, in app builds that have it. */
  const [tracker, setTracker] = useState<TrackerStatus | null>(null);
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
  // [native-app bg location] watcher id while the Android app's background service is used
  const nativeWatch = useRef<string | null>(null);
  const [inApp, setInApp] = useState(false);
  const [androidWeb, setAndroidWeb] = useState(false);

  const persistQueue = useCallback(() => {
    writeStore(QUEUE_KEY, queue.current.length ? queue.current : null);
    setQueued(queue.current.length);
  }, [QUEUE_KEY]);

  const stopWatching = useCallback(() => {
    sharingRef.current = false;
    if (watchId.current !== null) navigator.geolocation?.clearWatch(watchId.current);
    watchId.current = null;
    stopNativeWatch(nativeWatch.current); // [native-app bg location]
    nativeWatch.current = null;
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
    setWakeLockOn(false);
  }, []);

  const post = useCallback(
    async (body: Record<string, unknown>): Promise<Response | null> => {
      try {
        // [native-app bg location] native HTTP is not throttled while the app is in the background
        if (nativeBgLocation()) {
          const res = await nativePostJson(`/api/driver/${encodeURIComponent(token)}/location`, body);
          if (res) return res;
        }
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
    // v7: the native tracker posts by itself, so it survives screen-off, swipe-away and reboot.
    const t = nativeTracker();
    if (t) {
      void (async () => {
        setMessage(null);
        setPhase("starting");
        if (!(await disclose(ownerLabel))) {
          setPhase("idle");
          return;
        }
        try {
          const st = await t.start({
            url: `${window.location.origin}/api/driver/${encodeURIComponent(token)}/location`,
            page: window.location.href,
            label: truckNumber || trip?.tripNo || driverName || "this trip",
            owner: ownerLabel,
          });
          setTracker(st);
          sharingRef.current = true;
          setPhase("sharing");
        } catch (e) {
          setPhase(String((e as Error)?.message ?? e).includes("denied") ? "denied" : "idle");
        }
      })();
      return;
    }
    const native = nativeBgLocation(); // [native-app bg location]
    if (!native && !("geolocation" in navigator)) {
      setPhase("unsupported");
      return;
    }
    setMessage(null);
    setPhase("starting");
    sharingRef.current = true;
    writeStore(ON_KEY, true);

    const onFix = (fix: Fix) => {
      latest.current = fix;
      setLastFix(fix);
      setPhase((p) => (p === "starting" ? "sharing" : p));

      const prev = lastQueued.current;
      const moved = !prev || metersBetween(prev, fix) >= MOVE_METERS;
      if (moved && Date.now() - lastPostAt.current >= MIN_GAP_MS) {
        enqueue(fix);
        void flush();
      }
    };

    if (native) {
      // [native-app bg location] foreground service + ongoing notification; keeps going when locked
      const label = truckNumber || trip?.tripNo || driverName || "this trip";
      void startNativeWatch(label, ownerLabel, onFix, (kind) => {
        if (kind === "gps-off" || kind === "failed") {
          setMessage("GPS nahi mil raha. Location (GPS) chalu karein.");
          if (kind === "failed") return;
        }
        stopWatching();
        writeStore(ON_KEY, null);
        setPhase(kind === "denied" ? "denied" : "idle");
      }).then((id) => {
        if (id && !sharingRef.current) stopNativeWatch(id); // Stop tapped while starting
        else if (id) nativeWatch.current = id;
      });
    } else watchId.current = navigator.geolocation.watchPosition(
      (pos) =>
        onFix({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          speed: pos.coords.speed ?? null,
          heading: pos.coords.heading ?? null,
          t: pos.timestamp || Date.now(),
        }),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          stopWatching();
          writeStore(ON_KEY, null);
          setPhase("denied");
        } else {
          setMessage(
            err.code === err.TIMEOUT
              ? "GPS ka intezaar... khule mein ya khidki ke paas jaayein."
              : "GPS nahi mil raha. Location (GPS) chalu karein.",
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
  }, [ON_KEY, acquireWakeLock, enqueue, flush, stopWatching, truckNumber, trip, driverName, ownerLabel]);

  const stop = useCallback(async () => {
    const t = nativeTracker();
    if (t) {
      await t.stop().catch(() => {});
      sharingRef.current = false;
      setPhase("stopped");
      return;
    }
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
    setInApp(nativeBgLocation() !== null); // [native-app bg location]
    setAndroidWeb(isAndroidBrowser());
    if (!closed && !nativeTracker() && readStore<boolean>(ON_KEY, false)) start();
    return () => stopWatching();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v7: poll the native tracker while the page is open - it runs on its own, this only shows it.
  useEffect(() => {
    const t = nativeTracker();
    if (!t) return;
    let alive = true;
    const read = () =>
      t
        .status()
        .then((st) => {
          if (!alive) return;
          setTracker(st);
          if (st.fix) setLastFix({ lat: st.fix.lat, lng: st.fix.lng, accuracy: st.fix.accuracy, speed: st.fix.speed, heading: null, t: st.fix.t });
          if (st.lastSentAt) setLastSentAt(st.lastSentAt);
          setQueued(st.queued);
          sharingRef.current = st.on;
          setPhase((p) => (st.on ? (p === "starting" && !st.fix ? p : "sharing") : st.error === "link-stopped" ? "revoked" : p === "sharing" || p === "starting" ? "stopped" : p));
        })
        .catch(() => {});
    void read();
    const id = setInterval(() => document.visibilityState === "visible" && void read(), 5_000);
    const onVisible = () => document.visibilityState === "visible" && void read();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
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

  /* Driver-first (0081): a delivered trip does NOT stop sharing. An own
     driver shares until he taps Stop; a one-time driver's link ends by itself
     a while later and the server then answers 410, which stops the page. */
  const onTripClosed = useCallback((text: string) => {
    setMessage(text);
  }, []);

  const sharing = phase === "sharing" || phase === "starting";
  const speedKmh = lastFix?.speed != null && lastFix.speed >= 0 ? Math.round(lastFix.speed * 3.6) : null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 bg-page px-4 pt-5 pb-10">
      <header className="flex items-center gap-3">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-mint text-brand-600">
          <Truck size={20} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] text-muted">{driverName ? `Namaste ${driverName}` : "Location sharing"}</p>
          <h1 className={truckNumber ? "font-mono text-xl font-bold tracking-wide text-strong" : "text-xl font-bold text-strong"}>
            {truckNumber || driverName || "Rahdari"}
          </h1>
        </div>
        <details className="lv-help">
          <summary aria-label="Help">
            <HelpCircle size={20} />
          </summary>
          <div className="lv-help-pop">
            <p>
              <b>Kya share hota hai?</b> Sirf aapki location, accuracy aur speed - aur kuch nahi. Only location, accuracy and speed are sent.
            </p>
            <p>
              <b>Kis ke saath?</b> {ownerLabel}. Aap kabhi bhi Stop daba kar band kar sakte hain.
            </p>
            {inApp ? (
              <p>
                <b>Phone lock ho to?</b> App mein sharing chalti rehti hai, notification dikhega. Band karne ke liye Stop dabayein.
              </p>
            ) : (
              <p>
                <b>Phone lock ho to?</b> Browser mein page khula rakhein - lock hone par sharing ruk jaati hai. Keep this page open.
                {wakeLockOn ? " (Screen on rakhi gayi hai.)" : ""}
              </p>
            )}
            <p>
              <b>Battery:</b> Ho sake to phone charge par rakhein. Keep the phone on charge if you can.
            </p>
          </div>
        </details>
      </header>

      {closed ? (
        <section className="lv-drv-state lv-t-good">
          <CheckCircle2 size={22} aria-hidden />
          <div>
            <p className="lv-drv-head">Trip complete / Trip poori</p>
            <p className="lv-drv-sub">Ab kuch share nahi ho raha. Dhanyavaad! Nothing is being shared.</p>
          </div>
        </section>
      ) : phase === "revoked" ? (
        <section className="lv-drv-state lv-t-neutral">
          <PauseCircle size={22} aria-hidden />
          <div>
            <p className="lv-drv-head">Link band / Link stopped</p>
            <p className="lv-drv-sub">{message ?? "Owner ne yeh link band kar diya. Nothing is being shared."}</p>
          </div>
        </section>
      ) : sharing ? (
        <section className="lv-drv-state lv-t-good">
          <span className="relative inline-flex size-3 shrink-0">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-good-500 opacity-60" />
            <span className="relative inline-flex size-3 rounded-full bg-good-500" />
          </span>
          <div>
            <p className="lv-drv-head">{phase === "starting" ? "GPS dhoond rahe hain..." : "Sharing ON / chalu hai"}</p>
            <p className="lv-drv-sub">{phase === "starting" ? "Finding GPS - khule mein ya khidki ke paas jaayein." : `${ownerLabel} aapki location dekh sakte hain.`}</p>
          </div>
        </section>
      ) : (
        <section className="lv-drv-state lv-t-neutral">
          <MapPinOff size={22} aria-hidden />
          <div>
            <p className="lv-drv-head">Sharing OFF / band hai</p>
            <p className="lv-drv-sub">
              {wasSharing && phase === "idle" ? "Pehle chalu thi - Start dabakar jaari rakhein." : `Start dabayein - location ${ownerLabel} ko jaayegi.`}
            </p>
          </div>
        </section>
      )}

      {!closed && phase !== "revoked" ? (
        sharing ? (
          <>
            <div className="lv-tiles">
              <div className="lv-tile lv-t-good">
                <span className="lv-tile-label">
                  <Send size={12} aria-hidden /> Sent
                </span>
                <strong>{lastSentAt ? agoText(new Date(lastSentAt).toISOString()) : "--"}</strong>
              </div>
              <div className="lv-tile lv-t-brand">
                <span className="lv-tile-label">
                  <Gauge size={12} aria-hidden /> Speed
                </span>
                <strong>{speedKmh != null ? (speedKmh < 4 ? "Ruka" : `${speedKmh}`) : "--"}</strong>
                <small>{speedKmh != null && speedKmh >= 4 ? "km/h" : " "}</small>
              </div>
              <div className="lv-tile lv-t-neutral">
                <span className="lv-tile-label">
                  <Crosshair size={12} aria-hidden /> GPS
                </span>
                <strong>{lastFix?.accuracy != null ? `±${Math.round(lastFix.accuracy)}m` : "--"}</strong>
              </div>
              <div className={queued ? "lv-tile lv-t-warn" : "lv-tile lv-t-neutral"}>
                <span className="lv-tile-label">
                  <Inbox size={12} aria-hidden /> Baaki
                </span>
                <strong>{queued}</strong>
              </div>
            </div>

            {!online ? (
              <p className="flex items-center gap-2 rounded-xl border border-warn-500/40 bg-warn-500/12 px-3 py-2 text-sm text-warn-500">
                <WifiOff size={16} aria-hidden /> Network nahi hai - location save ho rahi hai, baad mein jaayegi.
              </p>
            ) : null}
            {message ? <p className="text-sm text-warn-500">{message}</p> : null}
          </>
        ) : (
          <>
            {phase === "denied" ? (
              <p className="rounded-xl border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
                Location ki permission band hai. Settings mein is site ke liye Location &quot;Allow&quot; karein, phir Start dabayein.
                {inApp ? (
                  <button type="button" onClick={openNativeSettings} className="mt-2 flex min-h-10 items-center gap-1.5 font-semibold underline">
                    <Settings size={15} /> App settings kholein
                  </button>
                ) : null}
              </p>
            ) : null}
            {phase === "unsupported" ? (
              <p className="rounded-xl border border-bad-500/40 bg-bad-500/10 px-3 py-2 text-sm text-bad-500">
                Yeh browser location share nahi kar sakta. Link Chrome mein kholein.
              </p>
            ) : null}
            {phase === "stopped" ? <p className="text-sm text-muted">Sharing band hai. Kuch nahi bheja ja raha.</p> : null}
          </>
        )
      ) : null}

      {!closed && phase !== "revoked" ? (
        sharing ? (
          <button
            type="button"
            onClick={() => void stop()}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl border border-bad-500/50 bg-bad-500/12 text-base font-bold text-bad-500 active:scale-[0.99]"
          >
            <Square size={18} aria-hidden /> Stop sharing / Band karein
          </button>
        ) : (
          <button
            type="button"
            onClick={start}
            className="brand-fill flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl border border-brand-600 bg-brand-500 text-lg font-bold text-on-brand active:scale-[0.99]"
          >
            <MapPin size={22} aria-hidden /> Start sharing / Location bhejein
          </button>
        )
      ) : null}

      {tracker && !closed ? <TrackerChecklist status={tracker} /> : null}

      {trip ? (
        <DriverTripCard token={token} trip={trip} lastFix={lastFix ? { lat: lastFix.lat, lng: lastFix.lng } : null} onClosed={onTripClosed} />
      ) : null}

      {androidWeb && !closed ? (
        /* [native-app bg location] hint: the app keeps sharing when the phone is locked */
        <a href={openInAppHref(`/d/${encodeURIComponent(token)}`)} className="lv-fact">
          <Smartphone size={16} aria-hidden />
          <span>
            <small>Phone lock hone par bhi sharing chahiye?</small>
            <b>Rahdari app mein kholein</b>
          </span>
        </a>
      ) : null}
      <p className="flex items-center justify-center gap-1.5 text-[11px] text-faint">
        <BatteryMedium size={13} aria-hidden /> Phone charge par rakhein · Only location is sent
      </p>
    </main>
  );
}

/**
 * v7: everything that can stop background sharing on an Android phone, with
 * one tap to fix each. Green = fine. Shown in the app only (a browser cannot
 * share in the background at all, so there is nothing to fix there).
 */
function TrackerChecklist({ status }: { status: TrackerStatus }) {
  const t = nativeTracker();
  if (!t) return null;
  const brand = status.autostartBrand;
  const items: { ok: boolean | null; title: string; hint: string; fix: () => unknown }[] = [
    { ok: status.gps, title: "GPS / Location ON", hint: "Phone ki Location chalu karein", fix: () => t.fixGps() },
    { ok: status.background, title: "Location: Allow all the time", hint: "Permissions → Location → \"Allow all the time\"", fix: () => t.fixBackground() },
    { ok: status.battery, title: "Battery: Unrestricted", hint: "Battery saver Rahdari ko band na kare", fix: () => t.fixBattery() },
    { ok: status.notifications, title: "Notifications ON", hint: "Sharing ki notification dikhni chahiye", fix: () => t.fixNotifications() },
    ...(brand
      ? [{ ok: null, title: "Autostart ON", hint: "Is phone mein Autostart / Background start ON karein", fix: () => t.fixAutostart() }]
      : []),
  ];
  const bad = items.filter((i) => i.ok === false).length;
  return (
    <details className="lv-help-list" open={bad > 0 || undefined}>
      <summary>
        {bad ? <CircleAlert size={16} className="text-bad-500" /> : <CheckCircle2 size={16} className="text-good-500" />}
        <span>{bad ? `${bad} setting${bad === 1 ? "" : "s"} theek karein - background sharing ke liye` : "Background sharing ready"}</span>
      </summary>
      <ul>
        {items.map((i) => (
          <li key={i.title}>
            {i.ok === false ? <CircleAlert size={15} className="text-bad-500" /> : i.ok ? <CheckCircle2 size={15} className="text-good-500" /> : <Settings size={15} className="text-muted" />}
            <span className="min-w-0 flex-1">
              <b>{i.title}</b>
              <small>{i.hint}</small>
            </span>
            {i.ok === true ? null : (
              <button type="button" onClick={() => void i.fix()} className="lv-help-fix">
                {i.ok === null ? "Open" : "Fix"}
              </button>
            )}
          </li>
        ))}
        <li>
          <Smartphone size={15} className="text-muted" />
          <span className="min-w-0 flex-1">
            <b>Recent apps mein lock karein</b>
            <small>Recent apps kholein → Rahdari par lock (taala) dabayein</small>
          </span>
        </li>
      </ul>
    </details>
  );
}
