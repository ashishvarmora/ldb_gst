"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Info, X } from "lucide-react";

import { cx } from "@/components/ui";

/**
 * An (i) beside a label or a heading, opening the explanation underneath it.
 *
 * The forms and the pricing screens here had grown a paragraph under every
 * input and under every section - what an alert does, what an open tier is,
 * what the base rate multiplies. All of it worth knowing once and none of it
 * worth re-reading on every visit, and on a phone it turned a four-field form
 * into a page of prose.
 *
 * Opens INLINE, directly under the row, rather than as a floating popover.
 * That is not laziness, it is the only version that cannot break: almost every
 * ancestor these sit inside clips its overflow - Panel, Disclosure, Modal and
 * every PackLadder row all carry overflow-hidden - so an absolutely positioned
 * panel would be sliced off at the nearest card edge. Escaping that needs a
 * portal, a measured position, flip-when-it-would-leave-the-viewport logic and
 * a scroll listener, and the reward on a 390px screen is a panel covering the
 * very input it describes. Pushing the content below down is unglamorous and
 * always readable.
 *
 * Inline is also what makes hover safe here. The trigger is above the panel, so
 * opening never moves the trigger out from under the pointer - the hover-open,
 * layout-shift, hover-lost, close, re-open loop that plagues push-down
 * tooltips cannot happen.
 *
 * Deliberately not <details>, unlike HelpNote: the trigger is a small icon
 * beside a <label>, and a <summary> cannot sit inside a label's row without
 * taking the whole row's click - which would mean tapping the field name
 * opened the help instead of focusing the input.
 */

/**
 * A pointer crossing the label row on its way somewhere else passes over the
 * (i) for a few milliseconds. Without a wait, that flashes the panel open and
 * shoves the rest of the form down and back for no reason.
 */
const OPEN_DELAY_MS = 120;

/**
 * And a grace period on the way out, because the panel is a hover target too.
 * Someone who hovers the (i) to read three lines and then drifts the pointer
 * down into the text would otherwise have it vanish mid-sentence: the leave
 * fires on the icon before the enter can fire on the panel, so without a delay
 * between the two the panel unmounts and there is nothing left to enter.
 */
const CLOSE_GRACE_MS = 160;

/**
 * The three reasons the panel can be open, kept as three flags rather than one.
 *
 * Collapsing them into a single `open` boolean is what breaks touch. A tap
 * fires focus AND click, so a shared flag gets set twice and the second tap
 * only undoes one of them - leaving a panel a phone user cannot shut. Keeping
 * them apart means one reason ending never closes a panel another is still
 * holding open, and the click flag is the only one a tap touches.
 */
function useInfoReveal() {
  /** Clicked or tapped. Survives the pointer leaving, and blur - it is a pin. */
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  /** Reached by keyboard. Never set by a pointer - see onFocus below. */
  const [keyed, setKeyed] = useState(false);

  // One timer for both directions, so the newest intent always wins: an enter
  // arriving inside the close grace cancels the close rather than queueing
  // behind it.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // A pending timer after unmount would call setState on a dead component.
  useEffect(() => clearTimer, [clearTimer]);

  const scheduleHover = useCallback(
    (next: boolean) => {
      clearTimer();
      timer.current = setTimeout(
        () => {
          timer.current = null;
          setHovered(next);
        },
        next ? OPEN_DELAY_MS : CLOSE_GRACE_MS,
      );
    },
    [clearTimer],
  );

  /**
   * Hover is for mice only. A touchscreen has no hover: a tap fires
   * pointerenter with pointerType "touch" immediately before the click, so
   * without this guard every tap would open by hover and then be toggled by
   * the click, and the two would fight over what the next tap means.
   */
  const hoverProps = {
    onPointerEnter: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") scheduleHover(true);
    },
    onPointerLeave: (event: React.PointerEvent) => {
      if (event.pointerType === "mouse") scheduleHover(false);
    },
  };

  const close = useCallback(() => {
    clearTimer();
    setPinned(false);
    setHovered(false);
    setKeyed(false);
  }, [clearTimer]);

  const triggerProps = {
    ...hoverProps,
    onClick: () => {
      clearTimer();
      setPinned((value) => !value);
    },
    /**
     * :focus-visible rather than focus outright. A button that is clicked or
     * tapped takes focus but does not match :focus-visible, so asking the
     * element itself keeps this to genuine keyboard arrivals - which is the
     * only case that needs it, and the only case where setting a second flag
     * on a tap would not strand the panel open.
     */
    onFocus: (event: React.FocusEvent<HTMLButtonElement>) => {
      if (event.currentTarget.matches(":focus-visible")) setKeyed(true);
    },
    onBlur: () => setKeyed(false),
  };

  return {
    open: pinned || hovered || keyed,
    /** Only a pin earns the X: it is the one state a second tap will close. */
    pinned,
    triggerProps,
    hoverProps,
    close,
  };
}

/** The (i)/X itself. Its own component only so the two exports below agree. */
function InfoButton({
  label,
  pinned,
  open,
  panelId,
  triggerProps,
}: {
  label: string;
  pinned: boolean;
  open: boolean;
  panelId: string;
  triggerProps: ReturnType<typeof useInfoReveal>["triggerProps"];
}) {
  return (
    <button
      type="button"
      {...triggerProps}
      aria-expanded={open}
      aria-controls={panelId}
      aria-label={pinned ? `Hide help for ${label}` : `What is ${label}?`}
      className={cx(
        "relative inline-flex size-7 shrink-0 items-center justify-center rounded-full transition",
        /*
         * The visible circle is 28px, which is under the 36px this codebase
         * asks of a tap target - and now that everything this screen used to
         * say in prose is behind this icon, a missed tap is a reader who cannot
         * reach the explanation at all. An invisible 36px pad rather than a
         * bigger circle: growing the button itself would add eight pixels to
         * every label row it sits in, on the alert forms and the truck pages
         * as well as here, to fix a problem only the finger has.
         */
        "before:absolute before:-inset-1 before:content-['']",
        open ? "bg-brand-500/12 text-brand-500" : "text-faint hover:bg-sunken hover:text-ink",
      )}
    >
      {pinned ? <X size={13} /> : <Info size={14} />}
    </button>
  );
}

/**
 * A div and not a p: several callers pass more than one paragraph, and a <p>
 * inside a <p> is closed by the parser before the second one starts - which
 * renders the explanation outside its own box.
 */
function InfoPanel({
  id,
  children,
  hoverProps,
}: {
  id: string;
  children: ReactNode;
  hoverProps: ReturnType<typeof useInfoReveal>["hoverProps"];
}) {
  return (
    <div
      id={id}
      {...hoverProps}
      className="mt-1.5 rounded-lg border border-line bg-raised/70 px-3 py-2.5 text-xs leading-relaxed text-muted [&_p+p]:mt-2"
    >
      {children}
    </div>
  );
}

export function LabelWithInfo({
  label,
  htmlFor,
  info,
  required,
  className,
}: {
  label: string;
  /** Points the label at its input, so tapping the words still focuses it. */
  htmlFor?: string;
  info: ReactNode;
  required?: boolean;
  className?: string;
}) {
  const { open, pinned, triggerProps, hoverProps, close } = useInfoReveal();
  const panelId = useId();

  return (
    /**
     * Escape is caught on the wrapper rather than on the button, so it still
     * works once focus has moved into a link inside the explanation itself.
     */
    <div className={className} onKeyDown={(event) => event.key === "Escape" && close()}>
      <div className="flex items-center justify-between gap-2">
        <label className="field-label mb-0" htmlFor={htmlFor}>
          {label}
          {required ? <span className="ml-0.5 text-bad-500">*</span> : null}
        </label>

        {/* -mr-1 pulls the round hit area back level with the field's edge. */}
        <span className="-mr-1">
          <InfoButton
            label={label}
            pinned={pinned}
            open={open}
            panelId={panelId}
            triggerProps={triggerProps}
          />
        </span>
      </div>

      {open ? (
        <InfoPanel id={panelId} hoverProps={hoverProps}>
          {info}
        </InfoPanel>
      ) : null}
    </div>
  );
}

/**
 * The same affordance for a row that is not a field - a section heading, a
 * panel title, a figure with a rule behind it.
 *
 * `children` is the row the (i) joins, so the caller keeps its own heading
 * level and typography; this only adds the icon at the end of the row and the
 * panel under the whole of it.
 */
export function InfoTip({
  label,
  info,
  children,
  className,
  rowClassName,
}: {
  /** Names the thing being explained, for the button's accessible label. */
  label: string;
  info: ReactNode;
  children: ReactNode;
  className?: string;
  rowClassName?: string;
}) {
  const { open, pinned, triggerProps, hoverProps, close } = useInfoReveal();
  const panelId = useId();

  return (
    <div className={className} onKeyDown={(event) => event.key === "Escape" && close()}>
      <div className={cx("flex flex-wrap items-center gap-1", rowClassName)}>
        {children}
        <InfoButton
          label={label}
          pinned={pinned}
          open={open}
          panelId={panelId}
          triggerProps={triggerProps}
        />
      </div>

      {open ? (
        <InfoPanel id={panelId} hoverProps={hoverProps}>
          {info}
        </InfoPanel>
      ) : null}
    </div>
  );
}
