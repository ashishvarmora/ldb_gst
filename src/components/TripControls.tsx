"use client";

import { useId } from "react";
import { Check, Copy, Link2Off, MessageCircle } from "lucide-react";

import { createTripShare, revokeTripShare, setTruckDestination } from "@/app/portal/trucks/trip-actions";
import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { Input } from "@/components/form";
import { buttonClass } from "@/components/ui";
import { useCopy } from "@/components/useCopy";
import { PLACES, stateName } from "@/lib/places";

/*
 * The two small forms behind "Destination" and "Share trip" on the truck
 * page's top card (owner, 24 Nov 2026). Both live inside a Modal (a bottom
 * sheet on a phone); the server actions are in trip-actions.ts.
 */

/**
 * One searchable box: a native datalist of towns, ports and toll plazas. The
 * phone's own suggestion list does the searching, so there is nothing to load
 * while typing. The server checks the name again before saving.
 */
export function DestinationForm({
  truckId,
  current,
  plazas,
}: {
  truckId: string;
  current: string | null;
  /** Toll plaza names that have a position. */
  plazas: string[];
}) {
  const listId = useId();

  return (
    <div className="space-y-3">
      <ActionForm action={setTruckDestination}>
        <input type="hidden" name="truck_id" value={truckId} />
        <label className="field-label" htmlFor={`${listId}-input`}>
          Where is it going?
        </label>
        <Input
          id={`${listId}-input`}
          name="destination"
          list={listId}
          defaultValue={current ?? ""}
          placeholder="Town, port or toll plaza — e.g. Mundra"
          autoComplete="off"
          enterKeyHint="done"
          required
        />
        <datalist id={listId}>
          {PLACES.map((place) => (
            <option key={place.name} value={place.name}>
              {stateName(place.state)}
            </option>
          ))}
          {plazas.map((name) => (
            <option key={`plaza-${name}`} value={name}>
              Toll plaza
            </option>
          ))}
        </datalist>
        <p className="field-hint mt-1.5">
          Used only to show roughly how far is left. Nothing is charged and no message is sent.
        </p>
        <div className="mt-4 flex justify-end">
          <SubmitButton>Save destination</SubmitButton>
        </div>
      </ActionForm>

      {current ? (
        <ActionForm action={setTruckDestination}>
          <input type="hidden" name="truck_id" value={truckId} />
          <input type="hidden" name="destination" value="" />
          <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
            Remove destination
          </SubmitButton>
        </ActionForm>
      ) : null}
    </div>
  );
}

/**
 * The public link: make it, copy it, send it on WhatsApp, stop it. The page
 * passes the live link (if any) back in after every action, via the refresh
 * ActionForm does on success.
 */
export function ShareTrip({
  truckId,
  shareUrl,
  expiresLabel,
  shareText,
}: {
  truckId: string;
  /** The live link, or null when none works now. */
  shareUrl: string | null;
  /** "Works until 1 Dec, 6:30 pm". */
  expiresLabel: string | null;
  /** WhatsApp message, the link is appended. */
  shareText: string;
}) {
  const { copied, problem, copy } = useCopy();

  if (!shareUrl) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted">
          Anyone with the link can see this truck&rsquo;s latest toll crossings and distance to the
          destination — no sign-in. They do not see your name, phone, label or alerts. The link
          works for 7 days and you can stop it any time.
        </p>
        <ActionForm action={createTripShare} closeOnSuccess={false}>
          <input type="hidden" name="truck_id" value={truckId} />
          <SubmitButton className="w-full" pendingLabel="Making link…">
            Create link
          </SubmitButton>
        </ActionForm>
      </div>
    );
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;

  return (
    <div className="space-y-3">
      <input
        readOnly
        value={shareUrl}
        aria-label="Trip link"
        className="field font-mono text-[13px]"
        onFocus={(event) => event.currentTarget.select()}
      />
      {expiresLabel ? <p className="text-xs text-muted">{expiresLabel}</p> : null}

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => copy(shareUrl)}
          className={buttonClass("secondary", "md", "w-full")}
        >
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          {copied ? "Copied" : "Copy link"}
        </button>
        <a
          href={whatsapp}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonClass("primary", "md", "w-full")}
        >
          <MessageCircle size={15} aria-hidden />
          WhatsApp
        </a>
      </div>
      {problem ? <p className="text-xs text-warn-500">{problem}</p> : null}

      <ActionForm action={revokeTripShare} closeOnSuccess={false} className="pt-1">
        <input type="hidden" name="truck_id" value={truckId} />
        <ConfirmSubmitButton
          message="Stop this link? Anyone who opens it will see that it has ended. You can make a new one later."
          variant="ghost"
          className="truck-remove-link"
        >
          <Link2Off size={14} aria-hidden />
          Stop sharing
        </ConfirmSubmitButton>
      </ActionForm>
    </div>
  );
}
