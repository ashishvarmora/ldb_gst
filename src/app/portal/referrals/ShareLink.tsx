"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";

import { Field, Input } from "@/components/form";
import { Mono, buttonClass, cx } from "@/components/ui";

/**
 * The link, the code, and the two ways anyone actually passes them on.
 *
 * The only client component on this page: the clipboard and the share sheet
 * live in the browser and have no server equivalent, so everything else stays
 * a Server Component and ships no JavaScript.
 */

type Copied = "link" | "code" | null;

/** Long enough to read the tick, short enough not to look stuck. */
const TICK_MS = 2000;

export function ShareLink({
  link,
  code,
  brandName,
}: {
  link: string;
  code: string;
  brandName: string;
}) {
  const [copied, setCopied] = useState<Copied>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  // Detected after mount rather than during render: the server has no
  // navigator, so deciding this any earlier makes the first paint disagree
  // with the browser and React throws away the markup.
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), TICK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const message = `I use ${brandName} to keep track of my trucks. Sign up with my link: ${link}`;

  async function copy(value: string, which: Exclude<Copied, null>) {
    setProblem(null);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
    } catch {
      // friendlyError is deliberately not used here. It reads database and
      // network failures, and a blocked clipboard says "permission denied" -
      // which it would translate into a sentence about a record. The link is
      // on screen either way, so the honest advice is to select it.
      setProblem("Copying did not work on this device. Select the link above and copy it yourself.");
    }
  }

  async function share() {
    setProblem(null);
    try {
      await navigator.share({ title: brandName, text: message, url: link });
    } catch (error) {
      // Closing the share sheet without picking anything throws AbortError.
      // Nothing went wrong, so nothing should be said.
      if ((error as { name?: string } | null)?.name === "AbortError") return;
      setProblem("Sharing did not work on this device. Copy the link instead.");
    }
  }

  return (
    <div>
      <Field label="Your invite link" name="referral_link">
        <Input
          id="referral_link"
          readOnly
          value={link}
          // Tapping it selects the whole link, so it can still be copied by
          // hand on a browser that refuses the clipboard.
          onFocus={(e) => e.currentTarget.select()}
          className="font-mono text-xs"
        />
      </Field>

      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void copy(link, "link")}
          className={buttonClass("primary", "md", "flex-1 sm:flex-none")}
        >
          {copied === "link" ? <Check size={15} /> : <Copy size={15} />}
          {copied === "link" ? "Link copied" : "Copy link"}
        </button>

        {canShare ? (
          <button
            type="button"
            onClick={() => void share()}
            className={buttonClass("secondary", "md", "flex-1 sm:flex-none")}
          >
            <Share2 size={15} />
            Share
          </button>
        ) : null}
      </div>

      {/* Someone reading the link out over the phone needs the code, not the
          whole URL. It is typed on the sign-up form instead. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-3">
        <p className="text-xs text-muted">
          Or give them your code:{" "}
          <Mono className="font-semibold tracking-wider text-ink">{code}</Mono>
        </p>
        <button
          type="button"
          onClick={() => void copy(code, "code")}
          className={buttonClass("ghost", "sm")}
        >
          {copied === "code" ? <Check size={13} /> : <Copy size={13} />}
          {copied === "code" ? "Copied" : "Copy code"}
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
