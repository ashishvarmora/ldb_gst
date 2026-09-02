"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import { cx } from "@/components/ui";

/**
 * A bar across the top of the window for as long as ANY navigation is in
 * flight.
 *
 * The per-link indicators in NavPending.tsx are better feedback wherever they
 * exist - they say which control you tapped, not merely that something is
 * happening - but they only exist on the controls somebody remembered to
 * instrument. The console is full of links that are not tab strips or pagers:
 * sort headers, "View all" in a panel header, the link cards on the overview,
 * a customer's name in a table row. Every one of those is the same dead
 * interval, and this covers all of them at once.
 *
 * WHY IT LISTENS FOR CLICKS RATHER THAN ASKING THE ROUTER
 *
 * Next 15 exposes no "a navigation is running" signal. `useLinkStatus` is the
 * only pending state there is and it is scoped to one <Link>, which is the
 * thing this component exists to get past. So the start of a navigation has to
 * be observed where it actually starts: a click on an anchor.
 *
 * The listener is registered in the CAPTURE phase, and that is not a
 * preference. Next's Link calls preventDefault() in its own React handler, so
 * by the time a bubble-phase listener on the document sees the event,
 * `defaultPrevented` is already true for every internal link in the app - a
 * bar wired that way would light up for external links and nothing else.
 *
 * WHY IT CANNOT GET STUCK ON
 *
 * A bar that stays lit after the page has loaded is worse than no bar, because
 * it teaches the reader to ignore it. Three separate things end the wait: the
 * URL changing (the router committing is the real signal), a hard cap in case a
 * navigation is abandoned or redirects back to where it started, and a
 * bfcache restore, which brings back a document exactly as it was when the
 * reader left it - mid-navigation, bar showing.
 *
 * NOT WIRED UP BY DEFAULT. It belongs once, high in a layout:
 *
 *   <NavProgress />
 */

/**
 * How long a navigation has to be running before it is worth mentioning.
 *
 * A cached route change commits in well under this, and a bar that blinks on
 * every fast click is visual noise that trains people to stop seeing it. The
 * navigations the owner complained about take a second or more; those are the
 * ones this is for.
 */
const SHOW_AFTER_MS = 150;

/**
 * The point at which we admit we have lost track of the navigation and clear
 * the bar anyway. Long enough not to cut short a genuinely slow page on a bad
 * connection, short enough that a stuck bar is a blip rather than a fixture.
 */
const GIVE_UP_AFTER_MS = 20_000;

/** Whether a click is one that is about to navigate this document somewhere new. */
function startsANavigation(event: MouseEvent): boolean {
  // Left button, unmodified. Ctrl/Cmd/Shift open a new tab or window, and this
  // document stays exactly where it is.
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (event.defaultPrevented) return false;

  const anchor = (event.target as Element | null)?.closest?.("a");
  if (!(anchor instanceof HTMLAnchorElement)) return false;
  if (anchor.hasAttribute("download")) return false;
  if (anchor.target && anchor.target !== "_self") return false;

  const href = anchor.getAttribute("href");
  if (!href) return false;

  // mailto:, tel: and an external host all hand off to something that is not
  // this page; a bar reporting on them would never be told they finished.
  let target: URL;
  try {
    target = new URL(anchor.href, window.location.href);
  } catch {
    return false;
  }
  if (target.origin !== window.location.origin) return false;

  /*
   * A link to the page you are already on. The router has nothing to commit,
   * so the URL never changes and the only thing that would ever clear the bar
   * is the give-up timer twenty seconds later. Anchors within the page are the
   * same case.
   */
  if (target.pathname === window.location.pathname && target.search === window.location.search) {
    return false;
  }

  return true;
}

function NavProgressBar({ className }: { className?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [visible, setVisible] = useState(false);

  const showTimer = useRef<number | null>(null);
  const giveUpTimer = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (showTimer.current !== null) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (giveUpTimer.current !== null) {
      window.clearTimeout(giveUpTimer.current);
      giveUpTimer.current = null;
    }
    setVisible(false);
  }, []);

  /*
   * The committed URL is what ends the wait, and the search string has to be
   * part of it. Moving between the sections of one page changes nothing but
   * the query - which is the whole reason this exists - so a bar keyed on
   * pathname alone would light up on a section change and never go out.
   */
  const committed = `${pathname}?${searchParams.toString()}`;
  useEffect(() => {
    stop();
  }, [committed, stop]);

  useEffect(() => {
    const start = () => {
      // A second click while the first navigation is still running must not
      // restart the give-up clock, or a reader tapping repeatedly - exactly
      // what this is meant to stop - could hold the bar open indefinitely.
      if (showTimer.current !== null || giveUpTimer.current !== null) return;

      showTimer.current = window.setTimeout(() => {
        showTimer.current = null;
        setVisible(true);
      }, SHOW_AFTER_MS);

      giveUpTimer.current = window.setTimeout(stop, GIVE_UP_AFTER_MS);
    };

    const onClick = (event: MouseEvent) => {
      if (startsANavigation(event)) start();
    };

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) stop();
    };

    document.addEventListener("click", onClick, { capture: true });
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("pageshow", onPageShow);
      stop();
    };
  }, [stop]);

  if (!visible) return null;

  /*
   * aria-hidden, and deliberately so. Next announces route changes through its
   * own route announcer, and the tab or pager that was tapped announces itself
   * through LinkPending - a third live region firing on every single
   * navigation in the console would bury both. This is for the eyes only.
   *
   * The pulse is an accent rather than the message: globals.css stops every
   * animation under prefers-reduced-motion, and a solid brand line across the
   * top of the window still reads as "wait" when it is perfectly still.
   */
  return (
    <span
      aria-hidden
      className={cx(
        "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 animate-pulse bg-brand-500",
        className,
      )}
    />
  );
}

export function NavProgress({ className }: { className?: string }) {
  /*
   * useSearchParams() makes its caller a client boundary that Next refuses to
   * prerender without a Suspense parent - a build error, in a layout, on every
   * statically rendered page under it. Wrapping it here means dropping this
   * into a layout cannot break that layout's build.
   */
  return (
    <Suspense fallback={null}>
      <NavProgressBar className={className} />
    </Suspense>
  );
}
