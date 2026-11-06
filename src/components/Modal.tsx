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
  openHash,
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
  /** A same-page hash can launch this dialog from a Home shortcut. */
  openHash?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    setOpen(false);
    if (openHash && window.location.hash === `#${openHash}`) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, [openHash]);

  useEffect(() => {
    if (!openHash) return;
    const sync = () => setOpen(window.location.hash === `#${openHash}`);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [openHash]);

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
        /*
         * On a phone this is a bottom sheet, the way an app asks for input:
         * mt-auto rests a short form on the bottom edge, and a long one starts
         * below the status bar and scrolls this container. From sm up it is
         * the centred dialog it always was.
         */
        <div className="fixed inset-0 z-50 flex flex-col items-stretch overflow-y-auto overscroll-contain pt-[calc(var(--sat)+2.5rem)] sm:items-center sm:p-6">
          <div
            className="backdrop-in fixed inset-0 bg-strong/25 backdrop-blur-sm"
            onClick={close}
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={cx(
              "sheet-up relative z-10 mt-auto w-full rounded-t-3xl border border-b-0 border-line bg-panel pb-[var(--sab)] [box-shadow:var(--shadow-pop)] sm:my-auto sm:rounded-2xl sm:border-b sm:pb-0",
              maxWidth,
            )}
          >
            {/*
             * min-w-0 and break-words on the title block, shrink-0 on the
             * close button. Titles here are built from stored values - "Edit
             * SAVE20-DIWALI-FLEET", "Edit GJ27TD6880 crossing" - and a long
             * one is often a single unbreakable token, which a flex child will
             * not shrink below. Without these the heading pushed the X past
             * the dialog's rounded edge on a phone, leaving Escape or a tap on
             * the backdrop as the only way out.
             *
             * The button is sized rather than padded: p-1.5 round a 16px icon
             * is a 28px target, well under the 36px floor the rest of the
             * console keeps to, and this is the control somebody reaches for
             * when they opened the wrong form.
             */}
            {/* The phone's "this is a sheet" mark. Not on the centred dialog. */}
            <div aria-hidden className="flex justify-center pt-2.5 sm:hidden">
              <span className="h-1 w-10 rounded-full bg-line-strong" />
            </div>
            <header className="flex items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
              <div className="min-w-0 break-words">
                <h2 className="text-base font-semibold text-strong">{title}</h2>
                {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="-mt-1 -mr-2 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-muted transition hover:bg-sunken hover:text-ink"
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
