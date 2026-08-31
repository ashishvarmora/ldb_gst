import { Check, Truck, Wallet } from "lucide-react";

import { Badge, cx } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
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
 * No hooks, so both the server plan list and the client editor can render it.
 */
export function PlanPreview({
  name,
  description,
  pricePerMonth,
  includedCredits,
  truckLimit,
  isActive = true,
  className,
}: {
  name: string;
  description?: string | null;
  pricePerMonth: number;
  includedCredits: number;
  truckLimit: number;
  isActive?: boolean;
  className?: string;
}) {
  const free = !Number.isFinite(pricePerMonth) || pricePerMonth <= 0;

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
        {isActive ? null : <Badge tone="warn">not on sale</Badge>}
      </div>

      <p className="mt-1.5 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-strong">
          {free ? "Free" : fmtRupees(pricePerMonth)}
        </span>
        {free ? null : <span className="text-xs text-muted">per month</span>}
      </p>

      {description ? (
        <p className="mt-2 text-xs leading-relaxed text-muted">{description}</p>
      ) : null}

      <ul className="mt-3 space-y-1.5 border-t border-divider pt-3 text-xs text-ink">
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
        {free ? "Start free" : `Buy ${name || "this plan"}`}
      </p>
    </div>
  );
}
