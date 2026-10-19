import webpush, { WebPushError } from "web-push";

import { env } from "@/lib/env";
import { fcmConfigured, sendFcm } from "@/lib/fcm";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { PushSubscriptionRow } from "@/lib/types";

/**
 * Notifications on the phone itself, over Web Push.
 *
 * The third alert channel and the only one that needs nothing else installed:
 * Telegram needs Telegram, WhatsApp needs an account nobody has bought, and
 * this needs the browser the officer already added to their home screen.
 *
 * FREE, WHICH WAS THE CONDITION. The delivery is done by the browser vendor's
 * own push service - FCM for Chrome, APNs for an installed iPhone app,
 * Mozilla's for Firefox - and none of the three charges anything or wants an
 * account. Our VAPID key pair is the whole of the setup, and web-push does the
 * signing and the payload encryption. There is no vendor SDK here on purpose.
 *
 * THE ANDROID/iOS APP IS THE EXCEPTION. Its WebView has no Web Push, so it
 * registers with Firebase Cloud Messaging instead and its rows are kind 'fcm'
 * (migration 0058). sendPushToUser() sends each row the way its kind needs -
 * web-push here, FCM HTTP v1 in fcm.ts - so callers never see the difference.
 *
 * Same shape and the same error discipline as telegram.ts and whatsapp.ts: a
 * result, never an exception, and `skipped` for "this channel is not switched
 * on" so a caller can stay quiet about that and complain about a real failure.
 */

export type PushResult =
  | { ok: true; sent: number }
  | {
      ok: false;
      error: string;
      /** No keys for any install this officer has, or nothing subscribed. */
      skipped?: boolean;
      /** Installs that took the notification even though others did not. */
      sent?: number;
    };

/** What a notification carries. The service worker's `push` handler reads this. */
export type PushPayload = {
  title: string;
  body: string;
  /**
   * Collapses repeated notifications instead of stacking them. One truck's
   * name is the right grain: an officer watching a lorry across ten plazas
   * wants the latest crossing, not ten rows to clear.
   */
  tag?: string;
  /** Where tapping it should land. Path only - the worker resolves the origin. */
  url?: string;
};

/**
 * Whether a send can even be attempted.
 *
 * Both keys and the subject: web-push refuses to sign without all three, and a
 * request that is not signed is one every push service rejects. The public key
 * also has to be readable by the browser under its NEXT_PUBLIC_ name or nothing
 * ever subscribes, but that is the subscribe side's problem and it reports it
 * itself - see PushSetup.tsx.
 */
export function pushConfigured(): boolean {
  return Boolean(env.vapidPublicKey && env.vapidPrivateKey && env.vapidSubject);
}

let configured = false;

/**
 * web-push keeps the VAPID details in module state, so they are set once rather
 * than on every send. Lazily, because the module is imported by the tracking
 * worker whether or not any key exists and setVapidDetails() throws on a blank
 * one.
 */
function ensureVapid(): void {
  if (configured) return;
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublicKey, env.vapidPrivateKey);
  configured = true;
}

/**
 * Sends one notification to every install this officer has.
 *
 * In parallel and with allSettled, so the laptop that is switched off cannot
 * stop the phone in their pocket from buzzing. `sent` counts the installs that
 * took it, which is what the caller records as delivery: one officer legitimately
 * has three subscriptions and two of them being stale is not a failure to report.
 *
 * Never throws. This runs inside the tracking sweep, where an exception would
 * abandon the rest of a truck's checks - the same rule sendTelegramMessage()
 * follows, and the reason both return a value instead.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushResult> {
  const webReady = pushConfigured();
  const appReady = fcmConfigured();

  if (!webReady && !appReady) {
    // Logged rather than silent: this is how you tell "nobody subscribed" from
    // "the keys are missing", and they need opposite fixes.
    console.info("[push] no VAPID or FCM keys — notification not sent");
    return { ok: false, skipped: true, error: "Phone notifications are not switched on yet." };
  }

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from("push_subscriptions")
    .select("id, kind, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) {
    console.error("[push] could not read subscriptions:", error.message);
    return { ok: false, error: "Could not look up this account's devices." };
  }

  const rows = (data ?? []) as DeliveryRow[];

  if (rows.length === 0) {
    return {
      ok: false,
      skipped: true,
      error: "No phone is set up for notifications on this account.",
    };
  }

  /* Only the installs whose channel has keys. The other kind's rows are kept,
     not pruned: they become reachable the moment their keys are set. */
  const subscriptions = rows.filter((row) => (row.kind === "fcm" ? appReady : webReady));

  if (subscriptions.length === 0) {
    console.info("[push] this account's installs are all on a channel with no keys");
    return { ok: false, skipped: true, error: "Phone notifications are not switched on yet." };
  }

  if (webReady && subscriptions.some((row) => row.kind !== "fcm")) ensureVapid();

  const body = JSON.stringify(payload);
  const outcomes = await Promise.allSettled(
    subscriptions.map((row) => (row.kind === "fcm" ? sendFcm(row.endpoint, payload) : deliver(row, body))),
  );

  const dead: number[] = [];
  const problems: string[] = [];
  let sent = 0;

  outcomes.forEach((outcome, index) => {
    // deliver() catches its own failures, so a rejection here is a bug rather
    // than a push service saying no. Counted as a problem either way; nothing
    // in this function is allowed to throw upwards.
    if (outcome.status === "rejected") {
      problems.push(String(outcome.reason instanceof Error ? outcome.reason.message : outcome.reason));
      return;
    }
    const result = outcome.value;
    if (result.ok) {
      sent += 1;
      return;
    }
    if (result.gone) dead.push(subscriptions[index].id);
    else problems.push(result.error);
  });

  // Fire and forget: a notification that was delivered must not be reported as
  // failed because the tidying up afterwards did not work.
  if (dead.length > 0) void prune(dead);

  if (sent > 0) return { ok: true, sent };

  return {
    ok: false,
    sent: 0,
    error:
      problems[0] ??
      // Every subscription was declared gone, and has just been deleted. Worth
      // saying plainly: the officer has to subscribe again, and no amount of
      // retrying will help.
      "The app was removed or notifications were turned off on every device. Set it up again on your phone.",
  };
}

type Delivery = { ok: true } | { ok: false; error: string; gone?: boolean };

type DeliveryRow = Pick<PushSubscriptionRow, "id" | "kind" | "endpoint" | "p256dh" | "auth">;

/**
 * One POST to one push service.
 *
 * Nothing here logs the endpoint or either key. An endpoint is a bearer
 * credential - anybody holding it can send that phone a notification that looks
 * like ours - so it never reaches a log, an error message or a Sentry payload,
 * and the row id stands in for it wherever something has to be identified.
 */
async function deliver(row: DeliveryRow, body: string): Promise<Delivery> {
  try {
    await webpush.sendNotification(
      // Never null for a web row: migration 0058's check constraint.
      { endpoint: row.endpoint, keys: { p256dh: row.p256dh ?? "", auth: row.auth ?? "" } },
      body,
      {
        /*
         * How long the push service should hold the notification for a phone
         * that is off or out of signal. A toll crossing is worth waiting a
         * while for and worthless after a day, and the default is four weeks -
         * which would deliver last Tuesday's plaza when the phone came back on.
         */
        TTL: 6 * 3600,
        // "The lorry has moved" is worth waking the screen for. The default,
        // "normal", lets a dozing phone sit on it.
        urgency: "high",
      },
    );
    return { ok: true };
  } catch (error) {
    /*
     * 404 and 410 are how a push service says this install no longer exists -
     * the app was deleted, the browser data was cleared, permission was
     * revoked. It is not a transient failure and it never recovers, so the row
     * is deleted. A table that never prunes grows for ever and every alert
     * pays for it: the send loop above waits on each dead endpoint timing out.
     */
    if (error instanceof WebPushError) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        return { ok: false, gone: true, error: "This device is no longer subscribed." };
      }
      // Real, and ours to know about: 401 or 403 is a wrong or changed VAPID
      // key, 413 a payload over the 4KB limit, 429 too many sends.
      console.error(`[push] subscription ${row.id} rejected with HTTP ${error.statusCode}`);
      return {
        ok: false,
        error:
          error.statusCode === 401 || error.statusCode === 403
            ? "The notification keys were refused. They may have been changed."
            : `The notification service refused it (HTTP ${error.statusCode}).`,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(`[push] subscription ${row.id} failed:`, message);
    return { ok: false, error: message };
  }
}

/** Drops subscriptions their own push service has declared gone. */
async function prune(ids: number[]): Promise<void> {
  const { error } = await getSupabaseAdmin().from("push_subscriptions").delete().in("id", ids);
  if (error) console.error("[push] could not delete dead subscriptions:", error.message);
  else console.info(`[push] removed ${ids.length} dead subscription(s)`);
}

/**
 * The same crossing as formatAlertMessage in telegram.ts, as a notification.
 *
 * No markup at all - a notification body is plain text on every platform, and
 * iOS shows about two lines of it - so the position is one line rather than the
 * four stacked rows Telegram gets. The truck number leads the title because
 * that is what is legible in a lock-screen banner and in a stack of them.
 */
export function formatPushAlert({
  title,
  truckNumber,
  location,
  direction,
  eventTime,
  extra,
}: {
  title: string;
  truckNumber: string;
  location?: string | null;
  direction?: string | null;
  eventTime?: string | null;
  extra?: string | null;
}): { title: string; body: string } {
  const when = eventTime
    ? new Date(eventTime).toLocaleString("en-IN", {
        timeZone: "Asia/Kolkata",
        day: "2-digit",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : null;

  const position = [location, direction].filter(Boolean).join(" · ");
  const lines = [position, when ? `${when} IST` : null, extra].filter(Boolean) as string[];

  return {
    title: `${truckNumber} — ${title}`,
    // A notification with an empty body renders as a bare title on Android and
    // is dropped entirely by some services, so there is always something.
    body: lines.length > 0 ? lines.join("\n") : title,
  };
}
