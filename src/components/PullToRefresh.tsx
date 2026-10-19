"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

import { isNativeApp } from "@/lib/native-app";

/** How far the indicator has to come down (after resistance) before letting go refreshes. */
const READY = 54;
/** The indicator never travels further than this, however far they pull. */
const MAX = 110;

/**
 * Drag down at the top of a page to reload its data - the gesture every phone
 * app has and a WebView does not.
 *
 * Only inside the Android app or an installed (standalone) copy: a browser
 * tab already has its own pull-to-refresh, and two would fight.
 *
 * router.refresh() rather than a reload: it re-runs the server components and
 * keeps the page, its scroll position and anything typed into it. The
 * listeners are passive and never call preventDefault, so this cannot get in
 * the way of scrolling - it only watches. globals.css turns the WebView's own
 * overscroll off in the app, which is what leaves the gesture free for this.
 */
export function PullToRefresh() {
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const start = useRef<number | null>(null);
  const distance = useRef(0);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setEnabled(isNativeApp() || standalone);
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const onStart = (event: TouchEvent) => {
      // Only from the very top, with one finger, and not from inside a sheet
      // or a dialog that scrolls on its own.
      if (window.scrollY > 0 || event.touches.length !== 1 || refreshing) return;
      const target = event.target as Element | null;
      if (target?.closest("[role=dialog], .overscroll-contain, input, textarea, select")) return;
      start.current = event.touches[0].clientY;
      distance.current = 0;
    };

    const onMove = (event: TouchEvent) => {
      if (start.current === null) return;
      const delta = event.touches[0].clientY - start.current;
      if (delta <= 0 || window.scrollY > 0) {
        start.current = null;
        setPull(0);
        return;
      }
      // Resistance: the further it goes, the harder it gets, like a spring.
      const eased = Math.min(MAX, delta * 0.5);
      distance.current = eased;
      setPull(eased);
    };

    const onEnd = () => {
      if (start.current === null) return;
      start.current = null;
      if (distance.current >= READY) {
        setRefreshing(true);
        setPull(56);
        router.refresh();
        // refresh() has no promise to wait on; the spinner stays long enough
        // to read as "it did something" and goes when the new data lands.
        window.setTimeout(() => {
          setRefreshing(false);
          setPull(0);
        }, 900);
      } else {
        setPull(0);
      }
      distance.current = 0;
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [enabled, refreshing, router]);

  if (!enabled || (pull === 0 && !refreshing)) return null;

  const ready = pull >= READY;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
      style={{
        top: "calc(var(--sat) + 56px)",
        transform: `translateY(${pull - 40}px)`,
        transition: start.current === null ? "transform 0.25s var(--ease-out)" : "none",
      }}
    >
      <span className="inline-flex size-10 items-center justify-center rounded-full border border-line bg-panel text-brand-500 [box-shadow:var(--shadow-raised)]">
        <RefreshCw
          size={18}
          className={refreshing ? "animate-spin" : undefined}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)`, opacity: ready ? 1 : 0.6 }}
        />
      </span>
    </div>
  );
}
