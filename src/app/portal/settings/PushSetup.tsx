"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Loader2,
  Send,
  Share,
} from "lucide-react";

import { saveNativePushToken, testMyPush } from "./actions";
import { HelpNote } from "@/components/Disclosure";
import { Badge, Mono, buttonClass, cx } from "@/components/ui";
import {
  isNativeApp,
  nativePush,
  registerNativePush,
  type NativePushPlugin,
} from "@/lib/native-app";
import {
  PUBLIC_KEY,
  forgetLegacyOffSwitch,
  keyToBytes,
  storeSubscription,
  webPushSupported,
} from "@/lib/push-client";

/**
 * Switching on notifications that arrive on the phone itself.
 *
 * THIS COMPONENT'S JOB IS TO DIAGNOSE, NOT TO SUCCEED.
 *
 * Web Push on an iPhone needs four things at once: iOS 16.4 or newer, the site
 * added to the Home Screen, permission granted from a real tap INSIDE that
 * installed copy, and notifications left on for it in iOS Settings. Every one
 * of those failing produces the same experience - a button that appears to do
 * nothing - and two of them cannot be recovered from by tapping it again:
 *
 *   - In a Safari tab, iOS exposes no PushManager at all. There is nothing to
 *     subscribe to and no error to show. It is not a fault to fix, it is a
 *     different app: Share -> Add to Home Screen, and then open THAT icon.
 *   - Once permission has been denied, requestPermission() resolves "denied"
 *     immediately and never prompts again for the life of the install. Only the
 *     OS settings screen can undo it, so a button here is a lie.
 *
 * So the state of this device is on the screen before anything is tapped, and
 * every dead end says which one it is. The test button exists for the same
 * reason: "it is set up" and "it arrives" are separate facts, and this is the
 * one feature whose default failure is silence.
 *
 * Android and desktop Chrome need none of this - they subscribe from a tab -
 * but they share the code, because a state machine with a special case for one
 * platform is a state machine that is wrong on the other one.
 *
 * THE ANDROID APP IS THE ONE EXCEPTION, because it has to be. Its WebView has
 * no Web Push at all, so it registers with Firebase Cloud Messaging through the
 * Capacitor plugin (see src/lib/native-app.ts) and stores a token instead of a
 * subscription. It lands in the same states - ready, subscribed, denied - so
 * everything outside the effect and the two handlers is shared.
 */

/** Every state this device can be in, and there is a message for each. */
type DeviceState =
  | "checking"
  /** Everything is in place and nothing is subscribed yet. */
  | "ready"
  | "subscribed"
  /** The OS or the browser refused. Only its own settings screen can undo it. */
  | "denied"
  /** iOS, in a browser tab. Push is only ever delivered to an installed copy. */
  | "needs-install"
  /** Installed, but the iOS on it is older than 16.4. */
  | "needs-ios-update"
  /** A browser with no Web Push at all. */
  | "unsupported"
  /** No service worker is running, so there is nothing to subscribe with. */
  | "no-worker"
  /** The app without native push: the iPhone app, or an Android build from
      before the plugin. "Add to Home Screen" would be wrong advice there - it
      already is on the Home Screen. */
  | "in-app";

function isApple(): boolean {
  const ua = navigator.userAgent;
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // An iPad on iOS 13+ reports itself as a Mac; touch points give it away.
  return /macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
}

/** Whether this is the installed copy rather than a browser tab. */
function isStandalone(): boolean {
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  // iOS never matched display-mode until recently and still sets this.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

export function PushSetup({
  /** Whether the platform's VAPID keys are all present. False means nothing we
      store here could ever be sent, which is ours to fix and not the reader's. */
  platformReady,
  /** The same for the Android app's channel: whether the FCM keys are present. */
  appReady,
  /** Installs already set up on this account, this one included. */
  savedDevices,
  supportEmail,
}: {
  platformReady: boolean;
  appReady: boolean;
  savedDevices: number;
  supportEmail: string;
}) {
  const [state, setState] = useState<DeviceState>("checking");
  /* Only "where do I go to undo a refusal" needs this, and the answer is a
     different screen on each platform. Read once, in the effect, because
     navigator does not exist while this renders on the server. */
  const [apple, setApple] = useState(false);
  /** Inside the Android app with the push plugin present. Set once, on mount. */
  const [native, setNative] = useState(false);
  const [busy, setBusy] = useState<"on" | "test" | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  /*
   * Held from mount so the click handler can call requestPermission() with
   * nothing awaited in front of it. Safari treats the permission request as
   * part of the tap that started the task, and an `await` before it is enough
   * for it to refuse silently - which is the failure this whole component
   * exists to stop.
   */
  const registration = useRef<ServiceWorkerRegistration | null>(null);
  /** The web subscription's endpoint, or in the app the FCM token. */
  const endpoint = useRef<string | null>(null);
  const plugin = useRef<NativePushPlugin | null>(null);

  const store = storeSubscription;

  useEffect(() => {
    let cancelled = false;

    forgetLegacyOffSwitch();

    (async () => {
      const onApple = isApple();
      setApple(onApple);

      const app = nativePush();
      if (app) {
        plugin.current = app;
        setNative(true);

        const { receive } = await app
          .checkPermissions()
          .catch(() => ({ receive: "prompt" as const }));
        if (cancelled) return;
        if (receive === "denied") {
          setState("denied");
          return;
        }
        /* On by default: a phone that has the permission and was never
           switched off here is registered without a tap. */
        if (receive !== "granted") {
          setState("ready");
          return;
        }

        /*
         * Switched on before: register again and store the token, for the same
         * reason the web branch re-stores its subscription below - FCM rotates
         * tokens on its own schedule, and the row we hold would quietly stop
         * reaching this phone.
         */
        const registered = await registerNativePush(app);
        if (cancelled) return;
        if (!registered.ok) {
          setState("ready");
          return;
        }
        endpoint.current = registered.token;
        setState("subscribed");
        void saveNativePushToken({ token: registered.token, userAgent: navigator.userAgent });
        return;
      }

      if (!webPushSupported()) {
        if (isNativeApp()) {
          setState("in-app");
          return;
        }
        // On iOS the missing piece is almost never the browser - it is that
        // this is a tab. Told apart here because the two have different fixes.
        if (onApple) {
          setState(isStandalone() ? "needs-ios-update" : "needs-install");
        } else {
          setState("unsupported");
        }
        return;
      }

      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }

      /*
       * `ready` rather than getRegistration(), because it waits for a worker
       * that is registering right now - the officer can reach this panel before
       * ServiceWorkerRegistrar's own registration has settled. Raced against a
       * timeout because it never resolves at all when nothing registers, which
       * is every development build: the registrar is production-only, so hot
       * reloads are not answered from a stale cache.
       */
      const active = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8_000)),
      ]);

      if (cancelled) return;

      if (!active) {
        setState("no-worker");
        return;
      }

      registration.current = active;
      const existing = await active.pushManager.getSubscription();
      if (cancelled) return;

      if (!existing) {
        /*
         * On by default. With the permission already given and no refusal
         * remembered on this device, subscribe now rather than show a switch
         * that is off for no reason the reader chose. Without the permission
         * the browser has to ask, and only a tap may ask - so that case stays
         * "ready" and the switch is the tap.
         */
        if (Notification.permission !== "granted" || !PUBLIC_KEY) {
          setState("ready");
          return;
        }
        try {
          const subscription = await active.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: keyToBytes(PUBLIC_KEY),
          });
          if (cancelled) return;
          const result = await store(subscription);
          if (cancelled) return;
          if (!result.ok) {
            await subscription.unsubscribe().catch(() => {});
            setState("ready");
            return;
          }
          endpoint.current = subscription.endpoint;
          setState("subscribed");
        } catch (error) {
          console.error("push auto-subscribe failed", error);
          if (!cancelled) setState("ready");
        }
        return;
      }

      endpoint.current = existing.endpoint;
      setState("subscribed");

      /*
       * Store it again, every time this panel is opened with a live
       * subscription.
       *
       * A browser rotates an endpoint on its own schedule, and when it does,
       * the row we hold points at an install that no longer exists while the
       * phone sits there believing it is subscribed. Nothing would ever arrive
       * and nothing would say so. The browser returning a subscription is the
       * best evidence available that this is the live one, so it is what gets
       * written; if a push service later disagrees it answers 410 and
       * src/lib/push.ts deletes the row.
       *
       * Silent either way. This is not something the reader asked for, so a
       * failure here belongs in the server log, not on their screen.
       */
      void store(existing);
    })();

    return () => {
      cancelled = true;
    };
  }, [store]);

  /** The Android app's half of turnOn: a permission, a token, a row. */
  const turnOnNative = useCallback(
    async (app: NativePushPlugin) => {
      const { receive } = await app.requestPermissions();
      if (receive === "denied") {
        setState("denied");
        return;
      }
      if (receive !== "granted") {
        setNote({ ok: false, text: "Nothing was changed. Tap again when you are ready to allow it." });
        return;
      }

      const registered = await registerNativePush(app);
      if (!registered.ok) {
        setNote({ ok: false, text: registered.error });
        return;
      }

      const result = await saveNativePushToken({
        token: registered.token,
        userAgent: navigator.userAgent,
      });
      if (!result.ok) {
        // Same rule as the web branch: a token the server does not hold must
        // not leave the phone looking set up.
        await app.unregister().catch(() => {});
        setNote({ ok: false, text: result.error });
        return;
      }

      endpoint.current = registered.token;
      setState("subscribed");
      setNote({ ok: true, text: result.message ?? "Notifications are on for this phone." });
      router.refresh();
    },
    [router],
  );

  const turnOn = useCallback(async () => {
    setNote(null);
    setBusy("on");
    try {
      if (plugin.current) {
        await turnOnNative(plugin.current);
        return;
      }

      // First, and with nothing awaited before it. See the note on the ref above.
      const permission = await Notification.requestPermission();

      if (permission === "denied") {
        setState("denied");
        return;
      }
      if (permission !== "granted") {
        // Dismissed rather than refused. The prompt will come back, so this
        // stays on "ready" and says nothing accusatory.
        setNote({ ok: false, text: "Nothing was changed. Tap again when you are ready to allow it." });
        return;
      }

      const active = registration.current ?? (await navigator.serviceWorker.ready);
      registration.current = active;

      const subscription = await active.pushManager.subscribe({
        // Required, and not merely advisory: a subscription that promises no
        // visible notification is refused outright by Chrome, and iOS will
        // revoke a permission whose pushes show nothing.
        userVisibleOnly: true,
        applicationServerKey: keyToBytes(PUBLIC_KEY),
      });

      const result = await store(subscription);
      if (!result.ok) {
        /* The row is what the server sends from, so a subscription it does not
           hold is worse than none: the phone would look set up for ever. Undo
           it rather than leave the two disagreeing. */
        await subscription.unsubscribe().catch(() => {});
        setNote({ ok: false, text: result.error });
        return;
      }

      endpoint.current = subscription.endpoint;
      setState("subscribed");
      setNote({ ok: true, text: result.message ?? "Notifications are on for this device." });
      router.refresh();
    } catch (error) {
      /*
       * subscribe() throws rather than resolving on a bad or absent
       * applicationServerKey, and on iOS it throws when the four Home Screen
       * conditions are not all met. The message is the browser's own and is
       * usually unreadable, so it is not shown.
       */
      console.error("push subscribe failed", error);
      setNote({
        ok: false,
        text: PUBLIC_KEY
          ? "This device would not subscribe. Close the app fully, open it again and try once more."
          : "Notifications are not switched on for this site yet.",
      });
    } finally {
      setBusy(null);
    }
  }, [router, store, turnOnNative]);

  const test = useCallback(async () => {
    setNote(null);
    setBusy("test");
    try {
      const result = await testMyPush();
      setNote({ ok: result.ok, text: result.ok ? (result.message ?? "Sent.") : result.error });
    } finally {
      setBusy(null);
    }
  }, []);

  const spinning = busy !== null;
  /** Whether the channel this device would use has its keys on the platform. */
  const channelReady = native ? appReady : platformReady;

  return (
    <div className="mt-4 border-t border-divider pt-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-muted">
        <BellRing size={12} />
        Notifications on this phone
      </p>

      {/*
        NO OFF SWITCH. The owner's rule (30 Oct 2026): notifications are always
        on and the site offers no way to turn them off - that is the browser's
        or the phone's own setting. What is left is the one control that still
        means something: the tap a browser needs before it will show its
        permission prompt, and once on, a test.
      */}
      <div className="mt-2 rounded-xl border border-line bg-raised/60 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">Alerts on this device</p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted">
              <StateLine
                state={state}
                savedDevices={savedDevices}
                apple={apple}
                native={native}
              />
            </p>
          </div>

          <StateBadge state={state} />
        </div>

        {/* The tap the browser needs to show its permission prompt. Only where
            it can work: a browser with push and a platform with keys. */}
        {state === "ready" ? (
          <button
            type="button"
            onClick={turnOn}
            disabled={spinning || !channelReady}
            className={cx(buttonClass("primary", "sm"), "mt-3 w-full sm:w-auto")}
          >
            {busy === "on" ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}
            Allow notifications
          </button>
        ) : null}

        {/*
          Its own row under the switch rather than beside it. Full width on a
          phone, so the one thing somebody does after switching this on - check
          that it actually buzzes - is a target they cannot miss.
        */}
        {state === "subscribed" ? (
          <button
            type="button"
            onClick={test}
            disabled={spinning}
            className={cx(buttonClass("secondary", "sm"), "mt-3 w-full sm:w-auto")}
          >
            {busy === "test" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Send size={13} />
            )}
            {busy === "test" ? "Sending…" : "Send a test notification"}
          </button>
        ) : null}
      </div>

      {note ? (
        <p
          className={cx(
            "mt-2 flex items-start gap-2 text-xs leading-relaxed",
            note.ok ? "text-good-500" : "text-bad-500",
          )}
        >
          {note.ok ? (
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
          ) : (
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
          )}
          <span>{note.text}</span>
        </p>
      ) : null}

      {/* Ours to fix, not the reader's - the same call as the Telegram token
          line above. Shown whatever this device's own state is: without the
          keys a subscription is stored and never sent to. */}
      {!channelReady ? (
        <p className="mt-2 text-xs leading-relaxed text-warn-500">
          Phone notifications are not switched on yet, so nothing will arrive.
          {supportEmail ? (
            <>
              {" "}
              Let us know at{" "}
              <a href={`mailto:${supportEmail}`} className="underline">
                {supportEmail}
              </a>
              .
            </>
          ) : null}
        </p>
      ) : null}

      {/* The iPhone checklist. A dropdown and not an (i): it is a task somebody
          has to walk, and the reader who needs it has already decided the app
          is broken - which is exactly who an (i) does not reach. */}
      {/* Not in the Android app, where none of it applies. */}
      {native ? null : (
        <HelpNote title="Getting these on an iPhone" className="mt-2">
          <p>
            An iPhone only ever sends notifications to an app that lives on the{" "}
            <strong className="text-ink">Home Screen</strong>, never to a Safari tab, and it needs
            iOS 16.4 or newer.
          </p>
          <ol className="mt-2 space-y-1.5">
            {[
              <>
                In Safari, tap <Share size={11} className="inline align-[-1px]" />{" "}
                <strong className="text-ink">Share</strong>, then{" "}
                <strong className="text-ink">Add to Home Screen</strong>.
              </>,
              <>Open the new icon. Not Safari — the icon.</>,
              <>
                In there, come back to this screen and tap{" "}
                <strong className="text-ink">Allow notifications</strong>. Allow it when iOS asks.
              </>,
              <>
                Tap <strong className="text-ink">Send test</strong>. If it arrives, you are done.
              </>,
              <>
                If it does not: iOS <Mono className="text-[11px]">Settings</Mono> &rsaquo;{" "}
                <Mono className="text-[11px]">Notifications</Mono>, find this app in the list and
                switch it on.
              </>,
            ].map((step, index) => (
              <li key={index} className="flex gap-2">
                <span className="font-mono text-brand-500">{index + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <p className="mt-2">
            Turning it on in Safari and turning it on in the installed icon are two separate
            permissions, so it has to be the icon.
          </p>
        </HelpNote>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: DeviceState }) {
  if (state === "checking") return <Badge tone="neutral">checking</Badge>;
  if (state === "subscribed")
    return (
      <Badge tone="good">
        <CheckCircle2 size={10} />
        on
      </Badge>
    );
  if (state === "denied") return <Badge tone="bad">blocked</Badge>;
  if (state === "ready") return <Badge tone="warn">needs permission</Badge>;
  // needs-install, needs-ios-update, unsupported, no-worker, in-app: nothing this
  // screen can switch on, so none of them wears a warning colour.
  return <Badge tone="neutral">not available</Badge>;
}

/**
 * One line, and it must name the actual obstacle. "Notifications are not
 * available" is what every one of these states used to look like, and it is the
 * message that sends somebody to support.
 */
function StateLine({
  state,
  savedDevices,
  apple,
  native,
}: {
  state: DeviceState;
  savedDevices: number;
  apple: boolean;
  native: boolean;
}) {
  switch (state) {
    case "checking":
      return <>Checking this device.</>;
    case "subscribed":
      return savedDevices > 1 ? (
        <>This device, and {savedDevices - 1} other set up.</>
      ) : (
        <>Alerts will arrive on this device.</>
      );
    case "ready":
      return <>Allow notifications below so truck alerts reach this device.</>;
    case "denied":
      /* Where to go differs by platform and the wording has to as well: an
         officer on Android sent to "iOS Settings" is being sent nowhere. */
      return (
        <span className="text-bad-500">
          Notifications were refused on this device, and a button here cannot undo it.{" "}
          {native ? (
            <>
              Open Android Settings &rsaquo; Apps &rsaquo; Rahdari &rsaquo; Notifications and
              switch them on, then come back.
            </>
          ) : apple ? (
            <>Open iOS Settings &rsaquo; Notifications, find this app and switch it on.</>
          ) : (
            <>
              Allow them again in this browser&apos;s site settings — tap the icon beside the
              address, then Notifications.
            </>
          )}
        </span>
      );
    case "needs-install":
      return (
        <>
          Add this app to your <strong className="text-ink">Home Screen</strong> first — a Safari
          tab is never sent notifications. See below.
        </>
      );
    case "needs-ios-update":
      return <>This needs iOS 16.4 or newer. Update the phone, then come back.</>;
    case "no-worker":
      return <>Still starting up. Close the app fully, open it again and come back.</>;
    case "unsupported":
      return <>This browser cannot show notifications. Telegram alerts still work.</>;
    case "in-app":
      return (
        <>
          {apple
            ? "Notifications aren't in the iPhone app yet."
            : "This version of the app can't show notifications. Update it to the latest."}{" "}
          Telegram alerts still work.
        </>
      );
  }
}
