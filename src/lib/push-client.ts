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
 * Notifications are ALWAYS on. There is no switch any more - the owner's rule
 * (30 Oct 2026): the site never offers a way to turn them off; a reader who
 * wants them off blocks them in the browser or the phone's own settings.
 *
 * Devices that used the old switch still carry its "off" flag, which would
 * otherwise keep them silent for ever, so it is wiped wherever push starts.
 */
const LEGACY_OFF_FLAG = "rahdari-push-off";

export function forgetLegacyOffSwitch(): void {
  try {
    localStorage.removeItem(LEGACY_OFF_FLAG);
  } catch {
    /* Nothing reads the flag any more, so failing to remove it costs nothing. */
  }
}
