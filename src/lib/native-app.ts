/**
 * Whether this page is running inside the Android or iOS app rather than a
 * browser.
 *
 * The app (mobile/) is this same site in a WebView, and it says so by appending
 * this marker to its user agent - see appendUserAgent in
 * mobile/capacitor.config.json. Client-only: navigator does not exist while a
 * page renders on the server.
 */
export const NATIVE_APP_MARKER = "RahdariApp/";

export function isNativeApp(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes(NATIVE_APP_MARKER);
}
