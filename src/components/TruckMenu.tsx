"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, PauseCircle, PlayCircle, Settings2, Trash2 } from "lucide-react";

import { removeTruck, setTruckPaused } from "@/app/portal/trucks/actions";
import { MoreMenu } from "@/components/MoreMenu";
import { deleteTruckMessage } from "@/lib/pause";
import type { ActionResult } from "@/lib/types";

/**
 * The ⋯ menu on a truck (owner, 20 Nov 2026): Pause / Go live and Delete, one
 * tap from the My trucks row and from the top card of the truck's own page.
 *
 * Each item is its own small form posting to the same server actions the rest
 * of the screen uses, so behaviour (credit and slot checks, the confirmation
 * text, where you land) is identical wherever it is pressed from.
 *
 * WHAT DELETE DOES - exactly what removeTruck() does, said in the confirm: the
 * tracked_trucks row goes, its alerts go with it (on delete cascade) and the
 * tracking slot is freed. Toll crossings (truck_events.tracked_truck_id is set
 * null, the rows stay), alerts already sent (alert_logs), charges
 * (credit_transactions), group membership and the truck's activity history are
 * all kept, keyed by the number.
 */
export function TruckMenu({
  truckId,
  truckNumber,
  active,
  resumable = true,
  place,
}: {
  truckId: string;
  truckNumber: string;
  active: boolean;
  /** False for a pause that would fire again at once (no credits, plan ended). */
  resumable?: boolean;
  /** "row" on My trucks; "page" in the truck page's top card. */
  place: "row" | "page";
}) {
  const [open, setOpen] = useState(false);

  return (
    <MoreMenu
      label={`More for ${truckNumber}`}
      open={open}
      onOpenChange={setOpen}
      className="truck-menu"
    >
      {place === "row" ? (
        active || resumable ? (
          <PauseItem truckId={truckId} active={active} onDone={() => setOpen(false)} />
        ) : (
          <Link role="menuitem" href={`/portal/trucks/${truckId}`} className="more-menu-item">
            <ArrowRight size={15} aria-hidden />
            Open to fix
          </Link>
        )
      ) : (
        /* A plain anchor: a hash-only change has to fire hashchange, which is
           what TruckTabs listens for to open the Settings tab. */
        <a role="menuitem" href="#settings" className="more-menu-item">
          <Settings2 size={15} aria-hidden />
          Truck settings
        </a>
      )}
      <DeleteItem truckId={truckId} truckNumber={truckNumber} />
    </MoreMenu>
  );
}

function PauseItem({
  truckId,
  active,
  onDone,
}: {
  truckId: string;
  active: boolean;
  onDone: () => void;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(setTruckPaused, null);
  const router = useRouter();
  /* A ref, so the effect runs once per result and not on every render. */
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!state?.ok) return;
    done.current();
    router.refresh();
  }, [state, router]);

  return (
    <form action={formAction}>
      <input type="hidden" name="truck_id" value={truckId} />
      <input type="hidden" name="is_active" value={active ? "false" : "true"} />
      <MenuSubmit
        icon={active ? <PauseCircle size={15} aria-hidden /> : <PlayCircle size={15} aria-hidden />}
        label={active ? "Pause tracking" : "Go live"}
        pendingLabel={active ? "Pausing…" : "Going live…"}
      />
      {state && !state.ok ? <p className="more-menu-error">{state.error}</p> : null}
    </form>
  );
}

function DeleteItem({ truckId, truckNumber }: { truckId: string; truckNumber: string }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(removeTruck, null);
  const message = deleteTruckMessage(truckNumber);

  return (
    <form action={formAction}>
      <input type="hidden" name="truck_id" value={truckId} />
      <MenuSubmit
        danger
        icon={<Trash2 size={15} aria-hidden />}
        label="Delete truck"
        pendingLabel="Deleting…"
        confirm={message}
      />
      {state && !state.ok ? <p className="more-menu-error">{state.error}</p> : null}
    </form>
  );
}

function MenuSubmit({
  icon,
  label,
  pendingLabel,
  danger = false,
  confirm,
}: {
  icon: React.ReactNode;
  label: string;
  pendingLabel: string;
  danger?: boolean;
  confirm?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="menuitem"
      disabled={pending}
      className={danger ? "more-menu-item is-danger" : "more-menu-item"}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
    >
      {pending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : icon}
      {pending ? pendingLabel : label}
    </button>
  );
}
