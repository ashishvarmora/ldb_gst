"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { setTruckPaused } from "@/app/portal/trucks/actions";
import { cx } from "@/components/ui";
import type { ActionResult } from "@/lib/types";

/**
 * Pause or resume one truck from the list, without opening it.
 *
 * Pausing was two navigations and a scroll: open the truck, find the button,
 * come back. On a phone, with a dozen lorries, that is the difference between
 * turning four of them off and not bothering.
 *
 * What it saves is not money - automatic checking is part of the plan and costs
 * no credits. It is the tracking SLOT: the plan caps how many lorries may be
 * watched at once, so every parked truck left switched on is one the officer
 * cannot replace with a lorry that is actually moving. Reaching that from the
 * list is the difference between a plan that fits the fleet and one that
 * appears full.
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

  if (!active && !resumable) {
    return (
      <span className="text-[11px] leading-tight text-faint">
        Open to fix
        <span className="sr-only"> {truckNumber} before resuming it</span>
      </span>
    );
  }

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
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
      aria-label={`${active ? "Pause" : "Resume"} tracking for ${truckNumber}`}
      title={active ? "Pause tracking" : "Resume tracking"}
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
