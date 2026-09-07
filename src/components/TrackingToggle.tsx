"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";

import { setTruckPaused } from "@/app/portal/trucks/actions";
import { cx } from "@/components/ui";
import type { ActionResult } from "@/lib/types";

/**
 * Pause a truck, or take it live again, from the list without opening it.
 *
 * Pausing was two navigations and a scroll: open the truck, find the button,
 * come back. On a phone, with a dozen lorries, that is the difference between
 * turning four of them off and not bothering - and not bothering is expensive.
 * An automatic check costs a credit and the platform's beat is fifteen minutes,
 * so one lorry left switched on in a yard spends about 96 credits a day. Four of
 * them is most of a small plan's monthly balance, gone on being told the same
 * crossing over and over.
 *
 * Freeing the truck's tracking SLOT is the second reason - the plan caps how
 * many lorries may be watched at once, so a parked truck left on is one the
 * officer cannot replace with a lorry that is moving - but it is the smaller
 * one, and saying it first is how this control came to look optional.
 *
 * "Go live" rather than "Resume" in the labels, because that is the owner's own
 * word for it and it is the one that reads as an action on a switch.
 *
 * WHY IT IS NOT INSIDE THE CARD'S LINK
 *
 * The card is an <a> covering its whole area. A <form> nested inside an anchor
 * is invalid HTML, and a button inside one fires the navigation as well as the
 * submit. So the card leaves a gap in its link and this sits in it - see
 * TruckCard, where the anchor is an absolutely positioned overlay rather than
 * a wrapper, and this control sits above it on the z axis.
 *
 * WHY NOT A CHECKBOX
 *
 * It has to survive being pressed with no JavaScript yet - a phone on a slow
 * connection renders this list long before it hydrates. A form with a submit
 * button works then; an onChange handler does nothing at all. So the switch is
 * a button that looks like a switch, with role="switch" carrying the state to
 * anyone not looking at it.
 */
export function TrackingToggle({
  truckId,
  active,
  /** The registration number, so the label says which truck this is. */
  truckNumber,
  /**
   * False for a truck that will stop again the moment it is resumed - a
   * suspended account, or a number the toll network cannot answer. Resuming
   * those from a list, with no room to say why it failed, teaches the officer
   * that the switch is broken.
   */
  resumable = true,
}: {
  truckId: string;
  active: boolean;
  truckNumber: string;
  resumable?: boolean;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(setTruckPaused, null);
  const router = useRouter();

  /* The card's own copy - status, last checked, the pause reason - is all
     server-rendered, so the row has to be re-fetched or it keeps claiming the
     truck is live after this has paused it. */
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);

  /*
   * A truck that cannot simply be switched back on gets a way IN instead of a
   * dead end. It used to get the words "Open to fix" in grey, which was worse
   * than saying nothing: the card's link is an overlay UNDERNEATH this control,
   * so a span sitting here swallowed the tap and the one row in the list that
   * needed opening was the one row that could not be opened by touching the
   * only instruction on it.
   *
   * A real link, because the truck's own page is where both of these are
   * fixable - it carries the reason in full, the registration number to correct
   * and the support line for a suspended account - and because "go live" from a
   * list, with no room to explain why it stopped again a minute later, teaches
   * the officer that the switch is broken.
   */
  if (!active && !resumable) {
    return (
      <Link
        href={`/portal/trucks/${truckId}`}
        className={cx(
          "pointer-events-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded-lg px-2",
          "text-[11px] leading-tight font-medium",
          "text-brand-500 transition hover:bg-brand-500/10",
          "focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none",
        )}
      >
        Open to fix
        <span className="sr-only"> {truckNumber} before taking it live again</span>
        <ArrowRight size={11} aria-hidden className="shrink-0" />
      </Link>
    );
  }

  return (
    /* pointer-events-auto: the card's content layer takes none, so that its
       link overlay underneath gets the tap. This is one of the two things on
       the row that has to take its own. */
    <form action={formAction} className="pointer-events-auto flex flex-col items-end gap-1">
      <input type="hidden" name="truck_id" value={truckId} />
      <input type="hidden" name="is_active" value={active ? "false" : "true"} />
      <Switch active={active} truckNumber={truckNumber} />
      {state && !state.ok ? (
        /* Right-aligned and narrow: the usual failure here is the plan's slot
           limit on resume, which is a sentence, and it must not shove the
           card's own text sideways. */
        <span className="max-w-[13rem] text-right text-[11px] leading-tight text-bad-500">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

function Switch({ active, truckNumber }: { active: boolean; truckNumber: string }) {
  /* useFormStatus rather than the action state: this reports the round trip,
     which on a phone is the whole of the feedback. It only works in a child of
     the form, which is why this is a separate component. */
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      role="switch"
      aria-checked={active}
      disabled={pending}
      /* The truck number is in the label because a screen reader reading down
         this list would otherwise hear "tracking, switch, on" twelve times
         with nothing to tell them apart. */
      aria-label={active ? `Pause tracking for ${truckNumber}` : `Go live with ${truckNumber}`}
      title={active ? "Pause tracking" : "Go live"}
      className={cx(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition",
        "focus-visible:ring-2 focus-visible:ring-brand-500/40 focus-visible:outline-none",
        active
          ? "border-brand-500 bg-brand-500"
          : "border-line-strong bg-sunken hover:border-line-strong",
        pending && "opacity-60",
      )}
    >
      <span
        aria-hidden
        className={cx(
          "flex size-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform",
          active ? "translate-x-[22px]" : "translate-x-[2px]",
        )}
      >
        {pending ? <Loader2 size={11} className="animate-spin text-muted" /> : null}
      </span>
    </button>
  );
}
