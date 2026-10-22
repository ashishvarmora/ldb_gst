/**
 * The browser half of phone notifications, shared by the switch on the
 * settings screens (PushSetup) and the component that switches them on by
 * default (PushAutoOn). Client-only.
 */

import { savePushSubscription } from "@/app/portal/settings/actions";

export const PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";

/**
 * The subscribe call wants the key as bytes, and VAPID keys travel as url-safe
 * base64 - which atob() does not accept: it needs `+` and `/` and the padding.
 *
 * Typed BufferSource and built over an ArrayBuffer this function owns, because
 * applicationServerKey will not take the plain `Uint8Array` a shorter spelling
 * infers - that one may be backed by a SharedArrayBuffer, which cannot be
 * handed to the platform.
 */
export function keyToBytes(base64Url: string): BufferSource {
  const padded = base64Url.padEnd(base64Url.length + ((4 - (base64Url.length % 4)) % 4), "=");
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

/** Flattens the browser's object into the four strings the action takes. */
export function storeSubscription(subscription: PushSubscription) {
  const json = subscription.toJSON();
  return savePushSubscription({
    endpoint: subscription.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
    userAgent: navigator.userAgent,
  });
}

export function webPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/**
 * Notifications are ON unless the reader switched them off on this device.
 *
 * What is remembered is the refusal, not the consent, so an install that has
 * never been touched reads as on - the owner's rule is that every notification
 * starts on. Kept on the device because the switch is per device: turning the
 * phone off must not silence the laptop. localStorage throws in some modes,
 * hence the guards; failing to read it means "on", the default.
 */
const OFF_FLAG = "rahdari-push-off";

export function pushSwitchedOff(): boolean {
  try {
    return localStorage.getItem(OFF_FLAG) === "1";
  } catch {
    return false;
  }
}

export function setPushSwitchedOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(OFF_FLAG, "1");
    else localStorage.removeItem(OFF_FLAG);
  } catch {
    /* Only costs the switch coming back on next time. */
  }
}
