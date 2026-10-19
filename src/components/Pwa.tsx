"use client";

import { useCallback, useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

import { buttonClass, cx } from "@/components/ui";
import { isNativeApp, listenForNotificationTaps } from "@/lib/native-app";

/**
 * Registers the service worker.
 *
 * Production only. In development /_next/static is rewritten on every edit, and
 * a worker that serves those from a cache would answer hot reloads with the
 * previous build - which looks exactly like a bug in the code being written.
 */
export function ServiceWorkerRegistrar() {
  // In the Android app, a tapped notification opens the page it was about.
  // Here because this is mounted on every page, signed in or not.
  useEffect(() => listenForNotificationTaps(), []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    // After load, so registration never competes with the first paint.
    const register = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* An install that fails just means no offline notice. Not worth a dialog. */
      });
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}

/* -------------------------------------------------------------------------- */

/** Chrome's install event. Not in TypeScript's DOM library yet. */
type InstallEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED = "pwa-install-dismissed";

/** localStorage throws outright in some privacy modes, so every touch is guarded. */
function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

function isStandalone(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS never matched display-mode until recently and still sets this.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isApple(): boolean {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // An iPad on iOS 13+ reports itself as a Mac; touch points give it away.
  return /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/**
 * One quiet row offering to put the app on the home screen.
 *
 * Two paths, because the platforms do not agree. Chrome fires
 * beforeinstallprompt and lets us open the real installer, so that is one tap.
 * Safari fires nothing and has no API, so iOS gets told where the button is -
 * which matters more there than on Android, since iOS only delivers web push to
 * an app that was added to the home screen.
 *
 * Dismissed once, gone for good: this is worth asking about, not worth asking
 * twice.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    // The Android/iOS app is already on the home screen.
    if (isNativeApp() || isStandalone() || readDismissed()) return;

    if (isApple()) {
      setShowIosHint(true);
      setHidden(false);
      return;
    }

    const onPrompt = (e: Event) => {
      // Keeping the event is the whole point; without this the browser's own
      // mini-infobar is all anyone gets.
      e.preventDefault();
      setEvent(e as InstallEvent);
      setHidden(false);
    };

    const onInstalled = () => setHidden(true);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    setHidden(true);
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* Not remembering is better than not dismissing. */
    }
  }, []);

  const install = useCallback(async () => {
    if (!event) return;
    await event.prompt();
    const { outcome } = await event.userChoice;
    // Accepted or refused, the question has been answered.
    if (outcome === "accepted") setHidden(true);
    else dismiss();
  }, [event, dismiss]);

  if (hidden || (!event && !showIosHint)) return null;

  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-brand-500/30 bg-brand-500/8 px-3 py-2.5">
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
        <Download size={16} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">Add to your home screen</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          {showIosHint ? (
            <>
              Tap <Share size={11} className="inline align-[-1px]" /> Share, then{" "}
              <span className="font-medium">Add to Home Screen</span>.
            </>
          ) : (
            "Opens full screen, like an app. No download."
          )}
        </p>
      </div>

      {event ? (
        <button type="button" onClick={install} className={cx(buttonClass("primary", "sm"), "shrink-0")}>
          Install
        </button>
      ) : null}

      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now"
        className="-mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-faint transition hover:bg-sunken hover:text-ink"
      >
        <X size={16} />
      </button>
    </div>
  );
}
