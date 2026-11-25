import {
  alertDue,
  alertGoesToWhatsApp,
  evaluateAlert,
  isRevisit,
  normaliseLocation,
  type AlertDraft,
  type Position,
} from "@/lib/alerts";
import { CREDIT_ACTIONS, spendCredits } from "@/lib/credits";
import "@/lib/low-credit"; // registers the low-balance warning hook used by credits.ts
import { istDaysAgo, istToday } from "@/lib/format";
import { fetchTruckEvents } from "@/lib/ldb";
import { maybeExportAndPurge, type BackupSummary } from "@/lib/backup";
import { purgeOldChat } from "@/lib/chat";
import { sendDueAnnouncementPushes } from "@/lib/announcements";
import { PLAN_GRACE_DAYS } from "@/lib/officer";
import { dueForAutoPause } from "@/lib/pause";
import { formatPushAlert, sendPushToUser } from "@/lib/push";
import { SETTINGS_FALLBACK, loadSettings } from "@/lib/settings";
import { recordTruckActivity } from "@/lib/truck-activity";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { formatAlertMessage, sendTelegramMessage } from "@/lib/telegram";
import { canPayForWhatsApp, chargeSentWhatsApp, whatsappMessageCost } from "@/lib/whatsapp-charge";
import {
  logWhatsAppSkipped,
  noticeParams,
  sendWhatsAppAlert,
  siteLink,
  truckAlertTemplate,
  type PreferredTemplate,
  whatsappAlertParams,
  whatsappAlertText,
  whatsappConfigured,
  whatsappNoticeText,
} from "@/lib/whatsapp";
import { fmtDateTime } from "@/lib/format";
import { canEmailCustomers, esc, sendEmail, shell } from "@/lib/email";
import { env } from "@/lib/env";
import type {
  AppSettings,
  EffectiveLimits,
  TelegramConfig,
  TrackedTruck,
  TruckAlertWithTemplate,
  TruckStatus,
} from "@/lib/types";

type Admin = ReturnType<typeof getSupabaseAdmin>;

/** Crossing shape the worker passes around. */
export type EventLike = {
  seq_no: string;
  event_time: string | null;
  loc_name: string | null;
  direction: string | null;
};

/**
 * Say something after this many failures in a row - long before giving up.
 *
 * The officer can only fix a wrong number or a truck the network has stopped
 * reporting if somebody tells them. Five is far enough in to rule out one bad
 * afternoon upstream, and early enough that the budget below has not run out.
 */
const FAILURE_WARN_AT = 5;

/** Trucks handled per sweep, and how many at a time. */
const DEFAULT_BATCH = 60;
const CONCURRENCY = 4;

/**
 * How many failures in a row this truck is allowed before it is paused.
 *
 * Two levels, and only two. The officer's own number, chosen when they added
 * the truck, wins - they are the one who knows whether this lorry is worth
 * being patient with. Anything they left blank falls back to the admin's
 * setting, which is one number for the whole platform and can be changed in
 * the console without touching a single truck.
 *
 * A per-truck null is deliberately NOT resolved at write time. Storing the
 * admin's number on the row would freeze it there, and every truck already
 * added would go on using whatever the default happened to be that day.
 */
export function resolveFailureBudget(
  truck: Pick<TrackedTruck, "max_consecutive_failures">,
  settings: Pick<AppSettings, "trackingFailureCutoff">,
): number {
  if (truck.max_consecutive_failures !== null && truck.max_consecutive_failures !== undefined) {
    return truck.max_consecutive_failures;
  }
  // A misconfigured setting must not mean "pause on the first hiccup".
  const cutoff = settings.trackingFailureCutoff;
  return Number.isInteger(cutoff) && cutoff >= 1 ? cutoff : SETTINGS_FALLBACK.trackingFailureCutoff;
}

export type PollOutcome = {
  truckId: string;
  truckNumber: string;
  userId: string;
  status: "checked" | "skipped" | "failed";
  reason?: string;
  newEvents: number;
  alerts: number;
  alertsDelivered: number;
  responseMs?: number;
  error?: string;
  /**
   * Live trucks this refusal stopped, across the whole account.
   *
   * Set only on the truck whose check discovered the empty balance, and it
   * counts the account's other lorries too - see pauseAccountForNoCredits().
   * Undefined everywhere else, so the sweep can sum it without every outcome
   * carrying a zero.
   */
  pausedForNoCredits?: number;
};

export type SweepSummary = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  trackingEnabled: boolean;
  candidates: number;
  due: number;
  checked: number;
  skipped: number;
  failed: number;
  newEvents: number;
  alerts: number;
  alertsDelivered: number;
  /** Set when the batch cap cut the sweep short, so it is never silent. */
  deferred: number;
  /**
   * Trucks switched off because their plan ended more than the grace period
   * ago, and how many accounts that was.
   *
   * Reported for the same reason autoPaused is: it is a sweep REDUCING what
   * the platform does, and an admin needs to be able to tell "quiet week" from
   * "sixty trucks just lapsed".
   */
  planExpired: { trucks: number; accounts: number };
  /**
   * Trucks this sweep stopped by itself, and why.
   *
   * Reported rather than left implicit because it is the one thing in a sweep
   * that REDUCES what the platform does. An admin watching the worker output
   * needs to be able to tell "nothing was checked because nothing was due"
   * from "nothing was checked because forty trucks just timed out" - and a
   * sudden spike in `inactive` is how a too-tight platform setting would
   * announce itself.
   */
  autoPaused: { schedule: number; inactive: number };
  /**
   * Trucks stopped because their account's balance could not cover a check,
   * and how many accounts that was.
   *
   * Its own field rather than a third key on autoPaused, because it is decided
   * somewhere else entirely: the two above are settled from the row before any
   * credit is spent, this one can only be known once spend_credits() has
   * refused. Counted for the same reason as planExpired - it is a sweep
   * REDUCING what the platform does, and an admin has to be able to tell a
   * quiet tick from forty lorries that just ran out of money.
   */
  noCreditsPaused: { trucks: number; accounts: number };
  /** Anything that went wrong outside a single truck's own check. */
  errors: string[];
  outcomes: PollOutcome[];
  /** Set when this sweep also ran the export-and-purge. */
  backup?: BackupSummary | null;
};

/* -------------------------------------------------------------------------- */
/* helpers                                                                     */
/* -------------------------------------------------------------------------- */

export function deriveStatus(
  lastEventAt: string | null,
  now: Date,
  noActivityHours: number,
): TruckStatus {
  if (!lastEventAt) return "unknown";
  const then = new Date(lastEventAt).getTime();
  if (Number.isNaN(then)) return "unknown";
  const hours = (now.getTime() - then) / 3_600_000;
  if (hours <= 1) return "moving";
  if (hours <= noActivityHours) return "idle";
  return "no_activity";
}

/**
 * Runs `worker` over the items, a few at a time, and never lets one of them
 * take the rest down with it.
 *
 * The catch is the whole point. A worker that threw - a network error, a null
 * where none was expected - rejected the Promise.all every other worker was
 * waiting in, so the sweep threw before it could return anything. The trucks it
 * had already checked had been charged and had their crossings written; the
 * caller got a 500 and no record of any of it. Every failure is a result now,
 * so the sweep always finishes and always says what happened.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
  onFailure: (item: T, error: unknown) => R,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await worker(items[index]);
      } catch (error) {
        results[index] = onFailure(items[index], error);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/* -------------------------------------------------------------------------- */
/* per-officer context, loaded once per sweep                                  */
/* -------------------------------------------------------------------------- */

export type OfficerContext = {
  userId: string;
  limits: EffectiveLimits | null;
  telegram: TelegramConfig | null;
  /**
   * How many installs of the app are subscribed to notifications.
   *
   * A count and not the rows: the endpoints and keys are read inside
   * sendPushToUser(), which is also where a dead one is pruned, and an endpoint
   * is a credential that has no reason to be carried around a sweep. All this
   * is for is knowing whether to make the call at all - one officer's forty
   * trucks would otherwise each ask the database for a subscription list that
   * is usually empty.
   */
  pushDevices: number;
  /** The number alerts go to on WhatsApp, when the customer has opted in (0067). */
  whatsapp: { phone: string; is_enabled: boolean } | null;
};

async function loadOfficerContext(admin: Admin, userId: string): Promise<OfficerContext> {
  const [{ data: limits }, { data: telegram }, { count: pushDevices }, { data: whatsapp }] = await Promise.all([
    admin
      .from("officer_effective_limits")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle<EffectiveLimits>(),
    admin.from("telegram_configs").select("*").eq("user_id", userId).maybeSingle<TelegramConfig>(),
    admin
      .from("push_subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    // The opt-in lives in whatsapp_configs; the number is the profile's own
    // mobile (one source of truth for every contact). An error here leaves
    // `data` null and WhatsApp off for this account - nothing else breaks.
    whatsappConfigured()
      ? admin
          .from("whatsapp_configs")
          .select("is_enabled, profile:profiles(phone)")
          .eq("user_id", userId)
          .maybeSingle<{ is_enabled: boolean; profile: { phone: string | null } | null }>()
      : Promise.resolve({ data: null }),
  ]);

  const waPhone = whatsapp?.profile?.phone ?? null;

  return {
    userId,
    limits: limits ?? null,
    telegram: telegram ?? null,
    pushDevices: pushDevices ?? 0,
    whatsapp: whatsapp && waPhone ? { phone: waPhone, is_enabled: whatsapp.is_enabled } : null,
  };
}

/* -------------------------------------------------------------------------- */
/* the channels, in one place                                                  */
/* -------------------------------------------------------------------------- */

/** What every alert_logs row needs to know about its own delivery. */
type Delivery = { sent: boolean; error: string | null };

/**
 * Sends one alert on every channel this officer has set up.
 *
 * BOTH, NOT EITHER. An officer with Telegram and a subscribed phone gets both:
 * the two are read in different places - Telegram in a chat somebody may have
 * muted, a notification on the lock screen - and choosing one for them would be
 * choosing which of their own settings to ignore. `sent` is true if either
 * landed, because the question alert_logs.delivered answers is "did this reach
 * them", not "did every channel work".
 *
 * In parallel: Telegram is one round trip to api.telegram.org and push is one
 * per install, and a sweep that runs them one after the other pays for both on
 * every alert.
 *
 * Nothing here throws. Both senders return a result by design - see the note on
 * sendTelegramMessage() and sendPushToUser() - and this is on the hot path of a
 * sweep where an exception would abandon the rest of a truck's checks.
 */
async function deliverAlert({
  context,
  telegramText,
  push,
  whatsapp,
}: {
  context: OfficerContext;
  telegramText: string;
  push: { title: string; body: string; tag: string; url: string };
  /**
   * Template parameters (truck, what happened, when) and the plain-text version
   * for the 24-hour window - or null when this message is not worth a WhatsApp
   * (every-check updates, hourly halt reminders, minor notices: see
   * alertGoesToWhatsApp). Those still go to app push and Telegram.
   */
  whatsapp: {
    params: string[];
    /** rahdari_truck_alert, tried before the trip-update chain. */
    preferred?: PreferredTemplate | null;
    text: string;
    /** Charged to this truck in the ledger (null for account-wide notices). */
    truckNumber: string | null;
    /** Never charged: the "no credits left" notice (see whatsapp-charge.ts). */
    free?: boolean;
  } | null;
}): Promise<Delivery> {
  const telegramAllowed =
    (context.telegram?.is_enabled ?? false) && Boolean(context.telegram?.chat_id);
  const pushAllowed = context.pushDevices > 0;
  const whatsappOn =
    whatsappConfigured() && (context.whatsapp?.is_enabled ?? false) && Boolean(context.whatsapp?.phone);
  let whatsappAllowed = whatsappOn && whatsapp !== null;

  /*
   * WhatsApp costs credits when the admin has charging on (0076). Checked
   * BEFORE sending - an account that cannot pay gets no WhatsApp for this
   * alert, but push and Telegram still go - and charged only AFTER Meta has
   * accepted the message, below. src/lib/whatsapp-charge.ts has the rules.
   */
  const admin = getSupabaseAdmin();
  let waCost: number | null = null;
  let waSkipped: string | null = null;
  if (whatsappAllowed && !whatsapp!.free) {
    waCost = await whatsappMessageCost(admin);
    if (waCost !== null) {
      const pay = await canPayForWhatsApp(admin, context.userId, waCost);
      if (!pay.ok) {
        waSkipped = pay.reason;
        whatsappAllowed = false;
        await logWhatsAppSkipped({ userId: context.userId, to: context.whatsapp!.phone, reason: pay.reason });
      }
    }
  }

  if (!telegramAllowed && !pushAllowed && !whatsappAllowed) {
    return {
      sent: false,
      error: waSkipped
        ? `WhatsApp: ${waSkipped}. Top up to get WhatsApp alerts again.`
        : whatsappOn
        ? "Shown here only: WhatsApp carries crossings, halt and moving again. Turn on phone notifications or Telegram in Notifications for the other alerts."
        : "No WhatsApp number, Telegram chat ID or phone notifications set up. Set one up in Settings to receive alerts.",
    };
  }

  const [telegram, phone, wa] = await Promise.all([
    telegramAllowed
      ? sendTelegramMessage({
          chatId: context.telegram!.chat_id!,
          botToken: context.telegram!.bot_token,
          text: telegramText,
        })
      : null,
    pushAllowed ? sendPushToUser(context.userId, push) : null,
    whatsappAllowed
      ? sendWhatsAppAlert({
          to: context.whatsapp!.phone,
          text: whatsapp!.text,
          params: whatsapp!.params,
          preferred: whatsapp!.preferred ?? null,
          purpose: "alert",
          userId: context.userId,
        })
      : null,
  ]);

  // Charged once, and only for a message Meta accepted. A failed send was
  // never charged, so there is nothing to give back.
  if (wa?.ok && waCost !== null) {
    await chargeSentWhatsApp(admin, context.userId, whatsapp!.truckNumber);
  }

  const sent = Boolean(telegram?.ok) || Boolean(phone?.ok) || Boolean(wa?.ok);
  if (sent) {
    // A channel that failed while the other worked is not this alert's problem
    // to report: the alert reached them. The failure is already in the log.
    return { sent: true, error: null };
  }

  /*
   * Both channels were tried and neither landed, so the reasons are worth
   * keeping - and both of them, because "Telegram says chat not found" and
   * "every device is gone" need different fixes and an officer told only the
   * first would fix the wrong thing. A push that reports `skipped` is left out:
   * it means the platform has no keys, which is ours and not theirs.
   */
  const reasons = [
    telegram && !telegram.ok ? `Telegram: ${telegram.error}` : null,
    phone && !phone.ok && !phone.skipped ? `Phone: ${phone.error}` : null,
    wa && !wa.ok && !wa.skipped ? `WhatsApp: ${wa.error}` : null,
    waSkipped ? `WhatsApp: ${waSkipped}.` : null,
  ].filter(Boolean);

  return { sent: false, error: reasons.join(" ") || "The alert could not be delivered." };
}

/* -------------------------------------------------------------------------- */
/* alert delivery                                                              */
/* -------------------------------------------------------------------------- */

/**
 * There is no cooldown table. Each alert carries its own interval and its own
 * last_run_at, so it cannot repeat inside its window by construction.
 */
async function dispatchAlerts({
  admin,
  context,
  truckId,
  truckNumber,
  drafts,
}: {
  admin: Admin;
  context: OfficerContext;
  /** Where a tapped notification should land. */
  truckId: string;
  truckNumber: string;
  drafts: AlertDraft[];
}): Promise<{ created: number; delivered: number }> {
  if (drafts.length === 0) return { created: 0, delivered: 0 };

  let delivered = 0;

  for (const draft of drafts) {
    const position = {
      title: draft.title,
      truckNumber,
      location: draft.position.locName,
      direction: draft.position.direction,
      eventTime: draft.position.eventTime,
      extra: draft.message,
    };

    const { sent, error: deliveryError } = await deliverAlert({
      context,
      telegramText: formatAlertMessage(position),
      push: {
        ...formatPushAlert(position),
        /*
         * Tagged per truck and per kind of alert. A lorry crossing four plazas
         * on a night run should leave one notification showing the latest
         * crossing rather than four rows to clear, three of which are already
         * out of date - but "it has moved" and "it has come back to a plaza it
         * already passed" are different news about the same truck and must not
         * replace each other.
         */
        tag: `${truckId}:${draft.kind}`,
        url: `/portal/trucks/${truckId}`,
      },
      whatsapp: alertGoesToWhatsApp(draft) ? whatsappForDraft(draft, truckNumber, truckId) : null,
    });

    if (sent) delivered += 1;

    const { error } = await admin.from("alert_logs").insert({
      user_id: context.userId,
      truck_number: truckNumber,
      kind: draft.kind,
      title: draft.title,
      message: draft.message,
      delivered: sent,
      delivery_error: deliveryError,
    });
    if (error) console.error("alert_logs insert failed", error.message);
  }

  return { created: drafts.length, delivered };
}

/** A truck alert's WhatsApp text and template parameters, with a link to the truck. */
function whatsappForDraft(draft: AlertDraft, truckNumber: string, truckId: string) {
  const input = {
    kind: draft.kind,
    phase: draft.phase,
    title: draft.title,
    truckNumber,
    location: draft.position.locName,
    direction: draft.position.direction,
    eventTime: draft.position.eventTime,
    previousLocation: draft.previousLocation,
    idleText: draft.idleText,
    watchedPlaza: draft.watchedPlaza,
    guessed: draft.guessed,
    url: siteLink(`/portal/trucks/${truckId}`),
  };
  return {
    params: whatsappAlertParams(input),
    preferred: truckAlertTemplate(input, truckId),
    text: whatsappAlertText(input),
    truckNumber,
  };
}

/**
 * "Credits running low" (src/lib/low-credit.ts decides when): the bell, app
 * push and Telegram only - never WhatsApp, which would itself spend credits.
 */
export async function sendLowCreditNotice(userId: string, balance: number, threshold: number): Promise<void> {
  const admin = getSupabaseAdmin();
  const context = await loadOfficerContext(admin, userId);
  const left = balance.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  await sendSystemAlert({
    admin,
    context,
    truckNumber: null,
    kind: "low_credits",
    title: "Credits running low",
    message:
      `Your balance is ${left} credits, under about a day of your usual use ` +
      `(${threshold.toLocaleString("en-IN", { maximumFractionDigits: 2 })}). Top up so tracking does not pause: ` +
      siteLink("/portal/plan"),
    pushUrl: "/portal/plan",
  });
}

/**
 * An alert about the watching itself rather than about a truck's movement.
 *
 * dispatchAlerts() cannot carry these: it formats a position, and the whole
 * point of "this truck keeps failing" is that there is no position to report.
 * The row still lands in alert_logs, so the bell shows it even for an account
 * with no channel set up at all - which is exactly the account most likely to
 * be missing the news.
 */
async function sendSystemAlert({
  admin,
  context,
  truckNumber,
  kind,
  title,
  message,
  whatsappLink,
  pushUrl = "/portal/notifications",
}: {
  admin: Admin;
  context: OfficerContext;
  truckNumber: string | null;
  kind: string;
  title: string;
  message: string;
  /**
   * Also on WhatsApp, with this link. Left out for notices not worth a paid
   * message - only "tracking has stopped and you must act" ones get it (no
   * credits, plan ending tomorrow / ended, repeated failures).
   */
  whatsappLink?: { label: string; url: string };
  /** Where tapping the phone notification goes (default: the bell). */
  pushUrl?: string;
}): Promise<void> {
  const heading = truckNumber ? `${title}\n${truckNumber}` : title;

  const { sent: delivered, error: deliveryError } = await deliverAlert({
    context,
    telegramText: `${heading}\n\n${message}`,
    push: {
      title: truckNumber ? `${truckNumber} — ${title}` : title,
      body: message,
      /*
       * Tagged per kind and NOT per truck, unlike a movement alert. These are
       * mostly account-wide - the balance ran out, the plan lapsed - and the
       * two that do name a lorry say the same thing about it twice as it fails
       * its way to being paused. One notification per kind is the news.
       */
      tag: `system:${kind}`,
      /*
       * The bell, not the truck. A notification body is two lines on a phone
       * and these messages are a paragraph explaining what to do next; the
       * notifications list is where the whole thing is readable. Account-wide
       * ones have no truck to open anyway.
       */
      url: pushUrl,
    },
    whatsapp: whatsappLink
      ? {
          params: noticeParams(truckNumber, title),
          text: whatsappNoticeText({ title, truckNumber, message, link: whatsappLink }),
          truckNumber,
          /* "No credits left" is free on WhatsApp: the balance it would be
             charged to is exactly what ran out, and it is the message that
             tells the customer to top up. */
          free: kind === "out_of_credits",
        }
      : null,
  });

  const { error } = await admin.from("alert_logs").insert({
    user_id: context.userId,
    truck_number: truckNumber,
    kind,
    title,
    message,
    delivered,
    delivery_error: deliveryError,
  });
  if (error) console.error("alert_logs insert failed", error.message);
}

/**
 * True when this account has not already been told about `kind` today.
 *
 * Running out of credits is discovered once per truck per sweep, so without
 * this an account with forty trucks would be told forty times an hour that its
 * balance is empty. The news is the same all day, so it is worth saying once.
 */
async function notToldToday(admin: Admin, userId: string, kind: string): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data, error } = await admin
    .from("alert_logs")
    .select("id")
    .eq("user_id", userId)
    .eq("kind", kind)
    .gte("created_at", since)
    .limit(1);

  // A failed lookup must not become silence about something this important.
  if (error) return true;
  return (data ?? []).length === 0;
}

/**
 * Stops every live truck on one account, because its balance cannot pay for a
 * check.
 *
 * WHY THE WHOLE ACCOUNT AND NOT JUST THE TRUCK THAT WAS BEING CHECKED
 *
 * The balance is an account-level fact and the polling is per-truck, so the
 * two do not line up. Pausing only the lorry whose check happened to be
 * refused would leave the other thirty-nine switched on, each to be refused in
 * its turn - over this sweep and the next few - and each meanwhile showing a
 * live switch on the phone. The officer would watch their fleet go out one
 * lorry at a time with no way to tell how far it had got. It is also the
 * owner's rule in as many words: "if credit become 00, all live tracking ->
 * auto pause".
 *
 * It makes the message underneath it true, which the per-truck version could
 * not: "no truck is being checked" is only an honest thing to send if the
 * trucks have actually stopped.
 *
 * And it is one statement. Forty guarded per-truck updates against a database
 * in another region is the whole cost of a sweep; this is a single UPDATE on
 * the index tracked_trucks_user_idx already provides.
 *
 * WHAT IT DELIBERATELY DOES NOT TOUCH
 *
 * auto_pause_at is left standing, unlike in applyAutoPauses() where the
 * deadline had actually arrived. Here it has not: the officer said "watch this
 * for six hours" and the money ran out after two, so the instruction still
 * means something and throwing it away would let the truck run for ever the
 * next time it went live. consecutive_errors is left for the same reason - a
 * run of failures is a fact about the registration number, and the wallet has
 * nothing to say about it.
 *
 * `ok` is separate from the count on purpose. Zero stopped is the normal
 * result on any sweep after the first - they are already paused - whereas a
 * failed statement means the trucks are still live, and the caller must not
 * then send a message claiming they are not.
 *
 * WHY A TOP-UP DOES NOT UNDO THIS BY ITSELF
 *
 * Nothing here or in the payment path takes a truck live again. Buying credits
 * lifts the refusal - liveBlockedByCredits() in src/lib/officer.ts returns null
 * the moment the balance covers one check, so the switch and Go live work again
 * immediately - but the officer decides which lorries come back. Four reasons,
 * and the first is the expensive one:
 *
 *   * The trucks that emptied the balance are the ones least likely to be
 *     wanted back. A lorry parked in a yard answers every check with
 *     yesterday's crossing at one credit a time, and it is exactly the truck
 *     somebody forgot about. Switching the whole list on again would spend the
 *     new credits on the same lorries that spent the old ones, at about 96 a
 *     day each, and the customer would meet an empty balance twice.
 *   * Nothing is lost by waiting. A paused truck is on the watchlist, keeps
 *     every crossing it recorded, and costs nothing - so the pause can sit
 *     there for a week at no charge while the officer chooses.
 *   * Auto-resume would put a write to tracked_trucks in the payment path, and
 *     settle_payment() has no business deciding which lorries are watched. It
 *     would also have to guess when the plan's truck limit no longer fits the
 *     number that were live, which is a choice with a cost attached.
 *   * The manual way back already exists and is already correct: both resume
 *     paths clear paused_reason, the failure run and the stale deadline.
 */
async function pauseAccountForNoCredits(
  admin: Admin,
  userId: string,
  now: Date,
): Promise<{ ok: boolean; stopped: number }> {
  const { data, error } = await admin
    .from("tracked_trucks")
    .update({
      is_active: false,
      paused_reason: "no_credits",
      paused_at: now.toISOString(),
    })
    .eq("user_id", userId)
    // Guarded like every other pause in this file: an officer can be pausing a
    // lorry by hand in the same second, and whoever gets there first owns the
    // reason. It also makes the statement idempotent, so two overlapping
    // sweeps do not both claim to have stopped the same fleet.
    .eq("is_active", true)
    .select("id, truck_number");

  if (error) {
    console.error(`no-credit pause failed for account ${userId}`, error.message);
    return { ok: false, stopped: 0 };
  }
  const stopped = (data ?? []) as { id: string; truck_number: string }[];
  /* One history line per truck that actually stopped (0072). */
  await recordTruckActivity(
    stopped.map((row) => ({
      userId,
      truckId: row.id,
      truckNumber: row.truck_number,
      kind: "auto_paused" as const,
      detail: { reason: "no_credits" as const },
      at: now.toISOString(),
    })),
    admin,
  );
  return { ok: true, stopped: stopped.length };
}

/* -------------------------------------------------------------------------- */
/* one truck                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Checks one truck and runs whichever of its alerts are due.
 *
 * A truck is only ever here because an alert asked for it, so the upstream
 * call and the credit are charged once and shared by every alert that was due
 * at the same moment.
 */
export async function checkTruck({
  admin,
  truck,
  alerts,
  context,
  settings,
  now,
}: {
  admin: Admin;
  truck: TrackedTruck;
  alerts: TruckAlertWithTemplate[];
  context: OfficerContext;
  settings: AppSettings;
  now: Date;
}): Promise<PollOutcome> {
  const outcome: PollOutcome = {
    truckId: truck.id,
    truckNumber: truck.truck_number,
    userId: truck.user_id,
    status: "skipped",
    newEvents: 0,
    alerts: 0,
    alertsDelivered: 0,
  };

  // 1. Credits. spend_credits is the only writer of the balance, and it locks
  //    the row, so two overlapping sweeps cannot both spend the last one.
  const verdict = await spendCredits({
    admin,
    userId: truck.user_id,
    action: CREDIT_ACTIONS.autoCheck,
    truckNumber: truck.truck_number,
  });

  if (!verdict.allowed) {
    if (verdict.reason === "account_suspended") {
      await admin
        .from("tracked_trucks")
        .update({
          is_active: false,
          paused_reason: "account_suspended",
          paused_at: now.toISOString(),
        })
        .eq("id", truck.id);
      await recordTruckActivity(
        {
          userId: truck.user_id,
          truckId: truck.id,
          truckNumber: truck.truck_number,
          kind: "auto_paused",
          detail: { reason: "account_suspended" },
          at: now.toISOString(),
        },
        admin,
      );
      return { ...outcome, reason: verdict.reason };
    }

    if (verdict.reason === "out_of_credits") {
      /*
       * AN EMPTY BALANCE NOW PAUSES THE FLEET. It used to only send a message.
       *
       * The branch itself dates from before 0038, went dormant for a release
       * when auto_check was rated 0 - a free check cannot be refused, so the
       * wallet could never stop tracking - and came back live with 0041, which
       * priced a check at one credit again. What was still missing was the
       * consequence, and the owner has now asked for it in as many words:
       * "if credit become 00, all live tracking -> auto pause: with reason".
       *
       * Leaving the trucks switched on was the product failing in its quietest
       * possible way. The balance emptied, every check stopped, and nothing on
       * the phone changed - the lorries were still listed, still showing a live
       * switch, still claiming to be watched - and the crossing nobody was told
       * about was the one that mattered. The old comment here said tracking was
       * "left switched on" because an empty balance "fixes itself the moment
       * the officer tops up"; both halves were wrong. It does not fix itself,
       * because nothing tells the officer, and a truck that is switched on and
       * is not being checked is a lie on the page.
       *
       * The pause comes first and the message second, because the message
       * describes the pause. If the statement failed, the trucks are still live
       * and saying otherwise would be worse than saying nothing - so the news
       * waits for the next sweep, which will try again.
       */
      const paused = await pauseAccountForNoCredits(admin, truck.user_id, now);

      /*
       * ONCE PER EMPTYING, not once a day any more - and notToldToday is doing
       * a different job than it used to.
       *
       * It was the guard against a daily nag: forty trucks rediscovering the
       * same empty balance every fifteen minutes for a week. Now that the first
       * refusal pauses them, none of those trucks is a candidate on the next
       * sweep, so there is nothing left to repeat. What it still stops is the
       * fan-out INSIDE this one sweep: several of the account's trucks are
       * checked concurrently, they all reach this branch, and only the first
       * of them should send anything.
       */
      if (paused.ok && (await notToldToday(admin, truck.user_id, "out_of_credits"))) {
        await sendSystemAlert({
          admin,
          context,
          /* No registration number. This is an account-wide event, and naming
             whichever truck happened to be polled first would read as a fault
             with that one truck. Same choice as the plan-expiry message. */
          truckNumber: null,
          kind: "out_of_credits",
          title: "Tracking paused: no credits left",
          message:
            "All tracked trucks are paused. Your trucks, alerts and history are saved. " +
            "Top up, then switch the trucks you need back on from My trucks.",
          whatsappLink: { label: "Top up", url: siteLink("/portal/plan") },
        });
      }

      return {
        ...outcome,
        reason: verdict.reason,
        ...(paused.stopped > 0 ? { pausedForNoCredits: paused.stopped } : {}),
      };
    }

    return { ...outcome, reason: verdict.reason ?? "not_allowed" };
  }

  // 3. Upstream call.
  const result = await fetchTruckEvents(truck.truck_number, settings.ldbApiUrl);

  if (!result.ok) {
    await admin.from("search_logs").insert({
      user_id: truck.user_id,
      truck_number: truck.truck_number,
      source: "tracking",
      ok: false,
      http_status: result.httpStatus,
      response_ms: result.ms,
      events_found: 0,
      new_events: 0,
      error: result.error,
    });

    /*
     * A failing truck gets told about twice and then stopped.
     *
     * At FAILURE_WARN_AT the officer hears that it is failing, once, because
     * the usual cause is something only they can fix - a mistyped number, or a
     * lorry the toll network no longer reports. At the budget it is paused
     * rather than deleted: their crossings stay, the truck stays on the list,
     * and the reason is on the row so the page can say why instead of showing
     * a truck that mysteriously stopped.
     */
    const errors = truck.consecutive_errors + 1;
    const budget = resolveFailureBudget(truck, settings);
    const exhausted = errors >= budget;
    const warnNow = !exhausted && errors >= FAILURE_WARN_AT && truck.failure_warned_at === null;

    await admin
      .from("tracked_trucks")
      .update({
        last_polled_at: now.toISOString(),
        consecutive_errors: errors,
        is_active: exhausted ? false : truck.is_active,
        ...(exhausted
          ? { paused_reason: "repeated_failures" as const, paused_at: now.toISOString() }
          : {}),
        ...(warnNow ? { failure_warned_at: now.toISOString() } : {}),
      })
      .eq("id", truck.id);

    if (exhausted) {
      await recordTruckActivity(
        {
          userId: truck.user_id,
          truckId: truck.id,
          truckNumber: truck.truck_number,
          kind: "auto_paused",
          detail: { reason: "repeated_failures", failures: errors },
          at: now.toISOString(),
        },
        admin,
      );
      await sendSystemAlert({
        admin,
        context,
        truckNumber: truck.truck_number,
        kind: "tracking_paused",
        title: "Tracking paused after repeated failures",
        message:
          `We could not get records for this number after ${errors} checks in a row, so tracking ` +
          "is paused. Its recorded crossings are saved. Please check the number and switch it " +
          "back on from My trucks.",
        whatsappLink: { label: "Open truck", url: siteLink(`/portal/trucks/${truck.id}`) },
      });
    } else if (warnNow) {
      await sendSystemAlert({
        admin,
        context,
        truckNumber: truck.truck_number,
        kind: "tracking_failing",
        title: "No records for this truck",
        message:
          `${errors} checks in a row returned no result. Please verify the vehicle number. ` +
          `Tracking will pause after ${budget} unsuccessful checks in a row.`,
      });
    }

    /*
     * THE INTERVAL GOVERNS ATTEMPTS, NOT SUCCESSES - and this stamp is what
     * makes that true. Without it a failing truck was the most expensive truck
     * on the platform.
     *
     * last_run_at was only ever written on the success path further down, so a
     * truck whose lookup failed kept its old stamp, alertDue() saw it as still
     * due, and the very next sweep charged another credit and called the portal
     * again. The interval was silently replaced by the cron's own frequency.
     *
     * Measured on the live database before this fix: an alert set to every 15
     * minutes was checked at 10:00, 10:01, 10:02, 10:04, 10:06, 10:08, 10:10,
     * 10:12, 10:14, 10:16 and 10:18 - eleven calls in eighteen minutes, every
     * one an HTTP 500, ten credits gone. It should have been one.
     *
     * The credit is spent whether the portal answers or not, so the clock has
     * to move whether it answers or not. Only the alerts that were actually due
     * are stamped, which is exactly the set this function was handed.
     */
    if (alerts.length > 0) {
      const { error: stampError } = await admin
        .from("truck_alerts")
        .update({ last_run_at: now.toISOString() })
        .in(
          "id",
          alerts.map((alert) => alert.id),
        );
      if (stampError) {
        /* Loud, because the consequence is money: an unstamped alert retries on
           every sweep until somebody notices the balance. */
        console.error(
          `could not advance last_run_at for ${truck.truck_number} after a failed check`,
          stampError.message,
        );
      }
    }

    return {
      ...outcome,
      status: "failed",
      error: result.error,
      responseMs: result.ms,
      reason: exhausted ? "paused_after_repeated_errors" : undefined,
    };
  }

  // 4. Store movements, and count a return trip as one.
  //
  //    A plaza re-reports one physical crossing under several sequence numbers,
  //    so a reading at the same plaza as the previous stored one is usually
  //    noise. Usually - but not when the truck has been away and come back:
  //    Malvan at 11:00 and Malvan at 15:00 are two crossings, and dropping the
  //    second lost the whole return leg.
  //
  //    Time is what separates them. Same plaza inside the revisit window is
  //    the same crossing being re-reported; the same plaza hours later is news.
  //
  //    The walk is seeded from the truck's last SAVED crossing, so it reaches
  //    the same answer on every check: a repeat is skipped now and skipped
  //    again next time. The unique index on (user_id, seq_no) lets only one of
  //    two overlapping sweeps win.
  const { data: history } = await admin
    .from("truck_events")
    .select("seq_no, event_time, loc_name, direction")
    .eq("user_id", truck.user_id)
    .eq("truck_number", truck.truck_number)
    .order("event_time", { ascending: false, nullsFirst: false })
    .limit(50);

  let inserted: EventLike[] = [];

  if (result.events.length > 0) {
    const chronological = [...result.events].sort((a, b) =>
      (a.eventTime ?? "").localeCompare(b.eventTime ?? ""),
    );

    let previous = normaliseLocation(truck.last_location);
    let previousAt = truck.last_event_at;
    const movements: typeof chronological = [];

    for (const event of chronological) {
      const location = normaliseLocation(event.locName);
      // An unnamed plaza cannot be compared, so it always counts as a move.
      if (location !== null && location === previous && !isRevisit(previousAt, event.eventTime, settings.revisitMinutes)) {
        continue;
      }
      previous = location ?? previous;
      previousAt = event.eventTime ?? previousAt;
      movements.push(event);
    }

    if (movements.length > 0) {
      const { data: newRows, error: insertError } = await admin
        .from("truck_events")
        .upsert(
          movements.map((event) => ({
            user_id: truck.user_id,
            tracked_truck_id: truck.id,
            truck_number: truck.truck_number,
            seq_no: event.seqNo,
            event_time: event.eventTime,
            event_time_raw: event.eventTimeRaw,
            loc_name: event.locName,
            lat: event.lat,
            lng: event.lng,
            direction: event.direction,
            event_name: event.eventName,
          })),
          { onConflict: "user_id,seq_no", ignoreDuplicates: true },
        )
        .select("seq_no, event_time, loc_name, direction");

      if (insertError) {
        /* Same rule as an upstream failure: the credit is gone and the portal
           has already answered, so the clock moves. Otherwise a database error
           becomes a retry loop charging a credit per sweep. */
        if (alerts.length > 0) {
          await admin
            .from("truck_alerts")
            .update({ last_run_at: now.toISOString() })
            .in(
              "id",
              alerts.map((alert) => alert.id),
            );
        }
        return { ...outcome, status: "failed", error: `Storing events failed: ${insertError.message}` };
      }
      inserted = (newRows ?? []) as EventLike[];
    }
  }

  inserted.sort((a, b) => (b.event_time ?? "").localeCompare(a.event_time ?? ""));

  // Log the call only when it carried news. A truck that has not moved produces
  // a successful, empty check every few minutes; at fifty trucks that is over
  // 200,000 rows a month saying "nothing happened". Credits are counted by
  // spend_credits, not by counting rows here, so billing is unaffected.
  if (inserted.length > 0) {
    await admin.from("search_logs").insert({
      user_id: truck.user_id,
      truck_number: truck.truck_number,
      source: "tracking",
      ok: true,
      http_status: result.httpStatus,
      response_ms: result.ms,
      events_found: result.events.length,
      new_events: inserted.length,
      error: null,
    });

    await recordPlazas(admin, inserted.map((row) => row.loc_name));
  }

  const recentEvents: EventLike[] = [
    ...inserted,
    ...((history ?? []) as EventLike[]).filter(
      (row) => !inserted.some((event) => event.seq_no === row.seq_no),
    ),
  ].sort((a, b) => (b.event_time ?? "").localeCompare(a.event_time ?? ""));

  const latest = recentEvents[0] ?? null;
  const latestEventAt = latest?.event_time ?? truck.last_event_at ?? null;

  const position: Position = {
    locName: latest?.loc_name ?? truck.last_location,
    direction: latest?.direction ?? truck.last_direction,
    eventTime: latestEventAt,
  };

  // 5. Alerts, against the position this check just established.
  const drafts: AlertDraft[] = [];

  for (const alert of alerts) {
    const { draft, stateUpdate } = evaluateAlert({
      truckNumber: truck.truck_number,
      alert,
      position,
      now,
      plazaThreshold: settings.plazaMatchThreshold,
    });
    if (draft) drafts.push(draft);
    await admin.from("truck_alerts").update(stateUpdate).eq("id", alert.id);
  }

  const alertResult = await dispatchAlerts({
    admin,
    context,
    truckId: truck.id,
    truckNumber: truck.truck_number,
    drafts,
  });

  // 6. Roll the truck forward.
  //
  //    Nothing is written to a sheet here any more. Crossings are copied out
  //    in bulk before they are purged - see maybeExportAndPurge - so a check
  //    is one upstream call and one row update rather than a third-party
  //    write on the hot path.
  await admin
    .from("tracked_trucks")
    .update({
      last_polled_at: now.toISOString(),
      last_event_at: latestEventAt,
      last_location: position.locName,
      last_direction: position.direction,
      status: deriveStatus(latestEventAt, now, settings.noActivityHours),
      consecutive_errors: 0,
      // Cleared with the counter, so a truck that fails again later is warned
      // again rather than sliding silently towards its budget a second time.
      failure_warned_at: null,
    })
    .eq("id", truck.id);

  return {
    ...outcome,
    status: "checked",
    newEvents: inserted.length,
    alerts: alertResult.created,
    alertsDelivered: alertResult.delivered,
    responseMs: result.ms,
  };
}

/* -------------------------------------------------------------------------- */
/* stopping by itself                                                          */
/* -------------------------------------------------------------------------- */

/** How a paused truck is described to the person who owns it. */
const AUTO_PAUSE_MESSAGE = {
  schedule: {
    title: "Tracking ended as scheduled",
    body:
      "The end time set for this truck has arrived, so tracking has stopped and it uses no " +
      "more credits. Its history is saved. You can switch it back on from My trucks at any time.",
  },
  inactive: {
    title: "Tracking paused: no recent movement",
    body:
      "No new toll crossings for this truck within the set time, so tracking is paused to save " +
      "credits. Its recorded crossings are saved. Switch it back on from My trucks when the " +
      "truck is moving again.",
  },
} as const;

/**
 * Pauses every truck that has reached a stop of its own, and tells its owner
 * which stop it was.
 *
 * Runs over the candidate list at the top of a sweep, before any credit is
 * spent, because both of these decisions are made from the row itself - no
 * upstream call, so no reason to pay for one.
 *
 * The update is guarded on is_active still being true. Two sweeps can overlap,
 * and an officer can press pause by hand at the same moment; the guard means
 * whichever gets there first owns the reason, and the second one does not
 * overwrite "you paused this" with "it timed out" or send a second message
 * about a truck that is already stopped.
 *
 * Returns the ids it paused so the caller can drop them from this sweep, and a
 * count per reason so the sweep summary can report them.
 */
async function applyAutoPauses(
  admin: Admin,
  trucks: TrackedTruck[],
  settings: AppSettings,
  now: Date,
): Promise<{ ids: Set<string>; counts: { schedule: number; inactive: number } }> {
  const paused = new Set<string>();
  const counts = { schedule: 0, inactive: 0 };
  /* One officer usually owns several of the trucks stopping at once - a batch
     added together for one journey runs out together. Loading their settings
     and Telegram details once rather than once per truck is the difference
     between one round trip and thirty on a busy sweep. */
  const contexts = new Map<string, OfficerContext>();

  for (const truck of trucks) {
    const verdict = dueForAutoPause(truck, settings, now);
    if (!verdict) continue;

    const { data: stopped, error } = await admin
      .from("tracked_trucks")
      .update({
        is_active: false,
        paused_reason: verdict.reason,
        paused_at: now.toISOString(),
        // Cleared so restarting the truck does not immediately stop it again on
        // the deadline it has already passed.
        auto_pause_at: null,
      })
      .eq("id", truck.id)
      .eq("is_active", true)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (error) {
      console.error(`auto-pause failed for ${truck.truck_number}`, error.message);
      continue;
    }
    // Null means somebody else got there first. Nothing to say about it.
    if (!stopped) continue;

    paused.add(truck.id);
    counts[verdict.reason] += 1;

    await recordTruckActivity(
      {
        userId: truck.user_id,
        truckId: truck.id,
        truckNumber: truck.truck_number,
        kind: "auto_paused",
        detail: { reason: verdict.reason, ...(verdict.hours ? { hours: verdict.hours } : {}) },
        at: now.toISOString(),
      },
      admin,
    );

    const copy = AUTO_PAUSE_MESSAGE[verdict.reason];
    let context = contexts.get(truck.user_id);
    if (!context) {
      context = await loadOfficerContext(admin, truck.user_id);
      contexts.set(truck.user_id, context);
    }
    await sendSystemAlert({
      admin,
      context,
      truckNumber: truck.truck_number,
      kind: `tracking_paused_${verdict.reason}`,
      title: copy.title,
      message:
        verdict.reason === "inactive" && verdict.hours
          ? copy.body.replace("within the set time", `for ${describeHours(verdict.hours)}`)
          : copy.body,
    });
  }

  return { ids: paused, counts };
}

/**
 * Switches off every truck whose plan ended more than the grace period ago,
 * and tells its owner once.
 *
 * The plan lapsing already stops the checking - the candidate query below
 * filters on plan_expires_on, so not a single upstream call is made for a
 * lapsed account from the day it lapses. What this adds is the ending of that
 * state.
 *
 * WHY THE TWO STEPS ARE SEPARATE, AND WHY THE GAP IS SEVEN DAYS
 *
 * Between the plan ending and this running, the trucks stay switched on and
 * are simply not checked. That is what makes "renew and carry on" true: the
 * account comes back with the same trucks, the same alerts and the same
 * schedules, and there is nothing to set up again. Switching them off on day
 * zero would be tidier and would cost the customer an afternoon of clicking to
 * come back - which is an afternoon in which they do not come back.
 *
 * After seven days it is no longer a pause, it is a lapsed account, and a
 * truck that is switched on and has not been checked for a week is a lie on
 * the page. So the rows are made honest: is_active false, paused_reason
 * 'plan_expired' (added to the check constraint in 0038), and one message
 * saying nothing is lost.
 *
 * A NULL plan_expires_on can never reach here. The filter is a date comparison
 * and null fails it, which is exactly right: null means no expiry, it is the
 * state both founding customers are in, and neither of them is ever counted
 * down or switched off by this.
 *
 * Guarded on is_active still being true, like applyAutoPauses - an officer can
 * be pausing a truck by hand at the same moment, and whoever gets there first
 * owns the reason.
 */
async function applyPlanExpiryTeardown(
  admin: Admin,
  now: Date,
): Promise<{ trucks: number; accounts: number }> {
  /*
   * The last day that is still inside the grace period, in IST - the same
   * timezone the plan was sold in. A plan that ended exactly seven days ago
   * matches this date and `<` is false, so the seventh day is a full day to
   * renew in rather than the day the trucks stop.
   */
  const lastDay = istDaysAgo(PLAN_GRACE_DAYS);

  const { data: lapsed, error } = await admin
    .from("tracked_trucks")
    .select("id, user_id, truck_number, profiles!inner(plan_expires_on)")
    .eq("is_active", true)
    .lt("profiles.plan_expires_on", lastDay)
    .limit(500);

  if (error) {
    console.error("plan-expiry teardown could not list trucks", error.message);
    return { trucks: 0, accounts: 0 };
  }

  const rows = (lapsed ?? []) as { id: string; user_id: string; truck_number: string }[];
  if (rows.length === 0) return { trucks: 0, accounts: 0 };

  const contexts = new Map<string, OfficerContext>();
  let trucks = 0;

  for (const row of rows) {
    const { data: stopped, error: updateError } = await admin
      .from("tracked_trucks")
      .update({
        is_active: false,
        paused_reason: "plan_expired",
        paused_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("is_active", true)
      .select("id")
      .maybeSingle<{ id: string }>();

    if (updateError) {
      console.error(`plan-expiry teardown failed for ${row.truck_number}`, updateError.message);
      continue;
    }
    if (!stopped) continue;
    trucks += 1;

    await recordTruckActivity(
      {
        userId: row.user_id,
        truckId: row.id,
        truckNumber: row.truck_number,
        kind: "auto_paused",
        detail: { reason: "plan_expired" },
        at: now.toISOString(),
      },
      admin,
    );

    /*
     * Once per ACCOUNT, not once per truck. A lapsed fleet of forty stops in
     * one sweep, and forty identical messages saying the same thing about the
     * same plan is the fastest way to have the next one ignored. notToldToday
     * is keyed on the account and the kind, so the first truck's message is
     * the account's message.
     */
    let context = contexts.get(row.user_id);
    if (!context) {
      context = await loadOfficerContext(admin, row.user_id);
      contexts.set(row.user_id, context);
    }
    if (!(await notToldToday(admin, row.user_id, "plan_expired"))) continue;

    await sendSystemAlert({
      admin,
      context,
      truckNumber: null,
      kind: "plan_expired",
      title: "Your plan has ended",
      message:
        `Your plan ended more than ${PLAN_GRACE_DAYS} days ago, so tracking is paused on all ` +
        "trucks. Your trucks, history and credits are saved, and credits can still be used for " +
        "manual searches. Renew to resume, then switch your trucks back on from My trucks.",
    });
  }

  return { trucks, accounts: contexts.size };
}

/** "6 hours", "3 days" - the same duration the officer typed, read back to them. */
export function describeHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return "no time at all";
  if (hours % 24 === 0) {
    const days = hours / 24;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

/**
 * Keeps the plaza catalogue current. It is what the "alert me when the truck
 * reaches this plaza" dropdown is built from, so it has to learn names as the
 * platform sees them rather than being maintained by hand.
 */
async function recordPlazas(admin: Admin, names: (string | null)[]): Promise<void> {
  const unique = [...new Set(names.map((n) => n?.trim()).filter((n): n is string => Boolean(n)))];
  if (unique.length === 0) return;

  const { error } = await admin.from("toll_plazas").upsert(
    unique.map((name) => ({ name, last_seen_at: new Date().toISOString() })),
    { onConflict: "name", ignoreDuplicates: true },
  );
  if (error) console.error("toll_plazas upsert failed", error.message);
}

/* -------------------------------------------------------------------------- */
/* the sweep                                                                   */
/* -------------------------------------------------------------------------- */

export async function runTrackingSweep(
  options: { batch?: number; truckIds?: string[] } = {},
): Promise<SweepSummary> {
  const startedAt = new Date();
  const admin = getSupabaseAdmin();
  const settings = await loadSettings(admin);
  const batch = options.batch ?? DEFAULT_BATCH;

  const base = {
    startedAt: startedAt.toISOString(),
    trackingEnabled: settings.trackingEnabled,
    candidates: 0,
    due: 0,
    checked: 0,
    skipped: 0,
    failed: 0,
    newEvents: 0,
    alerts: 0,
    alertsDelivered: 0,
    deferred: 0,
    planExpired: { trucks: 0, accounts: 0 },
    autoPaused: { schedule: 0, inactive: 0 },
    noCreditsPaused: { trucks: 0, accounts: 0 },
    errors: [] as string[],
    outcomes: [] as PollOutcome[],
    backup: null as BackupSummary | null,
  };

  const finish = (partial: typeof base): SweepSummary => {
    const finishedAt = new Date();
    return {
      ...partial,
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };
  };

  /*
   * Phone notifications for announcements whose start time has arrived - how a
   * scheduled one buzzes at its hour without anybody pressing anything.
   *
   * HERE, NOT WITH THE HOUSEKEEPING AT THE END. The sweep returns early when
   * tracking is switched off or no truck is due, and the end is never reached
   * on those ticks - a quiet night would hold a 9am offer back until the first
   * lorry needed checking. Skipped for a run aimed at chosen trucks, which is
   * an admin checking something specific. Never throws, and each announcement
   * is sent at most once (see sendAnnouncementPush).
   */
  if (!options.truckIds?.length) {
    const announcementsPushed = await sendDueAnnouncementPushes();
    if (announcementsPushed > 0) {
      console.info(`[announcements] sent ${announcementsPushed} scheduled push(es)`);
    }
  }

  if (!settings.trackingEnabled) return finish(base);

  /*
   * Lapsed accounts are tidied first, and deliberately before the candidate
   * list is read: a truck switched off here must not also be picked up as a
   * candidate in the same sweep. It could not be checked anyway - the plan
   * filter below excludes it - but it would be counted as one.
   */
  const planExpired = await applyPlanExpiryTeardown(admin, startedAt);

  /*
   * Trial credits die with the trial, and this is where they are taken.
   *
   * Beside the plan-expiry teardown because they answer the same question a day
   * apart - what stops being true when a term ends - and running them together
   * means one sweep decides both rather than two schedules drifting. The
   * function does its own filtering (expired trial, never paid, balance above
   * zero), writes through the ledger so the drop is explained, and is
   * idempotent, so a second sweep in the same minute finds nothing.
   */
  /*
   * A plan ending no longer touches anybody's balance.
   *
   * This used to call expire_trial_credits() on every tick, which zeroed the
   * leftover credits of an expired trial that had never paid. 0057 reversed
   * that rule - credits survive every plan ending, and the only consequence
   * of a lapse is that automatic checking stops, which applyPlanExpiryTeardown
   * below and the auto_check guard in spend_credits already handle between
   * them. So there is nothing to do here, and the sweep is one round trip
   * lighter every two minutes.
   */

  /*
   * Active trucks, belonging to active officers, WHOSE PLAN HAS NOT RUN OUT.
   *
   * That last clause was missing, and it was a hole with a cost. This filtered
   * on profiles.status alone, so once a plan or a trial expired the worker
   * carried on checking every truck on the account and charging credits for it
   * until the balance emptied. Manual search is gated on the plan
   * (requireActivePlan in officer.ts); automatic checking was not, so the
   * expensive half of the product was the unguarded half - and it is the half
   * that runs every fifteen minutes without anybody watching.
   *
   * It matters more now than it did: until this release every plan was
   * lifetime, so plan_expires_on was null on every account and there was
   * nothing to enforce. Plans have terms from now on, which is exactly what
   * turns a dormant hole into a live one.
   *
   * `or` rather than a plain comparison because null means "no expiry set" -
   * the state every existing customer is in - and those accounts must keep
   * running. Only a date in the past stops a truck.
   *
   * IST, via the same ist_today the database uses, so a plan that runs "until
   * the 30th" is checked on the 30th in the timezone the customer bought it in.
   */
  let query = admin
    .from("tracked_trucks")
    .select("*, profiles!inner(status, plan_expires_on)")
    .eq("is_active", true)
    .eq("profiles.status", "active")
    /*
     * A PLAN IS REQUIRED FOR AUTOMATIC TRACKING, and plan_id is half of that
     * test rather than a formality.
     *
     * This used to filter on the expiry date alone - null or today or later -
     * and null passes. Null is what a LIFETIME plan carries, and it is equally
     * what an account holding NO PLAN AT ALL carries, so the two were
     * indistinguishable and an account that had never bought anything was
     * polled and charged a credit per check. Two such accounts existed when
     * this was found.
     *
     * The rule is: an active plan allows automatic tracking; an expired plan or
     * no plan allows manual search only. So both halves are tested here, the
     * same pair officer_overview.plan_active is built from.
     */
    .not("profiles.plan_id", "is", null)
    .or(`plan_expires_on.is.null,plan_expires_on.gte.${istToday()}`, {
      referencedTable: "profiles",
    })
    .order("last_polled_at", { ascending: true, nullsFirst: true })
    .limit(500);

  if (options.truckIds?.length) query = query.in("id", options.truckIds);

  const { data: candidates, error } = await query;
  if (error) {
    return finish({ ...base, planExpired, errors: [`Could not list trucks: ${error.message}`] });
  }

  const all = (candidates ?? []) as TrackedTruck[];
  if (all.length === 0) return finish({ ...base, planExpired });

  /*
   * The trucks that have reached a stop of their own, dealt with before
   * anything is checked.
   *
   * Before, on purpose. A truck past its auto-pause time must not be charged
   * for one last look on the way out - that is the whole thing the officer was
   * trying to avoid when they set the timer. Neither of these stops needs an
   * upstream call to decide, so both are settled from the row itself, and the
   * paused trucks drop out of this sweep entirely.
   */
  const autoPaused = await applyAutoPauses(admin, all, settings, startedAt);
  const running =
    autoPaused.ids.size > 0 ? all.filter((truck) => !autoPaused.ids.has(truck.id)) : all;

  // Every candidate stopped itself. Still a complete sweep, and the summary has
  // to say what it did rather than reading as "nothing happened".
  if (running.length === 0) {
    return finish({ ...base, planExpired, candidates: all.length, autoPaused: autoPaused.counts });
  }

  // A truck is checked because one of its alerts came due. Nothing else calls
  // for a check, so a truck with no alerts costs nothing and is never fetched.
  const { data: alertRows } = await admin
    .from("truck_alerts")
    .select("*, template:alert_rule_templates(*)")
    .eq("is_enabled", true)
    .in(
      "tracked_truck_id",
      running.map((truck) => truck.id),
    );

  const byTruck = new Map<string, TruckAlertWithTemplate[]>();
  for (const row of (alertRows ?? []) as TruckAlertWithTemplate[]) {
    // A rule the admin switched off stops firing without the officer losing it.
    if (!row.template?.is_active) continue;
    const list = byTruck.get(row.tracked_truck_id) ?? [];
    list.push(row);
    byTruck.set(row.tracked_truck_id, list);
  }

  const due = running
    .map((truck) => {
      const alerts = byTruck.get(truck.id) ?? [];
      const ready = options.truckIds?.length
        ? alerts
        : alerts.filter((alert) => alertDue(alert, startedAt));
      return { truck, alerts: ready };
    })
    .filter((item) => item.alerts.length > 0);

  const selected = due.slice(0, batch);

  // Load each officer's limits and integrations once, not once per truck.
  const contexts = new Map<string, OfficerContext>();
  for (const userId of new Set(selected.map((item) => item.truck.user_id))) {
    contexts.set(userId, await loadOfficerContext(admin, userId));
  }

  const outcomes = await mapWithConcurrency(
    selected,
    CONCURRENCY,
    ({ truck, alerts }) =>
      checkTruck({
        admin,
        truck,
        alerts,
        context: contexts.get(truck.user_id)!,
        settings,
        now: new Date(),
      }),
    /*
     * A truck that threw is reported as a failed check rather than ending the
     * sweep. It has almost certainly been charged - spend_credits runs before
     * the upstream call - so losing the whole summary would leave credits spent
     * and events written with nothing anywhere saying it happened.
     */
    ({ truck }, error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`checkTruck threw for ${truck.truck_number}`, error);
      return {
        truckId: truck.id,
        truckNumber: truck.truck_number,
        userId: truck.user_id,
        status: "failed" as const,
        reason: "unexpected_error",
        newEvents: 0,
        alerts: 0,
        alertsDelivered: 0,
        error: message,
      };
    },
  );

  const errors: string[] = [];

  // Housekeeping runs after the useful work and never blocks it: a failed
  // export must not cost the sweep the checks it already paid for.
  let backup: BackupSummary | null = null;
  try {
    const result = await maybeExportAndPurge();
    if (result.ran) backup = result;
    // Surfaced per table rather than as one line, because "nothing was
    // deleted" is only true of the tables whose copy actually failed.
    for (const entity of result.entities) {
      if (entity.error) errors.push(`${entity.entity}: ${entity.error}`);
    }
    errors.push(...result.errors);
  } catch (error) {
    console.error("export and purge failed", error);
    errors.push("The export could not run, so nothing was deleted.");
  }

  /*
   * Direct messages older than a week.
   *
   * Separate from maybeExportAndPurge, and deliberately so. That path exists to
   * copy rows into a customer's Google Sheet before deleting them, and it skips
   * any table it has no export shape for - a private conversation between a
   * customer and the desk is exactly the thing that must not be written to a
   * spreadsheet on its way out, so it gets its own delete instead of a shape.
   *
   * Every read is independently windowed to the same seven days, so a tick that
   * misses this - or a month of them - still shows nobody a message older than
   * the promise. This only keeps the table small.
   */
  const chatDeleted = await purgeOldChat();
  if (chatDeleted > 0) console.info(`[chat] purged ${chatDeleted} expired messages`);

  /* Counted off the outcomes rather than accumulated as the sweep runs,
     because the checks run concurrently and a shared counter would be a race.
     Only the truck whose refusal did the pausing carries a figure, and it
     already counts the account's other lorries, so summing is right and
     counting distinct accounts cannot double-count a fleet. */
  const noCreditsPaused = {
    trucks: outcomes.reduce((sum, o) => sum + (o.pausedForNoCredits ?? 0), 0),
    accounts: new Set(
      outcomes.filter((o) => (o.pausedForNoCredits ?? 0) > 0).map((o) => o.userId),
    ).size,
  };

  return finish({
    ...base,
    planExpired,
    candidates: all.length,
    autoPaused: autoPaused.counts,
    noCreditsPaused,
    due: due.length,
    deferred: Math.max(due.length - selected.length, 0),
    checked: outcomes.filter((o) => o.status === "checked").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    failed: outcomes.filter((o) => o.status === "failed").length,
    newEvents: outcomes.reduce((sum, o) => sum + o.newEvents, 0),
    alerts: outcomes.reduce((sum, o) => sum + o.alerts, 0),
    alertsDelivered: outcomes.reduce((sum, o) => sum + o.alertsDelivered, 0),
    errors,
    outcomes,
    backup,
  });
}


/* -------------------------------------------------------------------------- */
/* plan expiry reminders                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Tells a customer their plan is about to end, and that it has ended.
 *
 * Expiry itself was already enforced - spend_credits() refuses automatic
 * checks the day after plan_expires_on, and applyPlanExpiryTeardown() pauses
 * the trucks after the grace days - but nobody was warned beforehand, so a
 * plan simply went quiet. Four messages per expiry date, each sent once:
 *
 *   3 days before · the day before · on the last day · the day after it ended
 *
 * Push, Telegram (through sendSystemAlert, which also logs it in the alert
 * bell) and an email. Each one is keyed on the expiry date as well as the
 * stage, so renewing and lapsing again later warns again. Never throws.
 */
export async function sendPlanExpiryReminders(): Promise<{ sent: number }> {
  const admin = getSupabaseAdmin();
  let sent = 0;

  try {
    const stages = new Map<string, -1 | 0 | 1 | 3>([
      [istDaysAgo(-3), 3],
      [istDaysAgo(-1), 1],
      [istToday(), 0],
      [istDaysAgo(1), -1],
    ]);

    const { data, error } = await admin
      .from("profiles")
      .select("id, email, full_name, credits, plan_expires_on, plan:plans(name, is_trial)")
      .eq("role", "officer")
      .eq("status", "active")
      .not("plan_id", "is", null)
      .in("plan_expires_on", [...stages.keys()])
      .limit(200);

    if (error) {
      console.error("plan reminders: could not list accounts", error.message);
      return { sent };
    }

    const settings = await loadSettings(admin);

    for (const row of (data ?? []) as unknown as {
      id: string;
      email: string;
      full_name: string | null;
      credits: number;
      plan_expires_on: string;
      plan: { name: string; is_trial: boolean } | null;
    }[]) {
      const stage = stages.get(row.plan_expires_on);
      if (stage === undefined) continue;
      const kind = `plan_reminder:${row.plan_expires_on}:${stage}`;

      const { data: already } = await admin
        .from("alert_logs")
        .select("id")
        .eq("user_id", row.id)
        .eq("kind", kind)
        .limit(1);
      if ((already ?? []).length > 0) continue;

      const what = row.plan?.is_trial ? "Your free trial" : `Your ${row.plan?.name ?? ""} plan`.replace("  ", " ");
      const date = new Date(`${row.plan_expires_on}T00:00:00+05:30`).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        timeZone: "Asia/Kolkata",
      });
      const credits = Math.floor(Number(row.credits) || 0);
      const keep = `Your trucks, history and ${credits} credit${credits === 1 ? "" : "s"} stay safe, and manual search keeps working.`;

      const title =
        stage === 3 ? `${what} ends in 3 days`
        : stage === 1 ? `${what} ends tomorrow`
        : stage === 0 ? `${what} ends today`
        : `${what} has ended`;
      const message =
        stage === -1
          ? `Automatic tracking has stopped. ${keep} ${row.plan?.is_trial ? "Choose a plan" : "Renew"} to start tracking again.`
          : `Automatic tracking stops after ${date}. ${row.plan?.is_trial ? "Choose a plan" : "Renew"} to keep your trucks tracked — credits never expire.`;

      const context = await loadOfficerContext(admin, row.id);
      /* WhatsApp only for "ends tomorrow" (still time to act) and "has ended"
         (tracking stopped); the 3-day and same-day ones stay on the free channels. */
      const onWhatsApp = stage === 1 || stage === -1;
      await sendSystemAlert({
        admin,
        context,
        truckNumber: null,
        kind,
        title,
        message,
        ...(onWhatsApp
          ? { whatsappLink: { label: row.plan?.is_trial ? "Choose a plan" : "Renew", url: siteLink("/portal/plan") } }
          : {}),
      });

      if (row.email && canEmailCustomers()) {
        const url = `${env.siteUrl}/portal/plan`;
        const mail = await sendEmail({
          to: row.email,
          subject: `${title} — ${settings.brandName}`,
          html: shell(settings.brandName, title, [esc(message)], {
            label: stage === -1 || row.plan?.is_trial ? "Choose a plan" : "Renew now",
            url,
          }),
          text: `${title}\n\n${message}\n\n${url}`,
          replyTo: settings.supportEmail || null,
        });
        if (!mail.ok) console.error(`plan reminder mail not sent (${row.id}):`, mail.error);
      }
      sent += 1;
    }
  } catch (error) {
    console.error("plan reminders crashed:", error);
  }
  return { sent };
}
