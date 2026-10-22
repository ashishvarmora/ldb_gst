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

/* -------------------------------------------------------------------------- */
/* push notifications in the app                                               */
/* -------------------------------------------------------------------------- */

/**
 * The slice of @capacitor/push-notifications this site uses, typed here because
 * the plugin package lives in mobile/ and not in this project. The app injects
 * it as window.Capacitor.Plugins.PushNotifications into every page it loads
 * from rahdari.in (server.url and allowNavigation in capacitor.config.json).
 */
type PermissionState = "prompt" | "prompt-with-rationale" | "granted" | "denied";
type ListenerHandle = { remove: () => Promise<void> };
/**
 * NOT always a promise. The bridge the app injects (Capacitor's JSExport)
 * returns the handle itself, synchronously; only @capacitor/core wraps it in a
 * promise, and this site does not load core. Calling .then() on it threw on
 * every page of the app, so every call site goes through Promise.resolve().
 */
type MaybeHandle = ListenerHandle | Promise<ListenerHandle>;

export type NativePushPlugin = {
  checkPermissions(): Promise<{ receive: PermissionState }>;
  requestPermissions(): Promise<{ receive: PermissionState }>;
  register(): Promise<void>;
  unregister(): Promise<void>;
  createChannel(channel: {
    id: string;
    name: string;
    description?: string;
    importance?: 1 | 2 | 3 | 4 | 5;
    visibility?: -1 | 0 | 1;
    vibration?: boolean;
  }): Promise<void>;
  addListener(event: "registration", fn: (token: { value: string }) => void): MaybeHandle;
  addListener(event: "registrationError", fn: (error: { error: string }) => void): MaybeHandle;
  addListener(
    event: "pushNotificationActionPerformed",
    fn: (action: { notification: { data?: Record<string, unknown> } }) => void,
  ): MaybeHandle;
};

/**
 * The plugin, or null when this is a browser, an app build from before the
 * plugin was added, or the iPhone app - whose push needs APNs wired into the
 * Xcode project first, and whose token would not be an FCM one until then.
 */
export function nativePush(): NativePushPlugin | null {
  if (!isNativeApp() || !/android/i.test(navigator.userAgent)) return null;
  const capacitor = (window as Window & {
    Capacitor?: { Plugins?: { PushNotifications?: NativePushPlugin } };
  }).Capacitor;
  return capacitor?.Plugins?.PushNotifications ?? null;
}

/** Must match FCM_CHANNEL_ID in src/lib/fcm.ts and the default in AndroidManifest.xml. */
const CHANNEL_ID = "alerts";

/**
 * Registers with FCM and resolves the token.
 *
 * The plugin answers register() through events rather than its promise, so the
 * listeners go on first and come off afterwards. Timed out because a build
 * without google-services.json never answers at all.
 */
export async function registerNativePush(
  plugin: NativePushPlugin,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  // Idempotent: creating a channel that exists only updates its name.
  await plugin
    .createChannel({
      id: CHANNEL_ID,
      name: "Truck alerts",
      description: "Toll crossings and other alerts for your tracked trucks",
      importance: 5,
      visibility: 1,
      vibration: true,
    })
    .catch(() => {});

  const handles: ListenerHandle[] = [];
  try {
    return await new Promise((resolve) => {
      const timer = setTimeout(
        () => resolve({ ok: false, error: "The phone did not answer. Close the app fully and try again." }),
        20_000,
      );
      const finish = (result: { ok: true; token: string } | { ok: false; error: string }) => {
        clearTimeout(timer);
        resolve(result);
      };
      void Promise.resolve()
        .then(() =>
          Promise.all([
            plugin.addListener("registration", (token) => finish({ ok: true, token: token.value })),
            plugin.addListener("registrationError", (error) => {
              console.error("native push registration failed", error?.error);
              finish({ ok: false, error: "This phone could not register for notifications." });
            }),
          ]),
        )
        .then((added) => {
          handles.push(...added);
          return plugin.register();
        })
        .catch((error) => {
          console.error("native push register threw", error);
          finish({ ok: false, error: "This phone could not register for notifications." });
        });
    });
  } finally {
    // After the promise settles, so a handle added late is still removed.
    await Promise.resolve();
    handles.forEach((handle) => void handle.remove().catch(() => {}));
  }
}

/* Whether the officer switched notifications off on this device lives in
   src/lib/push-client.ts (pushSwitchedOff), shared with the browser: on is the
   default everywhere, so only a refusal is remembered. */

/**
 * Tapping a notification opens the app; this sends it to the page the alert
 * was about (the `url` fcm.ts puts in the data). Same-origin paths only, so a
 * payload can never navigate the app somewhere else. Returns a cleanup.
 */
export function listenForNotificationTaps(): () => void {
  const plugin = nativePush();
  if (!plugin) return () => {};

  let handle: ListenerHandle | null = null;
  let cancelled = false;

  // Inside .then() so even a synchronous throw from the bridge lands in the
  // catch below rather than taking down the page - and this runs on every page.
  void Promise.resolve()
    .then(() =>
      plugin.addListener("pushNotificationActionPerformed", (action) => {
        const url = action?.notification?.data?.url;
        if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) {
          window.location.assign(url);
        }
      }),
    )
    .then((added) => {
      if (cancelled) void added.remove();
      else handle = added;
    })
    .catch(() => {});

  return () => {
    cancelled = true;
    void handle?.remove().catch(() => {});
  };
}
