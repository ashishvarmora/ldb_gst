/**
 * Background location for the driver page (/d/<token>) inside the Android app.
 *
 * A browser tab stops reporting when the phone locks. The Rahdari Android app
 * (mobile/) ships @capacitor-community/background-geolocation, which runs a
 * foreground service with an ongoing notification, so fixes keep arriving while
 * the phone is locked. This file is the tiny bridge to it: the app injects the
 * plugin as window.Capacitor.Plugins.BackgroundGeolocation (same pattern as
 * nativePush in native-app.ts - this site does not load @capacitor/core).
 *
 * Posting goes through the native CapacitorHttp plugin when it is there,
 * because Android throttles WebView fetch() after ~5 minutes in the
 * background (plugin README, issue #14).
 */
import { isNativeApp } from "@/lib/native-app";

export type NativeFix = {
  lat: number;
  lng: number;
  accuracy: number | null;
  speed: number | null;
  heading: number | null;
  t: number;
};

type PluginLocation = {
  latitude: number;
  longitude: number;
  accuracy: number;
  bearing: number | null;
  speed: number | null;
  time: number | null;
};

type BgPlugin = {
  /** Via the injected bridge this returns the callback id, sometimes synchronously. */
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (
      position?: PluginLocation | null,
      error?: { code?: string; message?: string } | null,
    ) => void,
  ): string | Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
};

type HttpPlugin = {
  request(options: {
    url: string;
    method: string;
    headers?: Record<string, string>;
    data?: unknown;
  }): Promise<{ status: number; data: unknown }>;
};

type CapWindow = Window & {
  Capacitor?: {
    Plugins?: { BackgroundGeolocation?: BgPlugin; CapacitorHttp?: HttpPlugin };
  };
};

/** Play Store listing (or a direct APK page). TODO(owner): set NEXT_PUBLIC_ANDROID_APP_URL once the app is listed. */
export const ANDROID_APP_URL =
  process.env.NEXT_PUBLIC_ANDROID_APP_URL ||
  "https://play.google.com/store/apps/details?id=in.rahdari.app";
const ANDROID_PACKAGE = "in.rahdari.app";
const DISCLOSED_KEY = "rx-bg-loc-disclosed";

function plugins() {
  if (typeof window === "undefined") return undefined;
  return (window as CapWindow).Capacitor?.Plugins;
}

/** The plugin, or null in a browser / iPhone / an app build from before the plugin. */
export function nativeBgLocation(): BgPlugin | null {
  if (!isNativeApp() || !/android/i.test(navigator.userAgent)) return null;
  return plugins()?.BackgroundGeolocation ?? null;
}

/** Android Chrome (not the app): show the "use the app" hint. */
export function isAndroidBrowser(): boolean {
  return (
    typeof navigator !== "undefined" &&
    /android/i.test(navigator.userAgent) &&
    !isNativeApp()
  );
}

/**
 * Chrome intent link: opens this driver page in the app if installed,
 * otherwise falls back to the store page.
 */
export function openInAppHref(path: string): string {
  const fallback = encodeURIComponent(ANDROID_APP_URL);
  return `intent://rahdari.in${path}#Intent;scheme=https;package=${ANDROID_PACKAGE};S.browser_fallback_url=${fallback};end`;
}

/**
 * Google Play "prominent disclosure": shown in the app before the location
 * permission prompt, once per install (remembered after "Agree").
 */
function disclose(label: string): Promise<boolean> {
  try {
    if (localStorage.getItem(DISCLOSED_KEY) === "1")
      return Promise.resolve(true);
  } catch {
    /* ignore */
  }
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-modal", "true");
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px";
    const box = document.createElement("div");
    box.style.cssText =
      "background:#fff;color:#111;max-width:440px;width:100%;border-radius:16px;padding:18px;font:15px/1.5 system-ui,sans-serif";
    const h = document.createElement("h2");
    h.style.cssText = "font-size:18px;font-weight:700;margin:0 0 8px";
    h.textContent = "Location in the background / बैकग्राउंड में लोकेशन";
    const en = document.createElement("p");
    en.style.margin = "0 0 8px";
    en.textContent =
      `Rahdari collects your location to share this trip's live position with ${label}, ` +
      "even when the app is closed or the phone is locked, until you tap Stop or the link is stopped. " +
      "A notification stays on while sharing. Only location, accuracy, speed and direction are sent.";
    const hi = document.createElement("p");
    hi.style.margin = "0 0 14px";
    hi.textContent =
      `Rahdari आपकी लोकेशन लेता है ताकि इस ट्रिप की लाइव लोकेशन ${label} को दिखे - ऐप बंद होने या ` +
      "फ़ोन लॉक होने पर भी, जब तक आप Stop न दबाएँ या लिंक बंद न हो। शेयरिंग के दौरान एक नोटिफ़िकेशन दिखता रहेगा। " +
      "सिर्फ़ लोकेशन, सटीकता, स्पीड और दिशा भेजी जाती है।";
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:10px";
    const no = document.createElement("button");
    no.type = "button";
    no.textContent = "No thanks / नहीं";
    no.style.cssText =
      "flex:1;min-height:48px;border-radius:12px;border:1px solid #ccc;background:#fff;color:#111;font-weight:600";
    const yes = document.createElement("button");
    yes.type = "button";
    yes.textContent = "Agree / सहमत";
    yes.style.cssText =
      "flex:1;min-height:48px;border-radius:12px;border:0;background:#0e9f6e;color:#fff;font-weight:700";
    const done = (ok: boolean) => {
      wrap.remove();
      if (ok) {
        try {
          localStorage.setItem(DISCLOSED_KEY, "1");
        } catch {
          /* ignore */
        }
      }
      resolve(ok);
    };
    no.onclick = () => done(false);
    yes.onclick = () => done(true);
    row.append(no, yes);
    box.append(h, en, hi, row);
    wrap.append(box);
    document.body.append(wrap);
  });
}

export type NativeWatchError = "declined" | "denied" | "gps-off" | "failed";

/**
 * Starts the native watcher (ongoing notification "Rahdari is sharing your
 * location for <label>"). Resolves the watcher id, or an error kind.
 */
export async function startNativeWatch(
  label: string,
  ownerLabel: string,
  onFix: (fix: NativeFix) => void,
  onError: (kind: NativeWatchError) => void,
): Promise<string | null> {
  const plugin = nativeBgLocation();
  if (!plugin) return null;
  if (!(await disclose(ownerLabel))) {
    onError("declined");
    return null;
  }
  try {
    const id = await Promise.resolve(
      plugin.addWatcher(
        {
          backgroundTitle: "Rahdari - sharing location / लोकेशन शेयर हो रही है",
          backgroundMessage: `Rahdari is sharing your location for ${label}. Open the app to stop.`,
          requestPermissions: true,
          stale: false,
          distanceFilter: 25,
        },
        (pos, err) => {
          if (err) {
            const msg = String(err.message ?? "");
            if (err.code === "NOT_AUTHORIZED")
              onError(/disabled/i.test(msg) ? "gps-off" : "denied");
            else onError("failed");
            return;
          }
          if (!pos) return;
          onFix({
            lat: pos.latitude,
            lng: pos.longitude,
            accuracy: Number.isFinite(pos.accuracy) ? pos.accuracy : null,
            speed: pos.speed ?? null,
            heading: pos.bearing ?? null,
            t: pos.time || Date.now(),
          });
        },
      ),
    );
    return id;
  } catch {
    onError("failed");
    return null;
  }
}

export function stopNativeWatch(id: string | null) {
  if (!id) return;
  void nativeBgLocation()
    ?.removeWatcher({ id })
    .catch(() => {});
}

/** Opens the app's settings page (location permission set to "Don't allow"). */
export function openNativeSettings() {
  void nativeBgLocation()
    ?.openSettings()
    .catch(() => {});
}

/**
 * POST JSON via native CapacitorHttp (not throttled in the background), as a
 * standard Response so callers can treat it like fetch(). Null = no native
 * HTTP; the caller then uses fetch().
 */
export async function nativePostJson(
  path: string,
  body: unknown,
): Promise<Response | null> {
  const http = plugins()?.CapacitorHttp;
  if (!http || !nativeBgLocation()) return null;
  const res = await http.request({
    url: new URL(path, window.location.origin).toString(),
    method: "POST",
    headers: { "Content-Type": "application/json" },
    data: body,
  });
  if (!(res.status >= 200 && res.status <= 599)) throw new Error("network");
  const text =
    typeof res.data === "string" ? res.data : JSON.stringify(res.data ?? {});
  return new Response(res.status === 204 ? null : text, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
}
