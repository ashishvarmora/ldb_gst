"use client";

import { useEffect, useState } from "react";
import { Check, Copy, MessageCircle, Share2 } from "lucide-react";

import { Input } from "@/components/form";
import { Mono, buttonClass, cx } from "@/components/ui";

/**
 * The link, the code, and the ways people actually pass them on: Copy and
 * WhatsApp side by side, the phone's own share sheet underneath when there is
 * one.
 *
 * WhatsApp is a plain wa.me link rather than a script, so it works before this
 * component hydrates and on browsers without navigator.share. On Android it
 * opens WhatsApp with the message ready and lets the reader pick the chat.
 *
 * The only client component on this page: the clipboard and the share sheet
 * live in the browser, so everything else stays a Server Component.
 */

type Copied = "link" | "code" | null;

/** Long enough to read the tick, short enough not to look stuck. */
const TICK_MS = 2000;

/**
 * The text that goes out with the link. Short, because it is read in a chat
 * bubble. Promises the friend credits only when the welcome share is on, and
 * names no amount, so a change in the settings cannot make it wrong.
 */
function inviteMessage(brandName: string, link: string, inviteeEarns: boolean): string {
  return inviteeEarns
    ? `I use ${brandName} to track my trucks. Join with my link and get bonus credits when you pay: ${link}`
    : `I use ${brandName} to track my trucks. Join with my link: ${link}`;
}

export function ShareLink({
  link,
  code,
  brandName,
  inviteeEarns,
}: {
  link: string;
  code: string;
  brandName: string;
  /** Whether the invited friend is paid anything - decides the message. */
  inviteeEarns: boolean;
}) {
  const [copied, setCopied] = useState<Copied>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [canShare, setCanShare] = useState(false);

  // Detected after mount: the server has no navigator, so deciding this during
  // render would make the first paint disagree with the browser.
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), TICK_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const message = inviteMessage(brandName, link, inviteeEarns);
  const whatsappHref = `https://wa.me/?text=${encodeURIComponent(message)}`;

  async function copy(value: string, which: Exclude<Copied, null>) {
    setProblem(null);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(which);
    } catch {
      // Not friendlyError: a blocked clipboard says "permission denied", which
      // that would turn into a sentence about a record.
      setProblem("Could not copy on this phone. Tap the link above, then copy it.");
    }
  }

  async function share() {
    setProblem(null);
    try {
      // The link is already inside the text; passing it as `url` as well makes
      // several Android apps paste it twice.
      await navigator.share({ title: brandName, text: message });
    } catch (error) {
      // Closing the share sheet without picking anything throws AbortError.
      if ((error as { name?: string } | null)?.name === "AbortError") return;
      setProblem("Could not open sharing. Use Copy link instead.");
    }
  }

  return (
    <div>
      <label htmlFor="referral_link" className="sr-only">
        Your invite link
      </label>
      <Input
        id="referral_link"
        readOnly
        value={link}
        // Tapping it selects the whole link, so it can still be copied by
        // hand on a browser that refuses the clipboard.
        onFocus={(e) => e.currentTarget.select()}
        className="font-mono text-xs"
      />

      {/* Two equal buttons on every width: on a 360px phone each is ~140px,
          enough for an icon and one word. */}
      <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
        <button
          type="button"
          onClick={() => void copy(link, "link")}
          className={buttonClass("primary", "md", "w-full")}
        >
          {copied === "link" ? <Check size={17} /> : <Copy size={17} />}
          {copied === "link" ? "Copied!" : "Copy link"}
        </button>

        <a
          href={whatsappHref}
          target="_blank"
          rel="noopener noreferrer"
          /* Not buttonClass("primary"): its brand-fill class is repainted
             orange by the light theme. Same shape and size as the button
             beside it, in WhatsApp green a shade darker than the logo so
             white text on it stays readable in sunlight. */
          className={cx(
            "inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full border px-4 py-2",
            "text-[15px] font-bold text-white transition",
            "border-[#128c3c] bg-[#168a42] hover:bg-[#127a39]",
            "focus-visible:ring-2 focus-visible:ring-[#168a42]/40 focus-visible:outline-none",
          )}
        >
          <MessageCircle size={17} />
          WhatsApp
        </a>
      </div>

      {canShare ? (
        <button
          type="button"
          onClick={() => void share()}
          className={buttonClass("secondary", "sm", "mt-2 w-full sm:w-auto")}
        >
          <Share2 size={14} />
          More apps
        </button>
      ) : null}

      {/* Someone reading it out over the phone needs the code, not the URL.
          It is typed on the sign-up form instead. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-divider pt-3">
        <p className="text-[13px] text-muted">
          Or share your code:{" "}
          <Mono className="text-sm font-semibold tracking-wider text-ink">{code}</Mono>
        </p>
        <button
          type="button"
          onClick={() => void copy(code, "code")}
          className={buttonClass("ghost", "sm")}
        >
          {copied === "code" ? <Check size={14} /> : <Copy size={14} />}
          {copied === "code" ? "Copied!" : "Copy code"}
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
