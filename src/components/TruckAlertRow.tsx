"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import { deleteTruckAlert, setTruckAlertEnabled, updateTruckAlert } from "@/app/portal/trucks/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { HaltFields, IntervalFields } from "@/components/TruckAlertForm";
import { Badge, buttonClass, cx } from "@/components/ui";
import type { ActionResult, AlertRuleKind } from "@/lib/types";

/**
 * One alert on the truck page, as a compact row (owner, 20 Nov 2026):
 *
 *   <name> · every 15 minutes            [switch] [⋯]
 *
 * The switch turns it on and off at once; the ⋯ menu holds Edit (opens the
 * edit form under the row) and Delete (with a confirmation). Each control is
 * its own small form posting to the existing server action, so the behaviour
 * is exactly what the old Turn off / bin / Change how often controls did.
 */
export type AlertRowData = {
  id: string;
  name: string;
  kind: AlertRuleKind;
  /** alertCadence(): "every 15 minutes" or "alert after 4 hours · pauses after 12 hours". */
  summary: string;
  intervalMinutes: number;
  floorMinutes: number;
  haltAfterHours: number | null;
  pauseAfterHours: number | null;
  isEnabled: boolean;
  /** The admin withdrew the rule from the catalogue; the alert keeps running. */
  withdrawn: boolean;
  /** halt only: the truck is currently reported as halted. */
  halted: boolean;
};

export function TruckAlertRow({ alert, truckNumber }: { alert: AlertRowData; truckNumber: string }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Close the menu on a tap elsewhere or on Escape. */
  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <li id={`alert-${alert.id}`} className={cx("alert-row", !alert.isEnabled && "is-off")}>
      <div className="alert-row-main">
        <div className="alert-row-text">
          <p className="alert-row-title">
            <span className="alert-row-name">{alert.name}</span>
            <span className="alert-row-cadence"> · {alert.summary}</span>
          </p>
          {alert.halted || !alert.isEnabled || alert.withdrawn ? (
            <div className="alert-row-badges">
              {alert.halted ? <Badge tone="warn">Halted now</Badge> : null}
              {alert.isEnabled ? null : <Badge>Off</Badge>}
              {alert.withdrawn ? <Badge tone="warn">Withdrawn</Badge> : null}
            </div>
          ) : null}
        </div>

        <AlertSwitch alertId={alert.id} enabled={alert.isEnabled} name={alert.name} />

        <div className="alert-row-menu" ref={menuRef}>
          <button
            type="button"
            className="alert-row-more"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={`More for ${alert.name}`}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreHorizontal size={18} />
          </button>
          {menuOpen ? (
            <div role="menu" className="alert-menu">
              <button
                type="button"
                role="menuitem"
                className="alert-menu-item"
                onClick={() => {
                  setEditing(true);
                  setMenuOpen(false);
                }}
              >
                <Pencil size={14} aria-hidden />
                Edit
              </button>
              <DeleteAlert alertId={alert.id} name={alert.name} truckNumber={truckNumber} />
            </div>
          ) : null}
        </div>
      </div>

      {editing ? (
        <div className="alert-row-edit">
          <ActionForm action={updateTruckAlert} closeOnSuccess={false} refresh={false}>
            <input type="hidden" name="alert_id" value={alert.id} />
            {alert.kind === "halt" ? (
              <HaltFields
                defaultHaltHours={alert.haltAfterHours}
                defaultPauseHours={alert.pauseAfterHours}
              />
            ) : (
              <IntervalFields
                compact
                floorMinutes={alert.floorMinutes}
                defaultMinutes={alert.intervalMinutes}
              />
            )}
            <div className="alert-row-edit-actions">
              <button
                type="button"
                className={buttonClass("ghost", "sm")}
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
              <SubmitButton size="sm">Save</SubmitButton>
            </div>
          </ActionForm>
        </div>
      ) : null}
    </li>
  );
}

/** The on/off switch: a submit button drawn as a switch, like TrackingToggle. */
function AlertSwitch({ alertId, enabled, name }: { alertId: string; enabled: boolean; name: string }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(
    setTruckAlertEnabled,
    null,
  );
  /* No router.refresh(): setTruckAlertEnabled() revalidates this page, so
     the action's own response already carries the re-rendered row. */

  return (
    <form action={formAction} className="alert-row-switch">
      <input type="hidden" name="alert_id" value={alertId} />
      <input type="hidden" name="is_enabled" value={enabled ? "false" : "true"} />
      <SwitchButton enabled={enabled} name={name} />
      {state && !state.ok ? <span className="alert-row-error">{state.error}</span> : null}
    </form>
  );
}

function SwitchButton({ enabled, name }: { enabled: boolean; name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={enabled}
      aria-label={enabled ? `Turn off ${name}` : `Turn on ${name}`}
      title={enabled ? "Turn off" : "Turn on"}
      disabled={pending}
      className={cx("alert-switch", enabled && "is-on", pending && "is-busy")}
    >
      <span aria-hidden className="alert-switch-knob">
        {pending ? <Loader2 size={11} className="animate-spin" /> : null}
      </span>
    </button>
  );
}

function DeleteAlert({
  alertId,
  name,
  truckNumber,
}: {
  alertId: string;
  name: string;
  truckNumber: string;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(deleteTruckAlert, null);

  return (
    <form action={formAction}>
      <input type="hidden" name="alert_id" value={alertId} />
      <DeleteButton message={`Remove the "${name}" alert from ${truckNumber}?`} />
      {state && !state.ok ? <span className="alert-row-error">{state.error}</span> : null}
    </form>
  );
}

function DeleteButton({ message }: { message: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="menuitem"
      disabled={pending}
      className="alert-menu-item is-danger"
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} aria-hidden />}
      Delete
    </button>
  );
}
