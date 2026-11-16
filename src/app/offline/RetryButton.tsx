"use client";

import { RefreshCw } from "lucide-react";

import { buttonClass } from "@/components/ui";

/**
 * Reloads the page the reader was trying to open. The service worker shows this
 * notice AT that page's address, so a reload retries exactly it - where the old
 * link to /portal threw away where they were going.
 */
export function RetryButton() {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      className={buttonClass("primary", "md", "mt-6 w-full justify-center")}
    >
      <RefreshCw size={15} />
      Try again
    </button>
  );
}
