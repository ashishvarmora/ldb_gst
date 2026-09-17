import Link from "next/link";

import { MessageSquare } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * The admin console's only bell, and it rings for one thing: a customer is
 * waiting for a reply.
 *
 * WHY IT IS A LINK AND NOT A PANEL. The portal's bell opens a dropdown because
 * a truck alert is read and dismissed in place - there is nowhere else to go.
 * A message is the opposite: reading it means opening the conversation and
 * answering, so a panel would be one extra tap in front of the only thing
 * anybody wants to do. This goes straight to the queue.
 *
 * The count is in the sidebar too, on the Messages row. That row is off screen
 * below the desktop breakpoint - the whole console navigation is behind a
 * hamburger on a phone - so without this the one thing that needs answering
 * today would be invisible to an admin holding a phone.
 *
 * A server component: it renders a number the layout already has and has no
 * behaviour of its own, so there is no reason to send any JavaScript for it.
 */
export function AdminMessageBell({ unread }: { unread: number }) {
  return (
    <Link
      href="/admin/chat"
      aria-label={unread > 0 ? `Messages, ${unread} waiting` : "Messages"}
      className={cx(
        "relative inline-flex size-9 items-center justify-center rounded-lg border transition",
        unread > 0
          ? "border-brand-500/40 bg-brand-500/10 text-brand-500 hover:bg-brand-500/15"
          : "border-line bg-panel text-muted hover:bg-sunken hover:text-ink",
      )}
    >
      <MessageSquare size={15} />
      {unread > 0 ? (
        <span className="absolute -top-1 -right-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad-500 px-1 text-[10px] font-semibold text-on-brand tabular-nums">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
