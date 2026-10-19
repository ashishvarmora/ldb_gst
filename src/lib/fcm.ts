import { env } from "@/lib/env";
import { getGoogleAccessToken } from "@/lib/google-auth";

/**
 * Notifications to the Android/iOS app, over Firebase Cloud Messaging HTTP v1.
 *
 * The app (mobile/) is the site in a WebView, and a WebView has no Web Push, so
 * the app registers with FCM through @capacitor/push-notifications and hands
 * the page a registration token. That token is stored in push_subscriptions
 * with kind 'fcm' (migration 0058) and sendPushToUser() in push.ts routes each
 * row to web-push or here.
 *
 * Free, like the rest of the phone channel: FCM has no per-message charge. The
 * only setup is a Firebase project and one of its service accounts - see
 * mobile/README.md.
 *
 * As in push.ts, the token never reaches a log: it is a bearer credential for
 * that phone's notifications.
 */

const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const TIMEOUT_MS = 15_000;

/**
 * The Android notification channel the app creates (PushSetup.tsx) and the
 * manifest names as the default. High importance, so an alert heads up on the
 * screen rather than sitting silently in the shade.
 */
export const FCM_CHANNEL_ID = "alerts";

export function fcmConfigured(): boolean {
  return Boolean(env.fcmProjectId && env.fcmClientEmail && env.fcmPrivateKey);
}

export type FcmDelivery = { ok: true } | { ok: false; error: string; gone?: boolean };

export async function sendFcm(
  token: string,
  payload: { title: string; body: string; tag?: string; url?: string },
): Promise<FcmDelivery> {
  const auth = await getGoogleAccessToken({
    email: env.fcmClientEmail,
    key: env.fcmPrivateKey,
    scope: SCOPE,
    keyName: "FCM_PRIVATE_KEY",
  });
  if (!auth.ok) {
    console.error("[fcm] could not get an access token:", auth.error);
    return { ok: false, error: "The app notification service could not be signed in to." };
  }

  // FCM's data map is strings only. The app reads `url` when the notification
  // is tapped - see the action listener in src/lib/native-app.ts.
  const data: Record<string, string> = {};
  if (payload.url) data.url = payload.url;
  if (payload.tag) data.tag = payload.tag;

  const message = {
    token,
    notification: { title: payload.title, body: payload.body },
    data,
    android: {
      // Same reasoning as the Web Push options in push.ts: worth waking a
      // dozing phone for, worthless after six hours.
      priority: "HIGH",
      ttl: `${6 * 3600}s`,
      notification: {
        channel_id: FCM_CHANNEL_ID,
        // Collapses repeats for one truck, like the web notification's tag.
        ...(payload.tag ? { tag: payload.tag } : {}),
      },
    },
    apns: {
      headers: { "apns-priority": "10" },
      payload: { aps: { sound: "default", ...(payload.tag ? { "thread-id": payload.tag } : {}) } },
    },
  };

  let response: Response;
  try {
    response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(env.fcmProjectId)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${auth.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message }),
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error("[fcm] send failed:", text);
    return { ok: false, error: text };
  }

  if (response.ok) return { ok: true };

  const body = (await response.json().catch(() => null)) as {
    error?: { status?: string; message?: string; details?: { errorCode?: string }[] };
  } | null;
  const code =
    body?.error?.details?.find((detail) => detail?.errorCode)?.errorCode ?? body?.error?.status;

  /*
   * UNREGISTERED (HTTP 404) is FCM's "this install is gone": the app was
   * removed, its data cleared, or the token rotated. Like a 410 from a web push
   * service it never recovers, so the caller deletes the row. A 400
   * INVALID_ARGUMENT is ambiguous - a malformed token or a malformed message -
   * and is only treated as gone when FCM says the token is the problem.
   */
  if (
    response.status === 404 ||
    code === "UNREGISTERED" ||
    (code === "INVALID_ARGUMENT" && /registration token/i.test(body?.error?.message ?? ""))
  ) {
    return { ok: false, gone: true, error: "This device is no longer registered." };
  }

  console.error(`[fcm] send rejected with HTTP ${response.status} (${code ?? "no code"})`);
  return {
    ok: false,
    error:
      response.status === 401 || response.status === 403 || code === "SENDER_ID_MISMATCH"
        ? "The app notification keys were refused. Check the Firebase project matches the app's google-services.json."
        : `The app notification service refused it (HTTP ${response.status}).`,
  };
}
