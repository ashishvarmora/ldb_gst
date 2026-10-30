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
 *
 * The banner's close button hides it for this visit only. It is not an off
 * switch: the next visit asks again.
 */

type Prompt = "none" | "ask" | "blocked";

const HIDDEN_THIS_VISIT = "rahdari-push-banner-hidden";

function hiddenThisVisit(): boolean {
  try {
    return sessionStorage.getItem(HIDDEN_THIS_VISIT) === "1";
  } catch {
    return false;
  }
}

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
          icon: "/icon-192.png",
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
      void (async () => {
        let { receive } = await app
          .checkPermissions()
          .catch(() => ({ receive: "denied" as const }));
        // Asked on every open until granted. Android itself stops showing the
        // dialog after two refusals; that is the system's limit, not ours.
        if (receive !== "granted") {
          ({ receive } = await app
            .requestPermissions()
            .catch(() => ({ receive: "denied" as const })));
        }
        if (cancelled.current || receive !== "granted") return;

        const registered = await registerNativePush(app);
        if (cancelled.current || !registered.ok) return;
        await saveNativePushToken({ token: registered.token, userAgent: navigator.userAgent });
      })().catch((error) => console.error("push auto-on (app) failed", error));
      return () => {
        cancelled.current = true;
      };
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
          <p className="text-sm font-medium text-ink">
            {prompt === "ask" ? "Turn on truck alerts" : "Notifications are blocked"}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {prompt === "ask"
              ? "Get a notification the moment your truck crosses a toll plaza — even when this site is closed."
              : "Truck alerts cannot reach this device. Tap the icon beside the address bar, open Notifications and choose Allow, then reload."}
          </p>
          {prompt === "ask" ? (
            <button
              type="button"
              onClick={ask}
              className={cx(buttonClass("primary", "sm"), "mt-3 w-full sm:w-auto")}
            >
              Allow notifications
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
