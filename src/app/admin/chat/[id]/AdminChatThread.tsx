"use client";

import { useCallback } from "react";

import { markAdminThreadRead, pollAdminThread, sendAdminMessage } from "@/app/portal/support/actions";
import { ChatWindow } from "@/components/ChatWindow";
import type { ChatMessage } from "@/lib/chat";

/**
 * Binds this customer's id to the three actions ChatWindow needs.
 *
 * A server component can hand a client component a server action, but not a
 * closure over one - so the binding has to happen on this side of the boundary.
 * That is the whole of this file's job.
 *
 * useCallback rather than inline arrows: ChatWindow's polling effect depends on
 * the identity of `poll` and `onSeen`, and a new function on every render would
 * tear the interval down and build it again four times a minute.
 */
export function AdminChatThread({
  userId,
  initial,
  keepDays,
}: {
  userId: string;
  initial: ChatMessage[];
  keepDays: number;
}) {
  const poll = useCallback(() => pollAdminThread(userId), [userId]);
  const onSeen = useCallback(() => markAdminThreadRead(userId), [userId]);

  return (
    <ChatWindow
      initial={initial}
      viewerRole="admin"
      poll={poll}
      send={sendAdminMessage}
      onSeen={onSeen}
      hiddenFields={{ user_id: userId }}
      placeholder="Reply to this customer"
      emptyTitle="Nothing here yet"
      emptyBody="This customer has not sent anything, or their messages have passed the seven-day window. Anything you send lands in their Messages page and on their phone."
      keepDays={keepDays}
    />
  );
}
