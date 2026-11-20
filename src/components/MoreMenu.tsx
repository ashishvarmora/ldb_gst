"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * A ⋯ button and the small menu it opens (owner, 20 Nov 2026).
 *
 * Secondary actions live here so the row or header they belong to stays one
 * calm line. Closes on a tap outside, on Escape, and on any link inside it.
 * Items are plain children: links rendered on the server, or the small forms
 * in TruckMenu. Styled by .more-menu* in screens-polish.css (the alert row's
 * menu uses the same look).
 */
export function MoreMenu({
  label,
  children,
  className,
  buttonClassName,
  align = "right",
  open: controlledOpen,
  onOpenChange,
}: {
  /** Accessible name of the ⋯ button, e.g. "More for GJ02AT8546". */
  label: string;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
  align?: "right" | "left";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: PointerEvent) {
      if (!ref.current?.contains(event.target as Node)) close();
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    function close() {
      if (controlledOpen === undefined) setOwnOpen(false);
      onOpenChange?.(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, controlledOpen, onOpenChange]);

  return (
    <div ref={ref} className={cx("more-menu-wrap", className)} data-menu-open={open ? "true" : undefined}>
      <button
        type="button"
        className={cx("more-menu-button", buttonClassName)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title="More"
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal size={18} aria-hidden />
      </button>
      {open ? (
        <div
          role="menu"
          className={cx("more-menu", align === "left" && "is-left")}
          onClick={(event) => {
            /* A link inside the menu navigates; the menu should not linger. */
            if ((event.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
