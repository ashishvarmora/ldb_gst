/**
 * WHICH BOTS AN OFFICER HAS TO PRESS START ON, named in one place.
 *
 * There are two, they do different jobs, and conflating them is why officers
 * finish the setup and never receive an alert:
 *
 *   @userinfobot          reads your numeric chat id back to you, and nothing
 *                         else. Third-party, no relation to this platform.
 *   ALERT_BOT_USERNAME    ours - every alert is sent from it. Telegram forbids
 *                         a bot from messaging anyone who has not sent it a
 *                         /start, so without this one a correct chat id is
 *                         saved, the check is charged, the alert row is
 *                         written, and the phone stays silent.
 *
 * A plain module with no imports, because both a Server Component and
 * src/lib/errors.ts want the name - errors.ts is a lib and must not reach into
 * a component for it, and a component must not pull the server-only env module
 * into a browser bundle to get it.
 *
 * NOT DERIVED FROM THE TOKEN. api.telegram.org/getMe would answer this exactly,
 * but it is a network round trip on the render path of three screens to learn a
 * string that changes when somebody swaps bots, which is roughly never. So it
 * is a constant, env-overridable: point TELEGRAM_BOT_TOKEN at a different bot
 * and set NEXT_PUBLIC_TELEGRAM_BOT_USERNAME to match, or every screen sends
 * officers to /start a bot that no longer sends them anything - a failure with
 * no symptom other than silence.
 *
 * The default is the bot the live token belongs to, read back from getMe rather
 * than typed from memory.
 */
export const ALERT_BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "Gst_truck_watch_bot";

/** The bot that reads your own chat id back to you, and does nothing else. */
export const ID_BOT_USERNAME = "userinfobot";

/**
 * `?start=1` so the chat opens with a Start button already on it.
 *
 * A deep link rather than a name to retype, which is the owner's standing
 * preference and is also the only reliable route: typing either name into
 * Telegram's search returns a row of imitations sharing the same avatar, and
 * @userinfobot has several. Without the parameter Telegram opens the
 * conversation and leaves the reader hunting for the control.
 */
export const ALERT_BOT_START_URL = `https://t.me/${ALERT_BOT_USERNAME}?start=1`;
export const ID_BOT_START_URL = `https://t.me/${ID_BOT_USERNAME}?start=1`;
