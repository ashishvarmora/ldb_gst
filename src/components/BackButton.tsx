"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * Goes back to wherever the customer came from - Home's "Need help?", the
 * account sheet, a truck page - the way a phone's own back arrow does. Opened
 * cold (a notification, a pasted link) there is nothing to go back to, so it
 * falls back to `fallback` instead of leaving the app.
 */
export function BackButton({
  fallback = "/portal",
  className,
  label = "Back",
}: {
  fallback?: string;
  className?: string;
  label?: string;
}) {
  const router = useRouter();

  return (
    <button
      type="button"
      aria-label={label}
      className={className}
      onClick={() => {
        if (window.history.length > 1) router.back();
        else router.push(fallback);
      }}
    >
      <ArrowLeft size={21} strokeWidth={2.2} />
    </button>
  );
}
