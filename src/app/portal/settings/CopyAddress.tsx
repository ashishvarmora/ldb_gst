"use client";

import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

import { Input } from "@/components/form";
import { buttonClass, cx } from "@/components/ui";

/**
 * The service-account address, in a box that can be copied.
 *
 * The one client component on this page. Sharing a sheet means pasting this
 * address into Google's own dialog, and an address typed out by hand from a
 * phone screen is an address typed out wrongly - after which the export fails
 * silently and the reader has no idea why.
 */

/** Long enough to read the tick, short enough not to look stuck. */
const TICK_MS = 2000;

export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), TICK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    setProblem(null);
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // friendlyError is not used here on purpose: it reads database and
      // network failures, and a blocked clipboard says "permission denied",
      // which it would turn into a sentence about a record. The address is on
      // screen either way, so the honest advice is to select it.
      setProblem("Copying did not work on this device. Tap the address to select it instead.");
    }
  }

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
          onClick={() => void copy()}
          className={buttonClass("secondary", "md", "shrink-0")}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          <span className="sr-only sm:not-sr-only">{copied ? "Copied" : "Copy"}</span>
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
