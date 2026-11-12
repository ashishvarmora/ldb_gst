"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, X } from "lucide-react";

import { saveNativePushToken } from "@/app/portal/settings/actions";
import { buttonClass, cx } from "@/components/ui";
import { nativePush, registerNativePush } from "@/lib/native-app";
import {
  PUBLIC_KEY,
  forgetLegacyOffSwitch,
  keyToBytes,
  storeSubscription,
  webPushSupported,
} from "@/lib/push-client";

/**
 * Phone and browser notifications are ALWAYS on, and asked for on every visit.
 *
 * The owner's rule (30 Oct 2026): no switch anywhere on the site, notifications
 * are on by default, and the permission prompt comes up each time the site is
 * opened until it is given. Turning them off is the browser's or the phone's
 * business, never a control of ours.
 *
 * WHAT A PAGE IS ALLOWED TO DO ABOUT THE PROMPT
 *
 *   - Chrome (desktop and Android) shows it when asked on load, so it is asked
 *     on load. Chrome may fold a prompt it thinks unwanted into a bell in the
 *     address bar instead; that is Chrome's call and cannot be overridden.
 *   - Safari and Firefox show it only from a tap. So the first tap anywhere on
 *     the page asks too, and a banner with an "Allow notifications" button
 *     stays on screen until it is given - the tap the browser wants.
 *   - Once refused, no page can ask again; only the browser's site settings
 *     can undo it. The banner then says exactly where that is.
 *   - The Android app asks the system on every open until it is granted.
 *     Android stops showing its dialog after two refusals, so from then on
 *     the app shows its own banner on every open, saying notifications are
 *     off and where in the phone's Settings to turn them on. Coming back
 *     from Settings is noticed and the banner goes away by itself.
 *   - Safari on iPhone has no notifications in an ordinary tab at all - only
 *     once the site is added to the Home Screen and opened from there. Such a
 *     tab gets a banner saying exactly that, rather than silence.
 *
 * The banner's close button hides it for this visit only. It is not an off
 * switch: the next visit asks again.
 */

type Prompt = "none" | "ask" | "blocked" | "app-off" | "ios-install";

/** Safari (or any browser) on an iPhone or iPad, in a tab rather than opened
    from the Home Screen. iPadOS reports itself as a Mac with a touch screen. */
function iosBrowserTab(): boolean {
  const ua = navigator.userAgent;
  const ios =
    /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches;
  return !standalone;
}

const HIDDEN_THIS_VISIT = "rahdari-push-banner-hidden";

function hiddenThisVisit(): boolean {
  try {
    return sessionStorage.getItem(HIDDEN_THIS_VISIT) === "1";
  } catch {
    return false;
  }
}

const COPY: Record<Exclude<Prompt, "none">, { title: string; body: string }> = {
  ask: {
    title: "Turn on truck alerts",
    body: "Get a notification the moment your truck crosses a toll plaza — even when this site is closed.",
  },
  blocked: {
    title: "Notifications are blocked",
    body: "Truck alerts cannot reach this device. Tap the icon beside the address bar, open Notifications and choose Allow, then reload.",
  },
  "app-off": {
    title: "Notifications are off",
    body: "Truck alerts cannot reach this phone. Tap the button below, or open your phone's Settings → Apps → Rahdari → Notifications and turn them on.",
  },
  "ios-install": {
    title: "Get truck alerts on your iPhone",
    body: "iPhone only allows alerts from the Home Screen. Tap Share, then Add to Home Screen, and open Rahdari from there.",
  },
};

export function PushAutoOn({
  platformReady,
  appReady,
}: {
  /** The VAPID keys are present, so a web subscription could be sent to. */
  platformReady: boolean;
  /** The FCM keys are present, so an app token could be sent to. */
  appReady: boolean;
}) {
  const [prompt, setPrompt] = useState<Prompt>("none");
  const cancelled = useRef(false);
  /** In the app: ask Android again. Set once the app path has started. */
  const askApp = useRef<(() => void) | null>(null);

  /** Subscribes this browser and stores it, then says hello once. */
  const subscribe = useCallback(async (greet: boolean) => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    if (cancelled.current || !registration) return;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(PUBLIC_KEY),
      }));
    if (cancelled.current) return;
    const result = await storeSubscription(subscription);
    // A subscription the server does not hold would leave the device looking
    // set up for ever - the same rule PushSetup keeps.
    if (!result.ok) {
      await subscription.unsubscribe().catch(() => {});
      return;
    }
    // Proof on the spot that it works, shown only the moment it was allowed.
    if (greet) {
      await registration
        .showNotification("Notifications are on", {
          body: "Truck alerts will arrive here, even when the site is closed.",
          icon: "/brand/icon-192-v2.png",
          tag: "rahdari-push-welcome",
        })
        .catch(() => {});
    }
  }, []);

  /** Must be called with nothing awaited before it, or Safari refuses silently. */
  const ask = useCallback(() => {
    void Notification.requestPermission()
      .then((permission) => {
        if (cancelled.current) return;
        if (permission === "granted") {
          setPrompt("none");
          return subscribe(true);
        }
        setPrompt(permission === "denied" ? "blocked" : "ask");
      })
      .catch((error) => console.error("push permission request failed", error));
  }, [subscribe]);

  useEffect(() => {
    cancelled.current = false;
    forgetLegacyOffSwitch();
    let removeTapListener: (() => void) | null = null;

    const app = nativePush();
    if (app) {
      if (!appReady) return;
      let registered = false;

      /*
       * `ask`: whether Android may be asked to show its dialog. True on open and
       * from the banner's button; false when merely coming back to the app, so
       * that returning from the phone's Settings checks quietly instead of
       * popping a dialog the reader just dealt with.
       */
      const turnOn = async (ask: boolean) => {
        let { receive } = await app
          .checkPermissions()
          .catch(() => ({ receive: "denied" as const }));
        // Asked on every open until granted. Android itself stops showing the
        // dialog after two refusals; that is the system's limit, not ours, and
        // the banner below is what the reader sees from then on.
        if (receive !== "granted" && ask) {
          ({ receive } = await app
            .requestPermissions()
            .catch(() => ({ receive: "denied" as const })));
        }
        if (cancelled.current) return;
        if (receive !== "granted") {
          if (!hiddenThisVisit()) setPrompt("app-off");
          return;
        }
        setPrompt("none");
        if (registered) return;

        const result = await registerNativePush(app);
        if (cancelled.current || !result.ok) return;
        await saveNativePushToken({ token: result.token, userAgent: navigator.userAgent });
        registered = true;
      };

      const run = (ask: boolean) =>
        void turnOn(ask).catch((error) => console.error("push auto-on (app) failed", error));
      askApp.current = () => run(true);
      run(true);

      // Back from the phone's Settings (or anywhere else): look again.
      const onVisible = () => {
        if (document.visibilityState === "visible" && !registered) run(false);
      };
      document.addEventListener("visibilitychange", onVisible);
      return () => {
        cancelled.current = true;
        askApp.current = null;
        document.removeEventListener("visibilitychange", onVisible);
      };
    }

    /* Before the support check, because on an iPhone tab that check is exactly
       what fails - and a silent page there is how the reader never finds out. */
    if (platformReady && !webPushSupported() && iosBrowserTab()) {
      if (!hiddenThisVisit()) setPrompt("ios-install");
      return;
    }

    if (!platformReady || !PUBLIC_KEY || !webPushSupported()) return;

    if (Notification.permission === "granted") {
      void subscribe(false).catch((error) => console.error("push auto-on failed", error));
    } else if (Notification.permission === "denied") {
      if (!hiddenThisVisit()) setPrompt("blocked");
    } else {
      if (!hiddenThisVisit()) setPrompt("ask");
      // On load, for the browsers that allow it (Chrome)...
      ask();
      // ...and on the first tap, for the ones that only allow it from one.
      const onTap = () => {
        removeTapListener?.();
        if (Notification.permission === "default") ask();
      };
      window.addEventListener("pointerup", onTap, { once: true });
      removeTapListener = () => window.removeEventListener("pointerup", onTap);
    }

    return () => {
      cancelled.current = true;
      removeTapListener?.();
    };
  }, [platformReady, appReady, ask, subscribe]);

  if (prompt === "none") return null;

  const hide = () => {
    try {
      sessionStorage.setItem(HIDDEN_THIS_VISIT, "1");
    } catch {
      /* Hidden for this render only, then. */
    }
    setPrompt("none");
  };

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-sm sm:px-0 sm:pb-0"
    >
      <div className="flex items-start gap-3 rounded-xl border border-line bg-raised p-4 shadow-lg">
        <BellRing size={18} className="mt-0.5 shrink-0 text-brand-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{COPY[prompt].title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">{COPY[prompt].body}</p>
          {prompt === "ask" || prompt === "app-off" ? (
            <button
              type="button"
              onClick={prompt === "ask" ? ask : () => askApp.current?.()}
              className={cx(buttonClass("primary", "sm"), "mt-3 w-full sm:w-auto")}
            >
              {prompt === "ask" ? "Allow notifications" : "Turn on notifications"}
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={hide}
          aria-label="Hide for now"
          className="-m-1 shrink-0 rounded p-1 text-faint transition hover:text-ink"
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );
}
