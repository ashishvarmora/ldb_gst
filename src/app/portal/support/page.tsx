import {
  markCustomerThreadRead,
  pollCustomerThread,
  sendCustomerMessage,
} from "./actions";
import { ChatWindow } from "@/components/ChatWindow";
import { PageHeader } from "@/components/ui";
import { CHAT_KEEP_DAYS, loadThread } from "@/lib/chat";
import { requirePortalSession } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The customer's half of the conversation.
 *
 * Always exactly one thread - theirs - so there is nothing to choose and no
 * list to get lost in. Rendered on the server so the week's messages are on
 * screen in the first response rather than after a round trip, which on a phone
 * on a bad connection is the difference between a chat and a spinner.
 */
export const dynamic = "force-dynamic";

export default async function SupportPage() {
  /*
   * requirePortalSession, not assertPortalUser: every other page in the portal
   * uses it, and the difference matters here. It REDIRECTS a signed-out visitor
   * to the login page; assertPortalUser throws, which reaches the same place
   * via the layout but logs a stack trace on the way for something that is not
   * an error - somebody's session expiring while a tab was open.
   */
  const session = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [messages, settings] = await Promise.all([
    loadThread(admin, session.id, "customer"),
    loadSettings(admin),
  ]);

  const brand = settings.brandName || "Rahdari";

  return (
    /*
     * A fixed-height column rather than a growing page: the message list
     * scrolls inside itself and the box stays put at the bottom, which is what
     * makes this read as a chat rather than as a form at the end of a long
     * page. The subtraction is the portal header plus this page's own padding;
     * on a phone the bottom tab bar takes another slice, hence the two values.
     */
    <div className="flex h-[calc(100dvh-13rem)] flex-col lg:h-[calc(100dvh-9rem)]">
      <PageHeader
        title="Messages"
        subtitle={`Talk to the ${brand} team directly. Replies come back here, and to your phone if you have notifications switched on.`}
      />

      <ChatWindow
        initial={messages}
        poll={pollCustomerThread}
        send={sendCustomerMessage}
        onSeen={markCustomerThreadRead}
        placeholder="Type your message"
        emptyTitle="No messages yet"
        emptyBody={`Ask us anything — about a truck, your plan, a payment, or anything that looks wrong. Someone from ${brand} will reply here.`}
        keepDays={CHAT_KEEP_DAYS}
      />
    </div>
  );
}
