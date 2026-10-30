"use server";

import { revalidatePath } from "next/cache";

import { reportError } from "@/lib/errors";
import { bool, done, fail, str } from "@/lib/forms";
import { assertPortalUser } from "@/lib/officer";
import { sendPushToUser } from "@/lib/push";
import { loadSettings } from "@/lib/settings";
import { spreadsheetIdFromUrl } from "@/lib/sheets";
import { PHONE_ERROR, normaliseIndianMobile } from "@/lib/phone";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram";
import type { ActionResult, GoogleSheetConfig, TelegramConfig } from "@/lib/types";

/* -------------------------------------------------------------------------- */
/* the customer's own details                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Longest each detail may be. Matches what the admin form accepts, so a value
 * typed here cannot be one the console then refuses to show.
 */
const MAX = { full_name: 80, phone: 13, designation: 60, office: 120, district: 60, state: 60 };

/**
 * The account holder editing their own details.
 *
 * Six columns, and deliberately not the seventh: email is the sign-in name and
 * changing it would change who the account is, which needs proof the new
 * address is reachable before the old one stops working. Neither it nor the
 * password is touched here - the page says where each of those is done.
 *
 * `role`, `status`, `credits`, `plan_id` and the rest are absent from the
 * update on purpose. This runs on the service-role client, which is past Row
 * Level Security, so the column list *is* the permission check: naming only
 * these six is what stops a crafted post from granting itself a plan.
 */
export async function updateMyProfile(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();

  const fullName = str(fd, "full_name");
  if (!fullName) return fail("Tell us your name - it is what your account is called on screen.");
  if (fullName.length > MAX.full_name) {
    return fail(`That name is too long. Keep it under ${MAX.full_name} characters.`);
  }

  /*
   * The same rule sign-up and the admin's own officer form use, and stored in
   * the same normalised shape.
   *
   * This was a loose pattern - /^[+\d][\d\s()-]{5,19}$/ - chosen so a real
   * number would never be refused for its punctuation. Reasonable in isolation,
   * wrong in a system: it accepted "12345", a landline and a non-Indian number,
   * all of which sign-up rejects, so one account could hold a format another
   * refused and nobody could tell which was authoritative.
   *
   * It also has a cost the loose version could not see coming. The checkout now
   * prefills Razorpay's contact field from this column, and a prefilled value
   * that is not a reachable mobile is worse than an empty box: the buyer has to
   * notice it is wrong and clear it before they can type. Normalising here
   * means a stored number is either usable or absent.
   *
   * Compulsory, and enforced HERE rather than only by the input's `required`.
   * That attribute is a convenience for the person filling the form in and
   * nothing more - it is one devtools edit or one hand-made POST away from
   * being gone - so a rule that matters has to hold on the server too.
   *
   * It also means an account created before the number was required is asked
   * for one the next time its owner saves this form. That is deliberate: the
   * whole value of the column is being able to ring somebody when their
   * account is broken, and a column that is optional in practice cannot be
   * relied on for that.
   */
  const phone = normaliseIndianMobile(str(fd, "phone"));
  if (phone === null) return fail(PHONE_ERROR);

  const fields = { full_name: fullName, phone, ...pick(fd, ["designation", "office", "district", "state"]) };

  for (const [key, value] of Object.entries(fields)) {
    const limit = MAX[key as keyof typeof MAX];
    if (value && value.length > limit) {
      return fail(`That ${key.replace("_", " ")} is too long. Keep it under ${limit} characters.`);
    }
  }

  const { error } = await getSupabaseAdmin()
    .from("profiles")
    .update(fields)
    .eq("id", session.id);

  if (error) {
    return fail(reportError("saving own profile", error, "Could not save those details."));
  }

  /* The header and the profile sheet both render the name, and they live in the
     layout - so every portal page has a stale copy of it until this runs. */
  revalidatePath("/portal", "layout");
  return done("Saved.");
}

/** Trimmed values for the named fields, blank becoming null so a cleared box clears the column. */
function pick(fd: FormData, names: string[]): Record<string, string | null> {
  return Object.fromEntries(names.map((name) => [name, str(fd, name)]));
}

/* -------------------------------------------------------------------------- */
/* alert delivery                                                              */
/* -------------------------------------------------------------------------- */

export async function saveMyTelegram(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const chatId = str(fd, "chat_id");
  if (chatId && !/^-?\d{5,20}$/.test(chatId)) {
    return fail("A chat id is a plain number, like 123456789. The bot replies with yours.");
  }

  const { error } = await admin.from("telegram_configs").upsert(
    {
      user_id: session.id,
      chat_id: chatId,
      // Always on: customers get no switch for alerts (owner, 30 Oct 2026).
      // Leaving the chat id empty is what sends nothing.
      is_enabled: true,
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return fail(reportError("saving telegram settings", error, "Could not save those settings."));
  }

  revalidatePath("/portal/settings");
  return done(chatId ? "Saved. Send a test message to confirm it works." : "Chat id cleared.");
}

export async function testMyTelegram(
  _prev: ActionResult | null,
  _fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const [{ data: config }, { brandName }] = await Promise.all([
    admin.from("telegram_configs").select("*").eq("user_id", session.id).maybeSingle<TelegramConfig>(),
    loadSettings(admin),
  ]);

  if (!config?.chat_id) return fail("Save your chat id first.");

  // The brand is admin-typed and the message is sent as HTML, so the three
  // characters Telegram parses as markup have to be escaped first.
  const brand = brandName.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const result = await sendTelegramMessage({
    chatId: config.chat_id,
    botToken: config.bot_token,
    text: `<b>${brand} is connected</b>\n\nThis is a test message. Alerts for your tracked trucks will arrive here.`,
  });

  await admin
    .from("telegram_configs")
    .update({
      verified_at: result.ok ? new Date().toISOString() : config.verified_at,
      last_error: result.ok ? null : result.error,
    })
    .eq("user_id", session.id);

  revalidatePath("/portal/settings");

  return result.ok
    ? done("Test message sent. Check Telegram.")
    : fail(
        reportError(
          "telegram test message",
          result.error,
          "The test message did not go through. Check the chat id and that you have started the bot.",
        ),
      );
}

/* -------------------------------------------------------------------------- */
/* notifications on the phone itself                                           */
/* -------------------------------------------------------------------------- */

/**
 * What the browser hands back from pushManager.subscribe(), flattened.
 *
 * Not the browser's own PushSubscription object: that has methods on it and
 * cannot cross a Server Action boundary, and its JSON form nests the two keys
 * under `keys`. PushSetup.tsx unpacks it before calling, so what arrives here
 * is four strings and nothing that can behave.
 */
export type SubscriptionInput = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
};

/**
 * Stores one install's subscription so the tracking worker can reach it.
 *
 * ON CONFLICT ON THE ENDPOINT, AND user_id IS PART OF THE UPDATE. The endpoint
 * identifies an install, not a person, so the same phone signing in as somebody
 * else must MOVE the row rather than add a second one - otherwise the previous
 * occupant of that phone keeps receiving its notifications. On a shared handset
 * that is the same leak public/sw.js refuses to cache HTML for. See migration
 * 0054.
 *
 * Nothing is validated beyond shape and length. There is no format to check -
 * an endpoint is whatever url the push service minted - and a wrong one fails
 * on the first send and is pruned there.
 */
export async function savePushSubscription(input: SubscriptionInput): Promise<ActionResult> {
  const session = await assertPortalUser();

  const endpoint = input?.endpoint?.trim() ?? "";
  const p256dh = input?.p256dh?.trim() ?? "";
  const auth = input?.auth?.trim() ?? "";

  // A subscription with a piece missing cannot be encrypted to, so it would sit
  // in the table failing every send.
  if (!endpoint || !p256dh || !auth) {
    return fail("Your browser did not return a complete subscription. Try again.");
  }
  if (!/^https:\/\//i.test(endpoint) || endpoint.length > 2000) {
    return fail("That does not look like a push address your browser produced.");
  }

  const { error } = await getSupabaseAdmin().from("push_subscriptions").upsert(
    {
      user_id: session.id,
      kind: "web",
      endpoint,
      p256dh,
      auth,
      // Truncated because a user-agent string is unbounded and this column is
      // only ever read by a person trying to tell one install from another.
      user_agent: input.userAgent?.slice(0, 400) ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    /* reportError logs the original. The endpoint is not in it - Supabase
       reports the constraint, not the value - and it must not be: an endpoint
       is a bearer credential for that phone's notifications. */
    return fail(reportError("saving push subscription", error, "Could not switch notifications on."));
  }

  revalidatePath("/portal/settings");
  return done("Notifications are on for this device. Send yourself a test to be sure.");
}

/**
 * Stores the Android/iOS app's Firebase registration token.
 *
 * The app's WebView has no Web Push, so PushSetup.tsx registers with FCM
 * through the Capacitor plugin and sends the token here instead of a
 * subscription. Same table, kind 'fcm', token in `endpoint`, and the same
 * conflict rule as savePushSubscription() and for the same reason: a phone
 * handed to somebody else must move its row. See migration 0058.
 *
 * Removing one goes through removePushSubscription(), which deletes by
 * endpoint and so works for a token unchanged.
 */
export async function saveNativePushToken(input: {
  token: string;
  userAgent?: string | null;
}): Promise<ActionResult> {
  const session = await assertPortalUser();

  const token = input?.token?.trim() ?? "";
  // FCM tokens are ~150-200 characters of url-safe base64 and a colon or two.
  if (!token || token.length > 4096 || !/^[\w:.\-]+$/.test(token)) {
    return fail("The app did not return a usable notification token. Try again.");
  }

  const { error } = await getSupabaseAdmin().from("push_subscriptions").upsert(
    {
      user_id: session.id,
      kind: "fcm",
      endpoint: token,
      p256dh: null,
      auth: null,
      user_agent: input.userAgent?.slice(0, 400) ?? null,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: "endpoint" },
  );

  if (error) {
    return fail(reportError("saving app push token", error, "Could not switch notifications on."));
  }

  revalidatePath("/portal/settings");
  return done("Notifications are on for this phone. Send yourself a test to be sure.");
}

/**
 * Forgets one install.
 *
 * The endpoint comes from the browser rather than a row id, because the caller
 * is the install itself: it has just cancelled its own subscription and this is
 * the only handle it has. Scoped to the session's own rows regardless, so a
 * guessed endpoint cannot unsubscribe somebody else's phone.
 *
 * Silent about an endpoint that is not there. Unsubscribing something already
 * gone is the outcome the caller wanted, and the browser's own
 * subscription.unsubscribe() can legitimately have run first.
 */
export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  const session = await assertPortalUser();

  const value = endpoint?.trim();
  if (!value) return fail("Nothing to switch off on this device.");

  const { error } = await getSupabaseAdmin()
    .from("push_subscriptions")
    .delete()
    .eq("user_id", session.id)
    .eq("endpoint", value);

  if (error) {
    return fail(reportError("removing push subscription", error, "Could not switch notifications off."));
  }

  revalidatePath("/portal/settings");
  return done("Notifications are off for this device.");
}

/**
 * One notification, now.
 *
 * THE MOST IMPORTANT BUTTON IN THIS FILE. Web Push on an iPhone needs iOS 16.4,
 * the app added to the Home Screen, permission granted inside that installed
 * copy, and notifications left on for it in iOS Settings - and every one of
 * those failing looks identical from the officer's side: they tapped a button
 * and nothing happened. Without a test they cannot tell setting it up from
 * receiving it, and neither can whoever they ring about it.
 *
 * It sends to every install on the account rather than only the one that asked,
 * which is deliberate: "my phone is quiet but my laptop buzzed" is the answer
 * to the question they are actually asking.
 */
export async function testMyPush(): Promise<ActionResult> {
  const session = await assertPortalUser();
  const { brandName } = await loadSettings(getSupabaseAdmin());

  const result = await sendPushToUser(session.id, {
    title: `${brandName} is connected`,
    body: "This is a test. Alerts for your tracked trucks will arrive like this.",
    tag: "test",
    url: "/portal/settings#alerts",
  });

  if (result.ok) {
    return done(
      result.sent === 1
        ? "Sent. It should appear on your phone within a few seconds."
        : `Sent to ${result.sent} devices. It should appear within a few seconds.`,
    );
  }

  /* A skipped send is a state, not a fault: no keys on the platform, or nothing
     subscribed yet. Both already have their own line on the panel, so this says
     what happened without logging an error nobody has to act on. */
  if (result.skipped) return fail(result.error);

  return fail(
    reportError(
      "push test notification",
      result.error,
      "The test did not arrive. Check notifications are allowed for this app in your phone's Settings.",
    ),
  );
}

/* -------------------------------------------------------------------------- */
/* the customer's own sheet                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Names the sheet this account's history is copied into before it is cleared
 * from the app.
 *
 * Blank is a real answer, not an incomplete form: it means "I have no sheet of
 * my own", and the operator's fallback sheet keeps the copy so nothing is ever
 * deleted uncopied.
 */
export async function saveMySheet(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const raw = str(fd, "sheet_url");
  const enabled = bool(fd, "is_enabled");

  const { data: current } = await admin
    .from("google_sheet_configs")
    .select("spreadsheet_id, last_synced_at")
    .eq("user_id", session.id)
    .maybeSingle<Pick<GoogleSheetConfig, "spreadsheet_id" | "last_synced_at">>();

  const spreadsheetId = raw ? spreadsheetIdFromUrl(raw) : null;

  if (raw && !spreadsheetId) {
    return fail(
      "That does not look like a Google Sheets link. Open your sheet, copy the whole address out of the browser bar, and paste it here.",
    );
  }

  // A new sheet has never been written to, so carrying the old timestamp over
  // would show a copy that is not in the sheet the reader is looking at.
  const movedSheet = (current?.spreadsheet_id ?? null) !== spreadsheetId;

  const { error } = await admin.from("google_sheet_configs").upsert(
    {
      user_id: session.id,
      spreadsheet_id: spreadsheetId,
      /*
       * Rebuilt from the id rather than stored as pasted. A link copied while
       * scrolling carries a tab and a cell reference on the end of it, and the
       * id is the only part that identifies the sheet.
       */
      sheet_url: spreadsheetId
        ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`
        : null,
      is_enabled: enabled,
      last_synced_at: movedSheet ? null : (current?.last_synced_at ?? null),
      // Any earlier failure was about the sheet being replaced here.
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    return fail(reportError("saving sheet settings", error, "Could not save that sheet."));
  }

  revalidatePath("/portal/settings");

  if (!spreadsheetId) {
    return done("Sheet removed. Your history is still copied out - just not to a sheet of yours.");
  }
  return done(
    enabled
      ? "Saved. Make sure the sheet is shared as Editor with the address above, or nothing can be written to it."
      : "Saved, and switched off. Nothing will be written to your sheet until you switch it back on.",
  );
}
