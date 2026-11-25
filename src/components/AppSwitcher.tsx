"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Check, LayoutGrid, Navigation, Receipt } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * Rahdari's apps, like Odoo's app menu: Toll tracking (FASTag crossings) and
 * Live tracking (GPS trips from the driver's phone). Same login, own spaces.
 * Shown in the header of both the portal and /live.
 */

const APPS = [
  {
    key: "toll",
    href: "/portal",
    name: "Toll tracking",
    hint: "FASTag toll-plaza crossings",
    icon: Receipt,
    tone: "bg-[#edf4ff] text-[#1558b8]",
  },
  {
    key: "live",
    href: "/live",
    name: "Live tracking",
    hint: "Trips, driver GPS, e-way bills",
    icon: Navigation,
    tone: "bg-[#fff1e6] text-[#c2570c]",
  },
] as const;

export function AppSwitcher({ current, className }: { current: "toll" | "live"; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className={cx("relative", className)}>
      <button
        type="button"
        aria-label="Switch app"
        aria-expanded={open}
        title="Switch app"
        onClick={() => setOpen((v) => !v)}
        className="hdr-btn inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-line bg-panel text-muted transition hover:bg-sunken hover:text-ink"
      >
        <LayoutGrid size={19} />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-[min(18.5rem,calc(100vw-2rem))] rounded-2xl border border-line bg-panel p-2 shadow-[0_12px_32px_-12px_rgb(16_27_60/0.35)]"
        >
          <p className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">Rahdari apps</p>
          {APPS.map((app) => {
            const active = app.key === current;
            return (
              <Link
                key={app.key}
                href={app.href}
                role="menuitem"
                aria-current={active ? "true" : undefined}
                className={cx(
                  "flex min-h-14 items-center gap-3 rounded-xl px-2 py-2 transition",
                  active ? "bg-sunken" : "hover:bg-sunken",
                )}
              >
                <span className={cx("inline-flex size-10 shrink-0 items-center justify-center rounded-xl", app.tone)}>
                  <app.icon size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-strong">{app.name}</span>
                  <span className="block truncate text-xs text-muted">{app.hint}</span>
                </span>
                {active ? <Check size={16} className="shrink-0 text-good-500" /> : null}
              </Link>
            );
          })}
          <Link href="/apps" className="mt-1 block rounded-lg px-2 py-2 text-center text-xs font-semibold text-muted hover:bg-sunken">
            All apps
          </Link>
        </div>
      ) : null}
    </div>
  );
}
