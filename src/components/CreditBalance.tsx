import Link from "next/link";
import { AlertTriangle, ArrowRight, Coins } from "lucide-react";

import { cx } from "@/components/ui";
import { TOPUP_HREF, formatCredits, type CreditStanding } from "@/lib/credits";

/**
 * How a balance reads when it is running out, and the way out of it.
 *
 * These two live together because they answer the same three questions and
 * must answer them identically wherever a balance appears: whether this
 * balance is worth mentioning at all, where the fix is, and what the fix is
 * called at zero as against merely low. They were three separate copies of a
 * hard-coded LOW_CREDITS = 10 before, in the layout, the account sheet and the
 * dashboard, and the dashboard's disagreed with the sheet's.
 *
 * No "use client": this is markup and a href, so it drops into a Server
 * Component page and into the account sheet, which is a Client Component.
 */

/**
 * Whether to offer a top-up at all.
 *
 * Credits cannot be bought without a live plan - the form on the plan page
 * refuses it and says so. Pointing somebody at a purchase that will turn them
 * away is worse than saying nothing, and an account with no plan is already
 * being told what to do about it in half a dozen louder places.
 */
function shouldNudge(standing: CreditStanding, planActive: boolean): boolean {
  return planActive && standing !== "ok";
}

/** Beside a balance, wherever the balance is not already next to a top-up. */
export function TopUpLink({
  standing,
  planActive,
  className,
}: {
  standing: CreditStanding;
  planActive: boolean;
  className?: string;
}) {
  // Renders nothing when there is nothing to say, so a call site is one line
  // and can never leave a stale nudge on screen.
  if (!shouldNudge(standing, planActive)) return null;

  return (
    <Link
      href={TOPUP_HREF}
      className={cx(
        // min-h-9 rather than padding: this turns up inside a 90px-wide tile on
        // a phone and needs a thumb-sized target without making the line
        // around it taller.
        "inline-flex min-h-9 items-center gap-1 text-xs font-medium whitespace-nowrap",
        standing === "empty" ? "text-bad-500" : "text-warn-500",
        "underline decoration-current/40 underline-offset-2 transition hover:decoration-current",
        className,
      )}
    >
      {/* Two different jobs, so two different words. At zero the search is
          already being refused and this is the only way to carry on; above it
          the balance is merely worth a glance. Both kept short because of that
          90px tile. */}
      {standing === "empty" ? "Top up now" : "Top up"}
      <ArrowRight size={12} aria-hidden className="shrink-0" />
    </Link>
  );
}

/**
 * The balance the whole app runs on, in the header on every page. Nobody
 * should have to open the dashboard to find out whether their next search will
 * work.
 *
 * The pill is the whole link, so the way out cannot be a TopUpLink nested
 * inside it - it is the pill's own last two words instead, and the pill lands
 * on the top-up panel rather than the top of the plan page when there is
 * something to fix.
 */
export function CreditPill({
  credits,
  standing,
  planActive,
}: {
  credits: number;
  standing: CreditStanding;
  planActive: boolean;
}) {
  const nudge = shouldNudge(standing, planActive);

  const tone =
    standing === "empty"
      ? "border-bad-500/40 bg-bad-500/12 text-bad-500"
      : standing === "low"
        ? "border-warn-500/40 bg-warn-500/12 text-warn-500"
        : "border-line bg-raised text-muted";

  return (
    <Link
      href={nudge ? TOPUP_HREF : "/portal/plan"}
      title={nudge ? "Credits left — tap to top up" : "Credits left"}
      className={cx(
        // Taller only when it carries a link, so the tap target clears the
        // phone minimum without the header row growing for everybody else.
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-xs whitespace-nowrap transition hover:brightness-105",
        nudge ? "min-h-10" : "min-h-8",
        tone,
      )}
    >
      {standing === "empty" ? (
        <AlertTriangle size={12} aria-hidden className="shrink-0" />
      ) : (
        <Coins size={12} aria-hidden className="shrink-0" />
      )}

      {/*
        Words, not just a colour: "Too low" says the state on a monochrome
        screen and to anybody who cannot tell the amber pill from the grey one,
        where a bare "0 left" only reads as a number that happens to be small.

        "Too low" rather than "No credits" because empty is not always zero -
        a balance under the price of one search is refused too - and the pill
        is the one place with no room to say which. The figure itself is one tap
        away, in the account sheet and on the plan page.
      */}
      {standing === "empty" ? (
        <span className="font-medium">Too low</span>
      ) : (
        <>
          <span className="font-medium tabular-nums">{formatCredits(credits)}</span>
          <span className="opacity-70">left</span>
        </>
      )}

      {nudge ? (
        <>
          <span aria-hidden className="opacity-40">
            ·
          </span>
          <span className="font-semibold underline decoration-current/40 underline-offset-2">
            Top up
          </span>
        </>
      ) : null}
    </Link>
  );
}
