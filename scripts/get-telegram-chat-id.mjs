/**
 * Prints the chat id of everyone who has messaged your bot.
 *
 *   node scripts/get-telegram-chat-id.mjs
 *
 * A plain BotFather bot does not reply on its own, so this is how you read an
 * officer's chat id after they have sent /start.
 *
 * Ask the officer to open your bot and send /start FIRST, then run this. Their
 * name and numeric id appear in the list; paste the id on their admin page.
 *
 * Note: Telegram keeps undelivered updates for about 24 hours, and this uses
 * getUpdates, which fails while a webhook is set on the bot.
 */

import { readFileSync } from "node:fs";

function loadEnvFile(path) {
  try {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key]) continue;
      process.env[key] = rawValue.replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env.local - fall back to the real environment.
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const token = process.argv[2] ?? process.env.TELEGRAM_BOT_TOKEN;

if (!token) {
  console.error(
    "No bot token. Put TELEGRAM_BOT_TOKEN in .env.local, or pass it:\n" +
      "  node scripts/get-telegram-chat-id.mjs 1234567890:AAH...",
  );
  process.exit(1);
}

/**
 * Some Windows/IPv6 setups fail the first connection to api.telegram.org and
 * succeed on a retry, so a one-off blip should not crash the script.
 */
async function fetchRetry(url, attempts = 4) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(url);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
    }
  }
  console.error(`Could not reach api.telegram.org: ${lastError?.message ?? lastError}`);
  console.error("Check your internet connection, or whether Telegram is blocked on this network.");
  process.exit(1);
}

const meResponse = await fetchRetry(`https://api.telegram.org/bot${token}/getMe`);
const me = await meResponse.json();

if (!me.ok) {
  console.error(`Token rejected by Telegram: ${me.description ?? "unknown error"}`);
  process.exit(1);
}

console.log(`Bot: @${me.result.username} (${me.result.first_name})\n`);

const response = await fetchRetry(`https://api.telegram.org/bot${token}/getUpdates`);
const body = await response.json();

if (!body.ok) {
  console.error(`Could not read updates: ${body.description ?? "unknown error"}`);
  if (/webhook/i.test(body.description ?? "")) {
    console.error("A webhook is set on this bot, so getUpdates is disabled.");
  }
  process.exit(1);
}

const chats = new Map();
for (const update of body.result ?? []) {
  const message = update.message ?? update.edited_message ?? update.channel_post;
  const chat = message?.chat;
  if (!chat) continue;
  const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || chat.title || "";
  chats.set(chat.id, { name, username: chat.username, type: chat.type });
}

if (chats.size === 0) {
  console.log("Nobody has messaged this bot in the last 24 hours.");
  console.log(`Ask the officer to open https://t.me/${me.result.username} and send /start,`);
  console.log("then run this again.");
  process.exit(0);
}

console.log("Chat id      Name / username");
console.log("-----------  --------------------------------");
for (const [id, info] of chats) {
  const label = info.username ? `${info.name} (@${info.username})` : info.name;
  console.log(`${String(id).padEnd(11)}  ${label}${info.type === "private" ? "" : ` [${info.type}]`}`);
}
console.log("\nPaste the chat id on the officer's page in the admin console.");
