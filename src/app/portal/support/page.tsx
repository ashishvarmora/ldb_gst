import { markCustomerThreadRead, pollCustomerThread, sendCustomerMessage } from "./actions";
import { ChatWindow } from "@/components/ChatWindow";
import { SupportChatShell, SupportEmptyState } from "@/components/SupportChatShell";
import { CHAT_KEEP_DAYS, loadThread } from "@/lib/chat";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
export const dynamic = "force-dynamic";
export default async function SupportPage() {
 const session=await requirePortalSession();
 const messages=await loadThread(getSupabaseAdmin(),session.id,"customer");
 return <SupportChatShell><ChatWindow initial={messages} poll={pollCustomerThread} send={sendCustomerMessage}
   onSeen={markCustomerThreadRead} placeholder="Write your message…" emptyTitle="How can we help?" emptyBody="Tell us what you need help with."
   emptyState={<SupportEmptyState/>} keepDays={CHAT_KEEP_DAYS}/></SupportChatShell>;
}
