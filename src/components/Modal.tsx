"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { X } from "lucide-react";

import { buttonClass, cx, type ButtonVariant } from "@/components/ui";

const ModalCloseContext = createContext<(() => void) | null>(null);

/** Lets a form inside a modal close it after a successful submit. */
export function useModalClose(): () => void {
  const close = useContext(ModalCloseContext);
  return useCallback(() => close?.(), [close]);
}

export function Modal({
  triggerLabel,
  triggerIcon,
  triggerVariant = "primary",
  triggerSize = "md",
  triggerClassName,
  title,
  description,
  width = "lg",
  children,
}: {
  triggerLabel: string;
  triggerIcon?: ReactNode;
  triggerVariant?: ButtonVariant;
  triggerSize?: "sm" | "md";
  triggerClassName?: string;
  title: string;
  description?: string;
  width?: "sm" | "md" | "lg" | "xl";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  const maxWidth = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-2xl", xl: "max-w-4xl" }[width];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={buttonClass(triggerVariant, triggerSize, triggerClassName)}
      >
        {triggerIcon}
        {triggerLabel}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-6">
          <div
            className="fixed inset-0 bg-ink-950/80 backdrop-blur-sm"
            onClick={close}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cx(
              "animate-in relative z-10 my-auto w-full rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl shadow-black/60",
              maxWidth,
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-ink-700/70 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold text-white">{title}</h2>
                {description ? <p className="mt-0.5 text-xs text-ink-400">{description}</p> : null}
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
              >
                <X size={16} />
              </button>
            </header>
            <div className="px-5 py-4">
              <ModalCloseContext.Provider value={close}>{children}</ModalCloseContext.Provider>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
