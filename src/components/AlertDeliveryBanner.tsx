import { cache } from "react";
import Link from "next/link";
import { BellOff, ChevronRight } from "lucide-react";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TelegramConfig } from "@/lib/types";

/**
 * The one failure in this product that costs money and says nothing.
 *
 * dispatchAlerts() in src/lib/tracking.ts needs a Telegram chat id to send
 * anything. Without one it STILL writes the alert_logs row - with
 * delivered:false and a delivery_error nobody reads - so the alert turns up in
 * the bell, the check that raised it has already been charged, and no message
 * ever leaves the building. From the officer's side the app looks like it is
 * working: rows appear, the balance goes down, the phone stays silent.
 *
 * So this is announced site-wide rather than on the one screen where it is
 * discoverable. It was already said on Home - and only there, only once a plan
 * was live, and only when an alert rule existed - which is three ways of not
 * being seen by the person spending the credits.
 */

/**
 * The same test the worker makes, spelled the same way round.
 *
 * dispatchAlerts() requires `is_enabled` AND a non-empty chat_id, so anything
 * looser here would promise a delivery the worker will not attempt. Note this
 * is deliberately NOT officer_overview.telegram_connected: that column is
 * `chat_id is not null and is_enabled`, which cannot tell a missing chat id
 * from a saved one that has been switched off - and those two need different
 * instructions - and it reads an empty string as connected where the worker's
 * Boolean(chat_id) reads it as missing.
 */
export type AlertDelivery = "ready" | "no-chat-id" | "switched-off";

/**
 * Cached per request, so a page that also needs the answer shares the layout's
 * round trip rather than making a second one to Tokyo.
 */
export const loadAlertDelivery = cache(async (userId: string): Promise<AlertDelivery> => {
  const { data } = await getSupabaseAdmin()
    .from("telegram_configs")
    .select("chat_id, is_enabled")
    .eq("user_id", userId)
    .maybeSingle<Pick<TelegramConfig, "chat_id" | "is_enabled">>();

  // No row and a null or empty chat_id are the same answer to the same
  // question: there is nowhere to send a message.
  if (!data?.chat_id) return "no-chat-id";
  return data.is_enabled ? "ready" : "switched-off";
});

/**
 * The two broken states, told apart because the fix is not the same.
 *
 * `fix` is what the reader does next, and it is the second half of the strip
 * rather than a separate button: the whole line is the link, which is a far
 * bigger tap target than three underlined words and leaves room for nothing
 * else on a 390px phone.
 *
 * `detail` is the part that will not fit on one line - what it is actually
 * costing - hung on the title attribute for a desktop hover. It is not the
 * load-bearing half: somebody who reads only the strip still knows what is
 * wrong and where to go.
 */
const COPY: Record<Exclude<AlertDelivery, "ready">, { fix: string; detail: string }> = {
  "no-chat-id": {
    fix: "Add a Telegram chat id",
    detail:
      "No Telegram chat id is saved, so alerts are raised and charged for but never sent to your phone. Add one in Settings.",
  },
  "switched-off": {
    fix: "Turn Telegram back on",
    detail:
      "Your Telegram chat id is saved but sending is switched off, so alerts are raised and charged for but never reach your phone. Turn it back on in Settings.",
  },
};

/**
 * One line, at the top of every portal page.
 *
 * NOT DISMISSIBLE, and that is a decision rather than an omission. A dismissal
 * that outlived the fault would hide a fault that is quietly spending money,
 * and a dismissal that did not would be a control that achieves nothing. This
 * disappears the moment delivery works - which is one tap and one field away -
 * so the only way to be rid of it is to fix it. It also keeps this a Server
 * Component: no state, no client bundle, no flash of a banner on every page
 * load while sessionStorage is consulted.
 */
export function AlertDeliveryBanner({
  delivery,
  /** Trucks on the account at all, paused ones included. */
  trucks,
}: {
  delivery: AlertDelivery;
  trucks: number;
}) {
  // Nothing to fail to deliver until there is a truck. An account still being
  // set up is not being warned about a consequence it has not reached.
  if (trucks < 1 || delivery === "ready") return null;

  const { fix, detail } = COPY[delivery];

  return (
    <Link
      href="/portal/settings#alerts"
      title={detail}
      className="flex min-h-9 items-center gap-2 border-b border-warn-500/30 bg-warn-500/12 px-4 text-xs text-warn-500 transition hover:bg-warn-500/20"
    >
      <BellOff size={14} className="shrink-0" />
      {/* truncate is the guarantee that this stays the single line it is
          supposed to be, whatever the reader's font size does to it. The copy
          is short enough not to need it at 390px, and the title above carries
          the whole sentence either way. */}
      <span className="min-w-0 flex-1 truncate">
        <span className="font-semibold">Alerts are not reaching you.</span>{" "}
        <span className="underline decoration-warn-500/40 underline-offset-2">{fix}</span>
      </span>
      <ChevronRight size={14} className="shrink-0" />
    </Link>
  );
}
