import Link from "next/link";

import { MessageSquare } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * The messages icon, in the header, on both sides of the product.
 *
 * WHY IT IS A LINK AND NOT A PANEL. The alert bell beside it opens a dropdown
 * because a truck alert is read and dismissed in place - there is nowhere else
 * to go. A message is the opposite: reading it means opening the conversation
 * and answering, so a panel would be one extra tap in front of the only thing
 * anybody wants to do. This goes straight there.
 *
 * WHY IT EXISTS AT ALL WHEN THE NAVIGATION ALREADY HAS A BADGE. Both
 * navigations are desktop-only: the portal's sidebar is lg: and up, and the
 * admin console's is behind a hamburger. So on a phone - which is the device
 * this product is actually used on - the Messages badge was somewhere nobody
 * could see it without going looking. The header is the one strip that is
 * always on screen.
 *
 * A server component. It renders a number the layout already has and has no
 * behaviour of its own, so there is no reason to send any JavaScript for it.
 */
export function MessageBell({
  unread,
  href,
  className,
}: {
  unread: number;
  href: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-label={unread > 0 ? `Support chat, ${unread} unread` : "Support chat"}
      className={cx(
        /*
         * size-10 to match the alert bell it sits beside, rather than the
         * size-9 the admin console's other header controls use. Two adjacent
         * circles of different sizes read as a mistake, and this one has to
         * survive a thumb.
         */
        "relative inline-flex size-10 shrink-0 items-center justify-center rounded-lg border transition",
        unread > 0
          ? "border-brand-500/40 bg-brand-500/10 text-brand-500 hover:bg-brand-500/15"
          : "border-line bg-panel text-muted hover:bg-sunken hover:text-ink",
        className,
      )}
    >
      <MessageSquare size={20} /><span className="support-chat-label">Help</span>
      {unread > 0 ? (
        <span className="absolute -top-1 -right-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad-500 px-1 text-[10px] font-semibold text-on-brand tabular-nums">
          {unread > 99 ? "99+" : unread}
        </span>
      ) : null}
    </Link>
  );
}
