"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  BellOff,
  BellRing,
  CheckCircle2,
  Loader2,
  Send,
  Share,
} from "lucide-react";

import { removePushSubscription, savePushSubscription, testMyPush } from "./actions";
import { HelpNote } from "@/components/Disclosure";
import { Badge, Mono, buttonClass, cx } from "@/components/ui";

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
  | "no-worker";

const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/**
 * The subscribe call wants the key as bytes, and VAPID keys travel as url-safe
 * base64 - which atob() does not accept: it needs `+` and `/` and the padding.
 *
 * Typed BufferSource and built over an ArrayBuffer this function owns, because
 * applicationServerKey will not take the plain `Uint8Array` a shorter spelling
 * infers - that one may be backed by a SharedArrayBuffer, which cannot be
 * handed to the platform.
 */
function keyToBytes(base64Url: string): BufferSource {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

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
  /** Installs already set up on this account, this one included. */
  savedDevices,
  supportEmail,
}: {
  platformReady: boolean;
  savedDevices: number;
  supportEmail: string;
}) {
  const [state, setState] = useState<DeviceState>("checking");
  /* Only "where do I go to undo a refusal" needs this, and the answer is a
     different screen on each platform. Read once, in the effect, because
     navigator does not exist while this renders on the server. */
  const [apple, setApple] = useState(false);
  const [busy, setBusy] = useState<"on" | "off" | "test" | null>(null);
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
  const endpoint = useRef<string | null>(null);

  /** Flattens the browser's object into the four strings the action takes. */
  const store = useCallback(async (subscription: PushSubscription) => {
    const json = subscription.toJSON();
    return savePushSubscription({
      endpoint: subscription.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
      userAgent: navigator.userAgent,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const onApple = isApple();
      setApple(onApple);

      const supported =
        "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

      if (!supported) {
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
        setState("ready");
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

  const turnOn = useCallback(async () => {
    setNote(null);
    setBusy("on");
    try {
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
  }, [router, store]);

  const turnOff = useCallback(async () => {
    setNote(null);
    setBusy("off");
    try {
      const active = registration.current;
      const subscription = await active?.pushManager.getSubscription();
      const address = subscription?.endpoint ?? endpoint.current;

      // The browser first: it owns the subscription, and a row deleted while
      // the browser still holds one leaves a phone that cannot be re-subscribed
      // because subscribe() would hand back the same endpoint.
      if (subscription) await subscription.unsubscribe().catch(() => {});
      if (address) await removePushSubscription(address);

      endpoint.current = null;
      setState("ready");
      setNote({ ok: true, text: "Notifications are off for this device." });
      router.refresh();
    } finally {
      setBusy(null);
    }
  }, [router]);

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

  return (
    <div className="mt-4 border-t border-divider pt-4">
      <p className="flex items-center gap-1.5 text-xs font-semibold tracking-wider text-muted uppercase">
        <BellRing size={12} />
        Notifications on this phone
      </p>

      {/*
        One row for the whole state, the same shape as the Telegram row above:
        what it is, one line about it, and the button that changes it. On a
        390px screen the button wraps under the badge rather than squeezing the
        text to two characters.
      */}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-line bg-raised/60 px-3 py-2.5">
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <StateBadge state={state} />
          <span className="min-w-0 text-xs leading-relaxed text-muted">
            <StateLine state={state} savedDevices={savedDevices} apple={apple} />
          </span>
        </span>

        {/* Not offered when the platform has no keys. With none, subscribe()
            throws and the officer has tapped a button that could never have
            worked - which is the exact failure this panel exists to replace
            with a sentence. The warning below says whose problem it is. */}
        {state === "ready" && platformReady ? (
          <button
            type="button"
            onClick={turnOn}
            disabled={spinning}
            className={cx(buttonClass("primary", "sm"), "shrink-0")}
          >
            {busy === "on" ? <Loader2 size={13} className="animate-spin" /> : <BellRing size={13} />}
            {busy === "on" ? "Allowing..." : "Turn on"}
          </button>
        ) : null}

        {state === "subscribed" ? (
          <span className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={test}
              disabled={spinning}
              className={buttonClass("primary", "sm")}
            >
              {busy === "test" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Send size={13} />
              )}
              {busy === "test" ? "Sending..." : "Send test"}
            </button>
            <button
              type="button"
              onClick={turnOff}
              disabled={spinning}
              aria-label="Turn notifications off on this device"
              className={buttonClass("secondary", "sm")}
            >
              {busy === "off" ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <BellOff size={13} />
              )}
            </button>
          </span>
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
      {!platformReady ? (
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
              <strong className="text-ink">Turn on</strong>. Allow it when iOS asks.
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
  if (state === "ready") return <Badge tone="warn">off</Badge>;
  // needs-install, needs-ios-update, unsupported, no-worker: nothing this
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
}: {
  state: DeviceState;
  savedDevices: number;
  apple: boolean;
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
      return savedDevices > 0 ? (
        <>
          Not on for this device. {savedDevices} other{savedDevices === 1 ? "" : "s"} set up.
        </>
      ) : (
        <>Alerts can arrive on this device.</>
      );
    case "denied":
      /* Where to go differs by platform and the wording has to as well: an
         officer on Android sent to "iOS Settings" is being sent nowhere. */
      return (
        <span className="text-bad-500">
          Notifications were refused on this device, and a button here cannot undo it.{" "}
          {apple ? (
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
  }
}
