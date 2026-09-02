"use client";

import { useLinkStatus } from "next/link";
import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { buttonClass, cx, type ButtonVariant } from "@/components/ui";

/**
 * Immediate feedback on the item the user actually tapped.
 *
 * `loading.tsx` swaps the page body for a skeleton, but that only happens once
 * the router commits. On a slow connection there is a gap first where nothing
 * moves and people tap again. These render inside a <Link> and light up the
 * moment the navigation starts.
 *
 * They matter most where `loading.tsx` cannot help at all. Going from
 * /admin/finance to /admin/users changes a route segment, so the skeleton runs
 * and the screen visibly reacts. Going from Revenue to Receipts inside
 * /admin/finance only changes ?section=; the segment is the same, no skeleton
 * is involved, and Next re-renders the page on the server with nothing on
 * screen to say it is doing so. Every tab strip, pager and sort link in the
 * console is that second kind of navigation, which is exactly why the owner saw
 * feedback in the sidebar and none anywhere else.
 */

/** Small spinner, for a sidebar row. */
export function NavSpinner({ className }: { className?: string }) {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        "ml-auto size-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70",
        className,
      )}
    />
  );
}

/**
 * A bar that fills across the top of a bottom-nav tab. On a phone the tab is
 * the thing under the thumb, so that is where the feedback belongs.
 */
export function NavTabPending() {
  const { pending } = useLinkStatus();
  if (!pending) return null;

  return (
    <span
      aria-hidden
      className="absolute inset-x-3 top-0 h-0.5 origin-left animate-pulse rounded-full bg-brand-500"
    />
  );
}

/**
 * The pending state of one tab, pager step or filter link: the control lights
 * up in brand colour, and its own icon becomes a spinner, until the router
 * commits.
 *
 * It goes where the control's leading icon goes and takes that icon as its
 * children, so a caller writes it once instead of positioning two things:
 *
 *   <Link className="relative ...">
 *     <LinkPending size={15}><Package size={15} /></LinkPending>
 *     Plans
 *   </Link>
 *
 * NOTHING HERE CHANGES THE SIZE OF ANYTHING. The wash is one absolutely
 * positioned overlay borrowing the host's own corner radius, and the spinner
 * replaces the icon rather than joining it. A tab strip that grows a spinner
 * pushes every tab after it sideways at the moment the reader is still moving
 * a finger towards one of them, which is how the wrong tab gets opened - a
 * worse outcome than the dead interval this is here to fix.
 *
 * The wash carries the message on its own and the pulse is only an accent, on
 * purpose: globals.css cuts every animation to nothing under
 * prefers-reduced-motion, so an indicator that says "loading" purely by moving
 * says nothing at all to the readers who asked not to be moved at. A brand ring
 * around a previously grey tab still reads as "this is the one you tapped" when
 * it is perfectly still.
 *
 * The host must be `relative`, and pass a `size` matching its icon so the swap
 * is the same number of pixels.
 */
export function LinkPending({
  children,
  size = 15,
  className,
}: {
  /** The control's own icon, shown whenever nothing is loading. */
  children?: ReactNode;
  /** Pixel size of that icon, so the spinner takes exactly its place. */
  size?: number;
  /** Extra classes for the wash, e.g. a tighter inset inside a rounded pill. */
  className?: string;
}) {
  const { pending } = useLinkStatus();
  if (!pending) return <>{children}</>;

  return (
    <>
      {/* A control with no icon - the section pills carry a label only - gets
          the wash and nothing else, rather than a spinner appearing out of
          nowhere and widening the pill mid-tap. */}
      {children ? (
        <Loader2
          aria-hidden
          size={size}
          className="shrink-0 animate-spin text-brand-500"
        />
      ) : null}

      <span
        aria-hidden
        className={cx(
          "pointer-events-none absolute inset-0 animate-pulse rounded-[inherit] bg-brand-500/12 ring-1 ring-brand-500/70 ring-inset",
          className,
        )}
      />

      {/*
       * Announced rather than labelled. role="status" reads its CONTENT when
       * the node appears, so an aria-label on an empty span - which is what the
       * decorative parts above would otherwise carry - announces nothing at
       * all. Real text in a visually hidden node is what a screen reader user
       * actually hears.
       */}
      <span role="status" className="sr-only">
        Loading
      </span>
    </>
  );
}

/**
 * The submit button of a plain `<form method="get">` - the filter bars above
 * the admin tables, whose Apply button navigates by reloading the document.
 *
 * This cannot use `useLinkStatus`, which only exists inside a <Link>, and it
 * cannot use `useFormStatus`, which only tracks a React form action. A GET form
 * is a browser navigation that React never sees, so the only honest signal is
 * the form's own submit event.
 *
 * It listens on the form rather than on its own click so that pressing Enter in
 * a filter field lights the button too - on a phone the keyboard's Go key is
 * how most of these are submitted, and a button that only reacts to being
 * tapped is dark for exactly those readers.
 *
 * USAGE - drop it in place of the existing <button type="submit"> and give it
 * the icon that button already had:
 *
 *   <FilterSubmitButton icon={<Filter size={13} />}>Apply</FilterSubmitButton>
 */
export function FilterSubmitButton({
  children,
  icon,
  iconSize = 13,
  variant = "secondary",
  size = "sm",
  className,
}: {
  children: ReactNode;
  /** The button's own icon, replaced by the spinner while the page loads. */
  icon?: ReactNode;
  iconSize?: number;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;

    const onSubmit = () => setPending(true);

    /*
     * Back out of a filtered list and the browser may restore this document
     * from its cache exactly as it was - which, for a page whose last act was
     * to submit, means a button frozen mid-spin and permanently disabled. The
     * restore is the only event that says so.
     */
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(false);
    };

    form.addEventListener("submit", onSubmit);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      form.removeEventListener("submit", onSubmit);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);

  /*
   * Disabling is safe here and is half the point: the owner's complaint was
   * people tapping twice. The form's submission is queued the moment the submit
   * event finishes uncancelled, and the disabled check happens before that, so
   * a button that goes disabled in response to the event cannot cancel the
   * navigation it is reporting on.
   */
  return (
    <button
      ref={ref}
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={buttonClass(variant, size, className)}
    >
      {pending ? (
        <Loader2 aria-hidden size={iconSize} className="shrink-0 animate-spin" />
      ) : (
        icon
      )}
      {children}
      {pending ? (
        <span role="status" className="sr-only">
          Loading
        </span>
      ) : null}
    </button>
  );
}
