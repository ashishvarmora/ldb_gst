import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { CHAT_KEEP_DAYS, loadThreads } from "@/lib/chat";
import { fmtRelative } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The support desk: every customer who has said something this week.
 *
 * A queue before it is a history, so anything waiting for a reply sorts to the
 * top however long ago it was sent - see loadThreads. A conversation with
 * nothing outstanding is still listed, because "what did we tell them on
 * Tuesday" is the other question this page answers.
 *
 * Accounts that have never messaged do not appear at all. Starting a
 * conversation with a customer out of nowhere is a different feature with
 * different consent attached to it, and a list of every account with an empty
 * chat beside it would bury the four that are actually waiting.
 */
export const dynamic = "force-dynamic";

export default async function AdminChatPage() {
  await requireSuperAdmin();
  const threads = await loadThreads(getSupabaseAdmin());

  const waiting = threads.filter((thread) => thread.unreadForAdmin > 0).length;

  return (
    <>
      <PageHeader
        title="Messages"
        subtitle={`Direct conversations with customers. ${
          waiting > 0
            ? `${waiting} waiting for a reply.`
            : "Nothing is waiting for a reply."
        } Messages are deleted after ${CHAT_KEEP_DAYS} days.`}
      />

      <Panel bodyClassName="p-0">
        {threads.length === 0 ? (
          <EmptyState
            title="No conversations yet"
            description={`When a customer sends a message from their Messages page it appears here, and your phone buzzes. Nothing is kept longer than ${CHAT_KEEP_DAYS} days.`}
          />
        ) : (
          <ul className="divide-y divide-divider">
            {threads.map((thread) => (
              <li key={thread.userId}>
                <Link
                  href={`/admin/chat/${thread.userId}`}
                  className="flex items-center gap-3 px-4 py-3 transition hover:bg-raised/50 sm:px-5"
                >
                  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-sunken text-muted">
                    <MessageSquare size={16} />
                  </span>

                  {/* min-w-0 so a long preview truncates rather than pushing
                      the unread badge off the row on a phone. */}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-ink">{thread.name}</span>
                      <span className="shrink-0 text-[11px] whitespace-nowrap text-faint">
                        {fmtRelative(thread.lastMessageAt)}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {/* Who spoke last is the difference between "they are
                          waiting on us" and "we are waiting on them". */}
                      {thread.lastSenderRole === "admin" ? "You: " : ""}
                      {thread.lastBody}
                    </span>
                  </span>

                  {thread.unreadForAdmin > 0 ? (
                    <Badge tone="brand">{thread.unreadForAdmin} new</Badge>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
