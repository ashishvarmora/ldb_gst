"use server";

import { revalidatePath } from "next/cache";

import { bool, done, fail, str } from "@/lib/forms";
import { assertPortalUser, loadOverview } from "@/lib/officer";
import { spreadsheetIdFromUrl, testSheetAccess } from "@/lib/sheets";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendTelegramMessage } from "@/lib/telegram";
import type { ActionResult, TelegramConfig } from "@/lib/types";

export async function saveMyTelegram(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const overview = await loadOverview(session.id);
  if (!overview) return fail("Could not read your account. Sign in again.");
  if (!overview.telegram_enabled) {
    return fail("Telegram alerts are not enabled on your plan. Ask your administrator.");
  }

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

  if (error) return fail(error.message);

  revalidatePath("/portal/settings");
  return done(chatId ? "Saved. Send a test message to confirm it works." : "Chat id cleared.");
}

export async function testMyTelegram(
  _prev: ActionResult | null,
  _fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const overview = await loadOverview(session.id);
  if (!overview?.telegram_enabled) {
    return fail("Telegram alerts are not enabled on your plan.");
  }

  const { data: config } = await admin
    .from("telegram_configs")
    .select("*")
    .eq("user_id", session.id)
    .maybeSingle<TelegramConfig>();

  if (!config?.chat_id) return fail("Save your chat id first.");

  const result = await sendTelegramMessage({
    chatId: config.chat_id,
    botToken: config.bot_token,
    text:
      "<b>Truck Watch is connected</b>\n\nThis is a test message. Alerts for your tracked trucks will arrive here.",
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
    : fail(result.error);
}

export async function saveMySheet(
  _prev: ActionResult | null,
  fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const overview = await loadOverview(session.id);
  if (!overview) return fail("Could not read your account. Sign in again.");
  if (!overview.google_sheet_enabled) {
    return fail("Google Sheet sync is not enabled on your plan. Ask your administrator.");
  }

  const url = str(fd, "sheet_url");
  const spreadsheetId = spreadsheetIdFromUrl(url);
  if (url && !spreadsheetId) {
    return fail("That does not look like a Google Sheets link. Copy the URL from your browser.");
  }

  const { error } = await admin.from("google_sheet_configs").upsert(
    {
      user_id: session.id,
      sheet_url: url,
      spreadsheet_id: spreadsheetId,
      is_enabled: bool(fd, "is_enabled"),
      last_error: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) return fail(error.message);

  revalidatePath("/portal/settings");
  return done(
    spreadsheetId
      ? "Saved. Use “Test connection” to check the sheet is shared with us."
      : "Sheet disconnected.",
  );
}

export async function testMySheet(
  _prev: ActionResult | null,
  _fd: FormData,
): Promise<ActionResult> {
  const session = await assertPortalUser();
  const admin = getSupabaseAdmin();

  const { data: config } = await admin
    .from("google_sheet_configs")
    .select("spreadsheet_id")
    .eq("user_id", session.id)
    .maybeSingle();

  if (!config?.spreadsheet_id) return fail("Save your sheet link first.");

  const result = await testSheetAccess(config.spreadsheet_id);

  await admin
    .from("google_sheet_configs")
    .update({
      last_synced_at: result.ok ? new Date().toISOString() : null,
      last_error: result.ok ? null : result.error,
    })
    .eq("user_id", session.id);

  revalidatePath("/portal/settings");

  return result.ok
    ? done("Connected. The tabs have been created in your sheet.")
    : fail(result.error);
}
