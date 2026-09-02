"use client";

import { Check, Copy } from "lucide-react";

import { Input } from "@/components/form";
import { useCopy } from "@/components/useCopy";
import { buttonClass, cx } from "@/components/ui";

/**
 * The service-account address, in a box that can be copied.
 *
 * The one client component on this page. Sharing a sheet means pasting this
 * address into Google's own dialog, and an address typed out by hand from a
 * phone screen is an address typed out wrongly - after which the export fails
 * silently and the reader has no idea why.
 */

export function CopyAddress({ address }: { address: string }) {
  /* The clipboard mechanics live in useCopy - this file and the payment
     reference list had grown two copies of the same state, timer and
     try/catch. Only the presentation differs, and only the presentation is
     still here. */
  const { copied, problem, copy } = useCopy();

  return (
    <div>
      <div className="flex items-end gap-2">
        <Input
          readOnly
          value={address}
          aria-label="Address to share the sheet with"
          // Tapping it selects the whole address, so it can still be copied by
          // hand on a browser that refuses the clipboard.
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 font-mono text-xs"
        />
        <button
          type="button"
          onClick={() => void copy(address)}
          className={buttonClass("secondary", "md", "shrink-0")}
        >
          {copied !== null ? <Check size={15} /> : <Copy size={15} />}
          <span className="sr-only sm:not-sr-only">{copied !== null ? "Copied" : "Copy"}</span>
        </button>
      </div>

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
