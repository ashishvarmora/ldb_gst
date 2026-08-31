"use server";

import { revalidatePath } from "next/cache";

import { reportError } from "@/lib/errors";
import { bool, done, fail, str } from "@/lib/forms";
import { assertPortalUser } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { spreadsheetIdFromUrl } from "@/lib/sheets";
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
const MAX = { full_name: 80, phone: 20, designation: 60, office: 120, district: 60, state: 60 };

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

  const phone = str(fd, "phone");
  /*
   * Loose on purpose. Numbers arrive with +91, with spaces, with dashes and
   * with a leading 0, and refusing a real number somebody can be reached on is
   * worse than storing an oddly punctuated one.
   */
  if (phone && !/^[+\d][\d\s()-]{5,19}$/.test(phone)) {
    return fail("That does not look like a phone number. Digits, spaces and + are all fine.");
  }

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
      is_enabled: bool(fd, "is_enabled"),
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
