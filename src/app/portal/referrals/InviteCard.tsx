import Link from "next/link";
import { ChevronRight, Gift } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * The way onto the referral page from the screens people actually open - Home
 * and the plan page. It lives here, next to the page it points at, so the two
 * callers cannot drift into describing the reward differently.
 *
 * It says what the reward turns on, because "invite a friend" on its own sets
 * up exactly the disappointment the referral page then has to undo.
 *
 * On a phone this is also the route to that page: the bottom tab bar holds five
 * tabs and they are all things somebody uses daily.
 */
export function InviteCard({ className }: { className?: string }) {
  return (
    <Link
      href="/portal/referrals"
      className={cx(
        "panel flex items-center gap-3 px-4 py-3.5 transition hover:border-line-strong",
        className,
      )}
    >
      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
        <Gift size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-strong">Invite someone, earn credits</span>
        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
          Credits land on your balance when the person you invited makes their first payment.
        </span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-faint" />
    </Link>
  );
}
