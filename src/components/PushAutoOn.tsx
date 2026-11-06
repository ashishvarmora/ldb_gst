"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BellRing, CheckCircle2, Loader2, X } from "lucide-react";

import { saveNativePushToken, testMyPush } from "@/app/portal/settings/actions";
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
 * The owner's rules (30 Oct and 6 Nov 2026): no switch anywhere on the site;
 * on every platform - the Android app, a browser tab, a Home Screen shortcut -
 * if notifications are not confirmed ON for this device, a banner says so on
 * every open, with the steps to fix it written out. If they are on, nothing is
 * shown. Turning them off is the browser's or the phone's business.
 *
 * WHAT A PAGE IS ALLOWED TO DO, AND THEREFORE WHAT EACH BANNER SAYS
 *
 *   ask        Never asked yet. Chrome shows the prompt on load; Safari and
 *              Firefox only from a tap, so the first tap anywhere asks too and
 *              the banner's button is that tap.
 *   blocked    Refused in the browser. No page can ask again; only the
 *              browser's (or phone's) settings can undo it, so the banner
 *              gives the exact path for this platform.
 *   app-off    The Android app without permission. Android stops showing its
 *              dialog after two refusals, so the banner gives the Settings path.
 *   ios-tab    Safari on iPhone has no notifications in an ordinary tab - only
 *              from a Home Screen icon. The banner says how to add one.
 *   unsupported A browser with no notifications at all (most often the browser
 *              inside WhatsApp, Instagram or Telegram). Open it in Chrome.
 *   broken     Allowed, but this device could not be connected. Retry.
 *   on         Turned on during this visit: proof it works, a test button.
 *
 * Coming back to the page (from the phone's Settings, say) checks again, so a
 * banner that is no longer true goes away by itself.
 *
 * The close button hides a banner for this visit only. It is not an off
 * switch: the next open shows it again.
 */

type Prompt =
  | "none"
  | "ask"
  | "blocked"
  | "app-off"
  | "ios-tab"
  | "unsupported"
  | "broken"
  | "on";

/** Where this page is running, which decides the steps a banner gives. */
type Where = "app" | "ios-home" | "ios-tab" | "android-home" | "android" | "desktop";

function where(): Where {
  if (nativePush()) return "app";
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches;
  if (ios) return standalone ? "ios-home" : "ios-tab";
  if (/android/i.test(ua)) return standalone ? "android-home" : "android";
  return "desktop";
}

const HIDDEN_THIS_VISIT = "rahdari-push-banner-hidden";

function hiddenThisVisit(): boolean {
  try {
    return sessionStorage.getItem(HIDDEN_THIS_VISIT) === "1";
  } catch {
    return false;
  }
}

/** The title and the steps for each banner. Steps are short and literal - the
    names of the buttons a reader will actually see. */
function copy(prompt: Exclude<Prompt, "none">, at: Where): { title: string; steps: string[] } {
  switch (prompt) {
    case "ask":
      return {
        title: "Turn on truck alerts",
        steps: [
          "Tap \"Allow notifications\" below.",
          "In the box that opens, choose Allow.",
          "Alerts then arrive here even when the site is closed.",
        ],
      };
    case "blocked":
      if (at === "ios-home") {
        return {
          title: "Notifications are blocked",
          steps: [
            "Open your iPhone's Settings → Notifications.",
            "Tap Rahdari and turn on Allow Notifications.",
            "Come back to Rahdari.",
          ],
        };
      }
      if (at === "android-home") {
        return {
          title: "Notifications are blocked",
          steps: [
            "Press and hold the Rahdari icon on your home screen, then tap App info (ⓘ).",
            "Tap Notifications and turn them on.",
            "Come back to Rahdari.",
          ],
        };
      }
      if (at === "android") {
        return {
          title: "Notifications are blocked",
          steps: [
            "Tap the icon to the left of rahdari.in in the address bar.",
            "Tap Permissions (or Site settings) → Notifications → Allow.",
            "Reload this page.",
          ],
        };
      }
      return {
        title: "Notifications are blocked",
        steps: [
          "Click the icon to the left of rahdari.in in the address bar.",
          "Find Notifications and choose Allow.",
          "Reload this page.",
        ],
      };
    case "app-off":
      return {
        title: "Notifications are off",
        steps: [
          "Tap \"Turn on notifications\" below and choose Allow.",
          "If nothing opens: phone Settings → Apps → Rahdari → Notifications → turn on.",
          "Come back to the app.",
        ],
      };
    case "ios-tab":
      return {
        title: "Get truck alerts on your iPhone",
        steps: [
          "In Safari, tap the Share button (square with an arrow).",
          "Tap Add to Home Screen, then Add.",
          "Open Rahdari from the new Home Screen icon, sign in and tap Allow.",
        ],
      };
    case "unsupported":
      return {
        title: "This browser cannot show alerts",
        steps: [
          at === "android"
            ? "Tap ⋮ (top right) and choose Open in Chrome."
            : "Open rahdari.in in Chrome, Edge or Safari.",
          "Sign in there and choose Allow when asked.",
          ...(at === "android" ? ["Or download the Rahdari Android app from the home page."] : []),
        ],
      };
    case "broken":
      return {
        title: "Notifications could not connect",
        steps: [
          "Check this phone has internet, then tap \"Try again\".",
          "If it keeps failing, reload the page.",
        ],
      };
    case "on":
      return {
        title: "Notifications are on",
        steps: ["Truck alerts will arrive on this device. Send a test to see one now."],
      };
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
  const [at, setAt] = useState<Where>("desktop");
  const [testing, setTesting] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const cancelled = useRef(false);
  /** This device is subscribed and the server holds it - nothing left to do. */
  const connected = useRef(false);
  /** Re-runs the check for this platform, asking if `ask` is true. */
  const recheck = useRef<((ask: boolean) => void) | null>(null);

  /** Shows a problem banner unless the reader closed one this visit. */
  const show = useCallback((next: Prompt) => {
    if (next === "none" || next === "on" || !hiddenThisVisit()) setPrompt(next);
  }, []);

  /** Subscribes this browser and stores it. True when the server holds it. */
  const subscribe = useCallback(async (): Promise<boolean> => {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
    ]);
    if (cancelled.current || !registration) return false;
    const subscription =
      (await registration.pushManager.getSubscription()) ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(PUBLIC_KEY),
      }));
    if (cancelled.current) return false;
    const result = await storeSubscription(subscription);
    // A subscription the server does not hold would leave the device looking
    // set up for ever - the same rule PushSetup keeps.
    if (!result.ok) {
      await subscription.unsubscribe().catch(() => {});
      return false;
    }
    return true;
  }, []);

  /** Must be called with nothing awaited before it, or Safari refuses silently. */
  const askWeb = useCallback(() => {
    void Notification.requestPermission()
      .then(async (permission) => {
        if (cancelled.current) return;
        if (permission !== "granted") {
          show(permission === "denied" ? "blocked" : "ask");
          return;
        }
        const ok = await subscribe().catch(() => false);
        if (cancelled.current) return;
        connected.current = ok;
        setPrompt(ok ? "on" : "broken");
      })
      .catch((error) => console.error("push permission request failed", error));
  }, [show, subscribe]);

  useEffect(() => {
    cancelled.current = false;
    forgetLegacyOffSwitch();
    const place = where();
    setAt(place);
    let removeTapListener: (() => void) | null = null;
    connected.current = false;

    const app = nativePush();
    if (app) {
      if (!appReady) return;

      /*
       * `ask`: whether Android may be asked to show its dialog. True on open
       * and from the banner's button; false when merely coming back to the app,
       * so returning from the phone's Settings checks quietly instead of popping
       * a dialog the reader just dealt with.
       */
      const turnOn = async (ask: boolean) => {
        let { receive } = await app
          .checkPermissions()
          .catch(() => ({ receive: "denied" as const }));
        const wasOff = receive !== "granted";
        // Asked on every open until granted. Android itself stops showing the
        // dialog after two refusals; the banner is what is left after that.
        if (wasOff && ask) {
          ({ receive } = await app
            .requestPermissions()
            .catch(() => ({ receive: "denied" as const })));
        }
        if (cancelled.current) return;
        if (receive !== "granted") return show("app-off");
        if (connected.current) return;

        const result = await registerNativePush(app);
        if (cancelled.current) return;
        const saved = result.ok
          ? await saveNativePushToken({ token: result.token, userAgent: navigator.userAgent }).catch(
              () => null,
            )
          : null;
        if (cancelled.current) return;
        connected.current = Boolean(saved?.ok);
        if (!connected.current) return show("broken");
        // Only worth a word when it has just been switched on.
        setPrompt(wasOff ? "on" : "none");
      };

      recheck.current = (ask) =>
        void turnOn(ask).catch((error) => console.error("push auto-on (app) failed", error));
    } else if (!platformReady) {
      // Our keys are missing - nothing the reader can do, so nothing is shown.
      return;
    } else if (!webPushSupported()) {
      show(place === "ios-tab" ? "ios-tab" : "unsupported");
      return;
    } else {
      recheck.current = (ask) => {
        const permission = Notification.permission;
        if (permission === "granted") {
          if (connected.current) return;
          void subscribe()
            .then((ok) => {
              if (cancelled.current) return;
              connected.current = ok;
              setPrompt((current) => (ok ? (current === "on" ? "on" : "none") : current));
              if (!ok) show("broken");
            })
            .catch((error) => {
              console.error("push auto-on failed", error);
              show("broken");
            });
          return;
        }
        if (permission === "denied") return show("blocked");
        show("ask");
        if (!ask) return;
        // On load, for the browsers that allow it (Chrome)...
        askWeb();
        // ...and on the first tap, for the ones that only allow it from one.
        removeTapListener?.();
        const onTap = () => {
          removeTapListener?.();
          if (Notification.permission === "default") askWeb();
        };
        window.addEventListener("pointerup", onTap, { once: true });
        removeTapListener = () => window.removeEventListener("pointerup", onTap);
      };
    }

    recheck.current?.(true);

    // Back from the phone's or browser's settings (or anywhere else): look again.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !connected.current) recheck.current?.(false);
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled.current = true;
      recheck.current = null;
      removeTapListener?.();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [platformReady, appReady, askWeb, show, subscribe]);

  const sendTest = useCallback(async () => {
    setNote(null);
    setTesting(true);
    try {
      const result = await testMyPush();
      setNote({ ok: result.ok, text: result.ok ? (result.message ?? "Sent.") : result.error });
    } catch {
      setNote({ ok: false, text: "The test could not be sent. Please try again." });
    } finally {
      setTesting(false);
    }
  }, []);

  if (prompt === "none") return null;

  const hide = () => {
    try {
      // "on" is good news, so closing it should not hide a later problem.
      if (prompt !== "on") sessionStorage.setItem(HIDDEN_THIS_VISIT, "1");
    } catch {
      /* Hidden for this render only, then. */
    }
    setPrompt("none");
  };

  const { title, steps } = copy(prompt, at);
  const action =
    prompt === "ask"
      ? { label: "Allow notifications", run: askWeb }
      : prompt === "app-off"
        ? { label: "Turn on notifications", run: () => recheck.current?.(true) }
        : prompt === "broken"
          ? { label: "Try again", run: () => recheck.current?.(true) }
          : prompt === "on"
            ? { label: testing ? "Sending…" : "Send a test notification", run: sendTest }
            : null;

  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:bottom-4 sm:left-auto sm:right-4 sm:max-w-sm sm:px-0 sm:pb-0"
    >
      <div className="flex items-start gap-3 rounded-xl border border-line bg-raised p-4 shadow-lg">
        {prompt === "on" ? (
          <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-good-500" />
        ) : (
          <BellRing size={18} className="mt-0.5 shrink-0 text-brand-500" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">{title}</p>
          {steps.length === 1 ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{steps[0]}</p>
          ) : (
            <ol className="mt-1.5 space-y-1">
              {steps.map((step, index) => (
                <li key={index} className="flex gap-2 text-xs leading-relaxed text-muted">
                  <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-full bg-brand-500/12 text-[10px] font-semibold tabular-nums text-brand-500">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
          {action ? (
            <button
              type="button"
              onClick={action.run}
              disabled={testing}
              className={cx(buttonClass("primary", "sm"), "mt-3 w-full sm:w-auto")}
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : null}
              {action.label}
            </button>
          ) : null}
          {note ? (
            <p className={cx("mt-2 text-xs", note.ok ? "text-good-500" : "text-bad-500")}>
              {note.text}
            </p>
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
