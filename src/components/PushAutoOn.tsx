"use client";

import { useEffect } from "react";

import { saveNativePushToken } from "@/app/portal/settings/actions";
import { nativePush, registerNativePush } from "@/lib/native-app";
import {
  PUBLIC_KEY,
  keyToBytes,
  pushSwitchedOff,
  storeSubscription,
  webPushSupported,
} from "@/lib/push-client";

/**
 * Phone notifications are ON by default.
 *
 * The switch in Settings (PushSetup) used to be the only way in, so a customer
 * who never opened Settings never heard about a single crossing. This runs on
 * every signed-in page instead and does what the switch would have done,
 * unless the reader switched notifications off on this device - that refusal
 * is the one thing remembered (see pushSwitchedOff).
 *
 * WHAT IT CAN AND CANNOT DO ON ITS OWN
 *
 *   - The Android app asks for the permission the first time it opens, the
 *     way any app does. Only on a phone that has never been asked: once the
 *     reader has said no, Android reports "prompt-with-rationale" or "denied"
 *     and asking again on every page would be nagging.
 *   - A browser that already has the permission is subscribed silently.
 *   - A browser that has not been asked can only be asked from a tap - Safari
 *     and Firefox refuse anything else outright. So the question goes on the
 *     reader's first tap anywhere, once per device; a dismissal is final here
 *     and the switch in Settings stays the way back.
 *
 * Every failure is silent: the reader did not ask for this, and Settings is
 * where the state of the device is explained.
 */
const ASKED_FLAG = "rahdari-push-asked";

function askedBefore(): boolean {
  try {
    return localStorage.getItem(ASKED_FLAG) === "1";
  } catch {
    return true;
  }
}

function markAsked(): void {
  try {
    localStorage.setItem(ASKED_FLAG, "1");
  } catch {
    /* askedBefore() reads a throwing storage as "asked", so this cannot loop. */
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
  useEffect(() => {
    if (pushSwitchedOff()) return;
    let cancelled = false;
    let removeTapListener: (() => void) | null = null;

    const app = nativePush();
    if (app) {
      if (!appReady) return;
      void (async () => {
        let { receive } = await app
          .checkPermissions()
          .catch(() => ({ receive: "denied" as const }));
        if (receive === "prompt") {
          ({ receive } = await app
            .requestPermissions()
            .catch(() => ({ receive: "denied" as const })));
        }
        if (cancelled || receive !== "granted") return;

        const registered = await registerNativePush(app);
        if (cancelled || !registered.ok) return;
        await saveNativePushToken({ token: registered.token, userAgent: navigator.userAgent });
      })().catch((error) => console.error("push auto-on (app) failed", error));
      return () => {
        cancelled = true;
      };
    }

    if (!platformReady || !PUBLIC_KEY || !webPushSupported()) return;
    if (Notification.permission === "denied") return;

    const subscribe = async () => {
      const registration = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);
      if (cancelled || !registration) return;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyToBytes(PUBLIC_KEY),
        }));
      if (cancelled) return;
      const result = await storeSubscription(subscription);
      // A subscription the server does not hold would leave the device looking
      // set up for ever - the same rule PushSetup keeps.
      if (!result.ok) await subscription.unsubscribe().catch(() => {});
    };

    if (Notification.permission === "granted") {
      void subscribe().catch((error) => console.error("push auto-on failed", error));
    } else if (!askedBefore()) {
      const onTap = () => {
        removeTapListener?.();
        markAsked();
        // Called inside the tap with nothing awaited before it, or Safari
        // treats it as unprompted and refuses without a word.
        void Notification.requestPermission()
          .then((permission) => (permission === "granted" ? subscribe() : undefined))
          .catch((error) => console.error("push auto-on failed", error));
      };
      window.addEventListener("pointerup", onTap, { once: true });
      removeTapListener = () => window.removeEventListener("pointerup", onTap);
    }

    return () => {
      cancelled = true;
      removeTapListener?.();
    };
  }, [platformReady, appReady]);

  return null;
}
