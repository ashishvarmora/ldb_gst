import { CalendarClock, Check, Gift, Infinity as InfinityIcon, Truck, Wallet } from "lucide-react";

import { Badge, cx } from "@/components/ui";
import { formatCredits, planChargeInr, planExpiryNote, planTermSuffix } from "@/lib/credits";
import { fmtRupees } from "@/lib/format";
import { formatLimit } from "@/lib/limits";

/**
 * A plan as a customer sees it.
 *
 * Since plans are bought rather than assigned, every number in the editor is a
 * number a stranger reads before paying. Showing the card next to the form is
 * the cheapest way to stop a price or a credit allocation going out looking
 * wrong - the admin never has to open the public page to check.
 *
 * The figure it leads with is the one that will be charged, which since 0042 is
 * simply the price: there is no multiplier left for a preview to get wrong. It
 * used to take price_per_month times the term and print a small "Rs 199 a
 * month" underneath, which is the line the owner asked to see the back of.
 *
 * No hooks, so both the server plan list and the client editor can render it.
 */
export function PlanPreview({
  name,
  description,
  priceInr,
  durationDays,
  includedCredits,
  truckLimit,
  isActive = true,
  isTrial = false,
  trialDays = null,
  className,
}: {
  name: string;
  description?: string | null;
  priceInr: number;
  /** The term in days, the way the column stores it. Null is no expiry. */
  durationDays?: number | null;
  includedCredits: number;
  truckLimit: number;
  isActive?: boolean;
  isTrial?: boolean;
  trialDays?: number | null;
  className?: string;
}) {
  const term = {
    price_inr: priceInr,
    duration_days:
      typeof durationDays === "number" && Number.isFinite(durationDays) && durationDays > 0
        ? durationDays
        : null,
    is_trial: isTrial,
    trial_days: trialDays,
  };
  const charge = planChargeInr(term);
  const free = !Number.isFinite(charge) || charge <= 0;
  const noExpiry = !isTrial && term.duration_days === null;

  return (
    <div
      className={cx(
        "rounded-xl border border-line/70 bg-panel/60 p-4",
        !isActive && "opacity-60",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-base font-semibold text-strong">{name || "Untitled plan"}</p>
        {isTrial ? <Badge tone="brand">free trial</Badge> : null}
        {isActive ? null : <Badge tone="warn">not on sale</Badge>}
      </div>

      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-2xl font-semibold tabular-nums text-strong">
          {free ? "Free" : fmtRupees(charge)}
        </span>
        {free ? null : <span className="text-xs text-muted">{planTermSuffix(term)}</span>}
      </p>

      {description ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">{description}</p>
      ) : null}

      <ul className="mt-3 space-y-1.5 border-t border-divider pt-3 text-xs text-ink">
        <li className="flex items-center gap-2">
          {isTrial ? (
            <Gift size={13} className="shrink-0 text-brand-500" />
          ) : noExpiry ? (
            <InfinityIcon size={13} className="shrink-0 text-brand-500" />
          ) : (
            <CalendarClock size={13} className="shrink-0 text-brand-500" />
          )}
          {/* One helper, so this sentence cannot fall out of step with the
              picker beside it or with the card the customer buys from. */}
          {isTrial
            ? `Runs for ${trialDays ?? 7} day${trialDays === 1 ? "" : "s"}, then stops`
            : planExpiryNote(term)}
        </li>
        <li className="flex items-center gap-2">
          <Wallet size={13} className="shrink-0 text-brand-500" />
          {includedCredits > 0
            ? `${formatCredits(includedCredits)} credits included`
            : "No credits included — buy a top-up pack"}
        </li>
        <li className="flex items-center gap-2">
          <Truck size={13} className="shrink-0 text-brand-500" />
          {truckLimit === 0
            ? "No trucks tracked automatically"
            : `Track up to ${formatLimit(truckLimit).toLowerCase()} truck${truckLimit === 1 ? "" : "s"} at once`}
        </li>
        <li className="flex items-center gap-2">
          <Check size={13} className="shrink-0 text-brand-500" />
          Manual searches paid from the same credit balance
        </li>
      </ul>

      {/* Decoration, not a control: this block is a picture of the public page. */}
      <p
        aria-hidden
        className="mt-3 rounded-lg bg-brand-500/12 py-2 text-center text-xs font-medium text-brand-500"
      >
        {isTrial ? "Start the free trial" : free ? "Contact support" : `Buy ${name || "this plan"}`}
      </p>
    </div>
  );
}
