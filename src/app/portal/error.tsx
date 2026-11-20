"use client";

import { useRouter } from "next/navigation";
import { startTransition, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";

import { buttonClass } from "@/components/ui";

/**
 * What a portal screen shows when it fails, instead of a dead app (20 Nov 2026).
 *
 * There was no error boundary anywhere in the app. A page whose server render
 * threw (a Supabase call that timed out, say) or whose JavaScript chunk was
 * gone after a deploy replaced the WHOLE app with Next's bare "Application
 * error" page - in the Android app, which has no address bar or reload button,
 * that is a screen nobody can leave short of killing the app. Here the header
 * and tab bar stay, so the customer can tap somewhere else or try again.
 *
 * A missing chunk is a stale document, not a fault: this site has no Skew
 * Protection (checked 20 Nov 2026 - the previous build's chunks 404 on
 * rahdari.in even with their ?dpl= stamp), so after each deploy an open tab can
 * ask for files that no longer exist. That case reloads the document once. The
 * stamp is VersionWatcher's own, so the two together reload at most once a
 * minute and a reload that lands on the same fault shows this screen instead
 * of looping.
 */
const RELOAD_STAMP = "version-reload-at";
const RELOAD_COOLDOWN_MS = 60 * 1000;

function isStaleChunk(error: Error): boolean {
  const text = `${error.name} ${error.message}`;
  return /ChunkLoadError|Loading chunk [\w-]+ failed|Loading CSS chunk|dynamically imported module|Importing a module script failed/i.test(
    text,
  );
}

function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(RELOAD_STAMP) ?? 0);
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return false;
    sessionStorage.setItem(RELOAD_STAMP, String(Date.now()));
  } catch {
    /* No sessionStorage (private mode): reload anyway; without the stamp the
       worst case is one reload per failure, each needing this screen again. */
  }
  window.location.reload();
  return true;
}

export default function PortalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    console.error("portal screen failed", error);
    if (isStaleChunk(error)) reloadOnce();
  }, [error]);

  /*
   * Ends on its own: the spinner state is dropped after a bounded wait, so a
   * retry that fails again lands back on a usable button rather than a
   * spinner that never stops.
   */
  useEffect(() => {
    if (!retrying) return;
    const timer = window.setTimeout(() => setRetrying(false), 8_000);
    return () => window.clearTimeout(timer);
  }, [retrying]);

  const retry = () => {
    setRetrying(true);
    // refresh() fetches the screen again from the server; reset() then
    // re-renders this segment with it. Both in one transition, as Next's own
    // docs do it, so the old error is not flashed in between.
    startTransition(() => {
      router.refresh();
      reset();
    });
  };

  return (
    <section className="panel mx-auto mt-6 max-w-md p-6 text-center" role="alert">
      <h1 className="text-base font-semibold text-ink">This screen did not load</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        The connection may have dropped, or the app was just updated. Try again, or pick another tab
        below.
      </p>
      <button
        type="button"
        onClick={retry}
        disabled={retrying}
        className={buttonClass("primary", "md", "mt-4")}
      >
        <RefreshCw size={15} className={retrying ? "animate-spin" : undefined} aria-hidden />
        {retrying ? "Trying again…" : "Try again"}
      </button>
    </section>
  );
}
