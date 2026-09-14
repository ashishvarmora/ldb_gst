"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

/**
 * Notices that the site has been redeployed, and gets this page onto the new
 * build without anybody being told to press refresh.
 *
 * THE PROBLEM. A page loaded before a deploy holds JavaScript chunk names that
 * the new deployment does not have. The page keeps working until it needs one
 * of them - opening a dialog, a chart, a route it has not visited - and then
 * that 404s. From the customer's side nothing says "out of date": a button
 * stops responding, or a screen half-renders. Support hears "it broke", the
 * fix is a refresh, and nobody can be expected to guess that. An installed PWA
 * is the worst case, because iOS resumes it from memory and one document can
 * live for days.
 *
 * WHY NOT JUST SIGN EVERYBODY OUT ON DEPLOY. It was asked for, and it does not
 * work. Signing out destroys the session; it does not replace the stale
 * JavaScript already in the browser, so the same page with the same broken
 * chunks is still what loads - now at the login screen. It also throws away
 * what everyone was in the middle of, on every deploy, to fix a problem most
 * of them would never have hit. The thing that has to be replaced is the
 * document, not the session.
 *
 * WHAT THIS DOES INSTEAD. The server tells the page which build rendered it.
 * Whenever the page comes back to the foreground - which for a PWA is every
 * resume - it asks what is live now. If that differs:
 *
 *   - it reloads on its own IF nothing would be lost, and
 *   - otherwise it says so and waits to be told, because a reload that
 *     discards a half-typed truck number is a worse bug than the one this is
 *     here to fix.
 *
 * There is a second route in too: a chunk that 404s fires an error, and that
 * error is itself proof the page is stale, so it reloads immediately. That is
 * the case the polling cannot reach in time - the customer is already stuck.
 */

/** How often to re-check while the page is open and visible. */
const POLL_MS = 5 * 60 * 1000;

/** Don't auto-reload twice in quick succession, whatever we are told. */
const RELOAD_COOLDOWN_MS = 60 * 1000;
const RELOAD_STAMP = "version-reload-at";

function reloadedRecently(): boolean {
  try {
    const raw = sessionStorage.getItem(RELOAD_STAMP);
    if (!raw) return false;
    return Date.now() - Number(raw) < RELOAD_COOLDOWN_MS;
  } catch {
    /* Private modes throw on sessionStorage. Losing the guard is survivable;
       refusing to reload because of it is not. */
    return false;
  }
}

function stampReload(): void {
  try {
    sessionStorage.setItem(RELOAD_STAMP, String(Date.now()));
  } catch {
    /* See above. */
  }
}

/**
 * Is there anything on this screen a reload would throw away?
 *
 * Deliberately pessimistic. Every question here is "might this cost somebody
 * something", and any yes means we ask rather than act. Being wrong in this
 * direction shows a banner nobody needed; being wrong the other way deletes
 * work somebody was halfway through.
 */
function safeToReload(): boolean {
  if (typeof document === "undefined") return false;

  // Something with its own dismissal - a modal, the nav drawer, a confirm.
  // Reloading out from under an open dialog loses whatever it was collecting.
  if (document.querySelector("[role='dialog'], dialog[open]")) return false;

  const active = document.activeElement as HTMLElement | null;
  if (active?.isContentEditable) return false;
  if (active && /^(input|textarea|select)$/i.test(active.tagName)) return false;

  // A field somebody has touched, focused or not. defaultValue is the value
  // the server rendered, so this is "has anything been changed since it
  // arrived" rather than "is anything non-empty" - an edit form arrives full.
  for (const field of document.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select")) {
    if (field.type === "hidden" || field.disabled) continue;
    if (field instanceof HTMLSelectElement) {
      const changed = [...field.options].some((o) => o.selected !== o.defaultSelected);
      if (changed) return false;
      continue;
    }
    if (field.type === "checkbox" || field.type === "radio") {
      if ((field as HTMLInputElement).checked !== (field as HTMLInputElement).defaultChecked)
        return false;
      continue;
    }
    if (field.value !== field.defaultValue) return false;
  }

  return true;
}

/** A failure that means "this document is asking for files that are gone". */
function looksLikeStaleChunk(message: string): boolean {
  return (
    /ChunkLoadError/i.test(message) ||
    /Loading chunk [\w-]+ failed/i.test(message) ||
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message)
  );
}

export function VersionWatcher({ current }: { current: string }) {
  const [stale, setStale] = useState(false);
  /* Read inside listeners that are registered once; a ref keeps them from
     having to be torn down and rebuilt every time this flips. */
  const staleRef = useRef(false);
  staleRef.current = stale;

  const reload = useCallback(() => {
    stampReload();
    window.location.reload();
  }, []);

  /* A stale chunk is not a guess - the page has already failed. Reload at
     once, cooldown-guarded so a reload that lands on the same fault cannot
     become a loop. */
  useEffect(() => {
    if (current === "dev") return;

    const onFailure = (message: string) => {
      if (!looksLikeStaleChunk(message) || reloadedRecently()) return;
      reload();
    };

    const onError = (event: ErrorEvent) => onFailure(event.message ?? "");
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      onFailure(typeof reason === "string" ? reason : (reason?.message ?? ""));
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, [current, reload]);

  useEffect(() => {
    // "dev" never changes, so locally this costs one fetch and then nothing.
    if (current === "dev") return;

    let cancelled = false;

    const check = async () => {
      if (cancelled || staleRef.current || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/version", {
          cache: "no-store",
          headers: { accept: "application/json" },
        });
        if (!response.ok) return;
        const body = (await response.json()) as { id?: string };
        if (cancelled || !body?.id || body.id === current) return;

        // The build moved. Take the quiet exit if there is one.
        if (safeToReload() && !reloadedRecently()) reload();
        else setStale(true);
      } catch {
        /* Offline, or the check was cut off by a navigation. Either way the
           next foreground is soon enough - this must never surface an error
           of its own. */
      }
    };

    /*
     * Ask when the page comes back, not on a timer alone. A phone's PWA is
     * resumed rather than reloaded, so `visible` is the moment that matters
     * and is also the moment a reload is cheapest - the customer has just
     * arrived and has not started anything yet.
     */
    const onVisible = () => {
      if (document.visibilityState === "visible") void check();
    };

    // Also refresh the worker itself, so the copy on the device does not lag
    // behind the site it is serving.
    const refreshWorker = () => {
      navigator.serviceWorker?.getRegistration().then((r) => r?.update().catch(() => {}));
    };

    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", refreshWorker);

    const timer = window.setInterval(() => void check(), POLL_MS);
    void check();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", refreshWorker);
      window.clearInterval(timer);
    };
  }, [current, reload]);

  if (!stale) return null;

  /*
   * Only ever shown when an automatic reload was refused, which means there is
   * something on screen worth keeping. So it explains itself and waits.
   *
   * Sat above the portal's bottom tab bar, which is fixed at bottom-0 on a
   * phone, and clear of the home indicator.
   */
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-50 flex justify-center px-4 lg:bottom-4"
    >
      <div className="animate-in flex w-full max-w-md items-center gap-3 rounded-xl border border-brand-500/40 bg-panel px-3 py-2.5 [box-shadow:var(--shadow-pop)]">
        <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl border border-brand-500/30 bg-brand-500/12 text-brand-400">
          <RefreshCw size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">A new version is ready</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Finish what you are doing, then refresh. Some things may not work until you do.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="inline-flex min-h-9 shrink-0 items-center rounded-lg bg-brand-500 px-3 text-xs font-medium text-on-brand transition hover:bg-brand-600"
        >
          Refresh
        </button>
      </div>
    </div>
  );
}
