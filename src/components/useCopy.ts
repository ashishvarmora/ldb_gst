"use client";

import { useEffect, useState } from "react";

/**
 * Copy a string, show a tick, and cope with a clipboard that refuses.
 *
 * Two components had grown their own copy of this - the payment reference list
 * and the settings page's service-account address - with the same state, the
 * same timer, the same try/catch and the same fallback sentence. Their layouts
 * genuinely differ (a labelled list against a single boxed value), so the
 * presentation is not what was duplicated; the mechanics were.
 *
 * Keyed by value rather than a boolean, so a list of several ids can show a
 * tick on exactly the row that was tapped. A single-value caller passes its one
 * value and reads `copied !== null`.
 */

/** How long the tick stays. Long enough to notice, short enough not to linger. */
const TICK_MS = 1600;

export function useCopy(): {
  /** The value currently showing a tick, or null. */
  copied: string | null;
  /** Set when the clipboard refused, so the caller can say what to do instead. */
  problem: string | null;
  copy: (value: string) => Promise<void>;
} {
  const [copied, setCopied] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), TICK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy(value: string) {
    setProblem(null);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      /*
       * Some in-app browsers refuse the clipboard outright, and an insecure
       * origin has no clipboard API at all. The failure is not worth an error
       * dialog: the value is already on screen, so the useful thing to say is
       * how to get it by hand. Deliberately not the caught error's own message,
       * which says "permission denied" and means nothing to the reader.
       */
      setProblem("Copying did not work on this device. Press and hold the text to select it.");
    }
  }

  return { copied, problem, copy };
}
