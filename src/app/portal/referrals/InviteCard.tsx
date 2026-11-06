import Link from "next/link";
import { Gift } from "lucide-react";

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
        "invite-card pressable relative isolate flex items-center gap-3.5 overflow-hidden rounded-[20px] bg-navy px-4 py-4 text-white shadow-[0_16px_32px_-20px_rgb(15_27_61/0.8)]",
        className,
      )}
    >
      {/* A saffron sun in the corner, the same device as the balance card. */}
      <span
        aria-hidden
        className="absolute -right-6 -bottom-16 -z-10 size-36 rounded-full bg-white/[0.06]"
      />
      <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 text-white ring-1 ring-white/15">
        <Gift size={28} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[16px] font-bold">Invite & earn credits</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-white/75">
          Get credits when your friend makes their first payment.
        </span>
      </span>
      <Gift size={46} strokeWidth={1.6} aria-hidden className="invite-gift shrink-0 -rotate-6" />
    </Link>
  );
}
