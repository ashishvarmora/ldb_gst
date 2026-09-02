"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * One filter, worn as a pill that says what it is currently doing.
 *
 * The credit ledger used to spend about 400px of a 390px phone on its controls
 * before a single charge was visible: a group-by row, a date range in three
 * rows, and a "More filters" fold hiding three more rows of chips. Every one of
 * those chip rows showed all of its options all of the time, which is what made
 * the block read as noise - the reader had to scan twelve chips to learn that
 * nothing was filtered.
 *
 * A pill inverts that. It shows the ANSWER rather than the options - "Last 30
 * days", "Credits used", "Newest first" - and the options only exist while
 * somebody is choosing. A filter left alone reads as its own default and stays
 * quiet in the neutral colour; one that has been set reads as its value and
 * takes the brand colour, so what is narrowing the list is legible at a glance
 * instead of being hidden behind a fold. That last part matters more here than
 * anywhere else in the app: this is the page somebody reconciles a bill on, and
 * a quietly-applied filter is how a bill comes to look wrong when it is not.
 *
 * The options themselves are server-rendered links handed in as children. Every
 * filter on this page is a query parameter and stays one, so a filtered view is
 * still linkable, still survives a refresh, and the back button still steps
 * through filter changes. The only thing this component knows is whether its own
 * sheet is open.
 *
 * THE SORT VARIANT IS THE SAME SHEET IN A DIFFERENT SKIN, because sorting is
 * not filtering. Order used to be a pill in this row like the rest, which said
 * it narrowed the list when it only rearranges it - and it took the brand
 * colour off its default, so "Biggest first" read as a filter in force on a
 * page where a filter in force is why a bill looks wrong. The sort control is
 * square-cornered, lives on the row with the grouping toggles it belongs beside,
 * prints its own direction, and never goes brand. Sharing the sheet
 * rather than growing a second one keeps the escape key, the scroll lock and
 * the close-on-navigate in one place.
 */
export function FilterPill({
  label,
  value,
  active = false,
  icon,
  variant = "filter",
  children,
}: {
  /** What this pill controls. Read out only inside the sheet and to screen readers. */
  label: string;
  /** The current selection - the pill shows this, not the label. */
  value: string;
  /** True when the filter is doing something, i.e. is off its default. */
  active?: boolean;
  icon?: ReactNode;
  /** "sort" for a control that reorders rather than narrows. */
  variant?: "filter" | "sort";
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);

    /* The sheet covers the bottom of the phone, so the page behind it must not
       scroll away under the thumb that is trying to scroll the sheet. */
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  return (
    /*
     * A pill that is doing something moves to the front of the row.
     *
     * Four pills run wider than a 390px phone, so the row scrolls and something
     * is always past the right-hand edge - and a filter nobody can see is how
     * somebody ends up staring at a three-row ledger wondering where the rest of
     * their charges went. Flex order rather than reordering the markup, so the
     * DOM keeps the one fixed sequence that keyboard and screen-reader users
     * move through, and nothing shuffles at all until a filter is actually set.
     *
     * The sort control never jumps the queue: it is not in the scrolling row,
     * and a control that moved because of what it is set to would be the one
     * thing on this screen that changes place without narrowing anything.
     */
    <div className={cx("shrink-0", variant === "filter" && active && "order-first")}>
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={cx(
          "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap border text-xs font-medium transition",
          variant === "sort"
            ? /* Square corners and the raised surface, so it reads as a tool
                 rather than as one more round filter chip. Neutral whatever it
                 is set to: the value is printed on it, and going brand is this
                 row's word for "this is narrowing your ledger". */
              "rounded-lg border-line bg-raised px-2.5 text-ink hover:border-line-strong"
            : "rounded-full px-3",
          variant === "filter" &&
            (active
              ? "border-brand-500 bg-brand-500/10 text-brand-500"
              : "border-line bg-panel text-muted hover:border-line-strong hover:text-ink"),
        )}
      >
        {icon}
        {/* The sort control prints its own name where there is room for it,
            because "Newest" on its own does not say it is the order rather than
            another filter. The spoken label below is what carries it on a
            phone, where the printed one is display:none and therefore not read
            out at all. */}
        {variant === "sort" ? (
          <span aria-hidden className="hidden text-faint sm:inline">
            {label}
          </span>
        ) : null}
        <span className="sr-only">{label}: </span>
        {/* Capped and clipped, because one long value would otherwise push every
            other pill off the right-hand edge on its own - "Added by
            administrator" is a real reason, and a hand-picked range that spans
            two years is a real range. */}
        <span className="max-w-40 truncate">{value}</span>
        <ChevronDown
          size={13}
          aria-hidden
          className={cx("shrink-0 transition", open && "rotate-180")}
        />
      </button>

      {open ? (
        <>
          {/* A miss has to land somewhere. Dimming the page also says the sheet
              is a layer over the ledger rather than another row of it. */}
          <div
            aria-hidden
            onClick={close}
            className="animate-in fixed inset-0 z-40 bg-strong/25 backdrop-blur-[1px]"
          />

          {/*
           * A bottom sheet on a phone, where the thumb already is, and a small
           * centred card from sm up. Both are position:fixed rather than a
           * dropdown anchored to the pill, because this row lives inside a
           * Panel whose overflow-hidden - and inside its own sideways scroller -
           * would clip an absolutely positioned menu, and a clipped option is an
           * option nobody can reach.
           */}
          <div
            role="dialog"
            aria-label={label}
            onClick={(event) => {
              /*
               * An option is a link, and following one is a client navigation
               * that leaves this component mounted - so the sheet has to shut
               * itself or it sits open over the answer it was just asked for.
               *
               * Links ONLY. A submit button was in this selector once and it
               * silently broke the custom date range: React flushes the state
               * update while the click is still being dispatched, the form is
               * unmounted before the browser reaches the default action, and the
               * submission is dropped - the sheet closed and the dates never
               * applied. The form is a plain GET that reloads the page, which
               * unmounts the sheet on its own anyway.
               */
              if ((event.target as HTMLElement).closest("a")) close();
            }}
            className={cx(
              "animate-in fixed z-50 border border-line bg-panel [box-shadow:var(--shadow-pop)]",
              "inset-x-0 bottom-0 max-h-[80vh] overflow-y-auto overscroll-contain rounded-t-2xl border-b-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
              "sm:inset-x-auto sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:w-80 sm:max-w-[calc(100vw-2rem)]",
              "sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:border-b sm:pb-3",
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="text-[11px] font-semibold tracking-wider text-faint uppercase">
                {label}
              </span>
              <button
                type="button"
                onClick={close}
                aria-label="Close"
                className="-mr-1 inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-faint transition hover:bg-sunken hover:text-ink"
              >
                <X size={16} />
              </button>
            </div>

            {children}
          </div>
        </>
      ) : null}
    </div>
  );
}
