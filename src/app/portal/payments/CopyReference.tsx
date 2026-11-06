"use client";

import { Check, Copy } from "lucide-react";

import { Mono, buttonClass, cx } from "@/components/ui";
import { useCopy } from "@/components/useCopy";

/**
 * The ids a support conversation runs on, each with a button that copies it.
 *
 * The one thing this screen must not lose. Whatever went wrong with a payment -
 * money gone and no credits, a duplicate charge, a card refused after the money
 * left - the first question asked is "what is the reference", and a customer
 * reading a twenty-character id off a phone screen to somebody on the telephone
 * gets it wrong. So it is selectable text AND a copy button, and the id is
 * never truncated: an id with the middle elided is an id that cannot be pasted.
 */

export type Reference = { label: string; value: string };

export function CopyReference({ items }: { items: Reference[] }) {
  /* Shared with the settings page's address box - see useCopy. Keyed by
     value, so two rows can never both flash a tick. */
  const { copied, problem, copy } = useCopy();

  return (
    <div className="rounded-xl border border-line bg-raised/60 p-3">
      <dl className="space-y-2">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <dt className="text-xs font-semibold text-muted">
                {item.label}
              </dt>
              {/* select-all so one tap highlights the whole id on a phone, and
                  break-all so a long one wraps instead of widening the panel
                  past the viewport. */}
              <dd className="mt-0.5">
                <Mono className="block break-all text-ink select-all">{item.value}</Mono>
              </dd>
            </div>
            <button
              type="button"
              onClick={() => void copy(item.value)}
              aria-label={`Copy ${item.label.toLowerCase()}`}
              className={buttonClass("secondary", "sm", "shrink-0")}
            >
              {copied === item.value ? <Check size={14} /> : <Copy size={14} />}
              <span className="sr-only sm:not-sr-only">
                {copied === item.value ? "Copied" : "Copy"}
              </span>
            </button>
          </div>
        ))}
      </dl>

      {problem ? (
        <p
          className={cx(
            "mt-2 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2",
            "text-xs leading-relaxed text-warn-500",
          )}
          role="status"
        >
          {problem}
        </p>
      ) : null}
    </div>
  );
}
