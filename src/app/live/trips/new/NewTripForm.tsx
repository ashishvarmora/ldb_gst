"use client";

import { useState } from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";

import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, Input } from "@/components/form";
import type { TripDirection } from "@/lib/live/shared";

import { createTrip } from "../../actions";

const CHOICES: { v: TripDirection; title: string; sub: string; icon: typeof ArrowUpRight }[] = [
  { v: "outgoing", title: "We are sending", sub: "To a dealer, customer or own site. Our driver and truck.", icon: ArrowUpRight },
  { v: "incoming", title: "We are receiving", sub: "A supplier sends to us. Type his driver and truck on the trip.", icon: ArrowDownLeft },
];

export function NewTripForm({ defaultDirection, copyId }: { defaultDirection: TripDirection; copyId: string | null }) {
  const [dir, setDir] = useState<TripDirection>(defaultDirection);
  return (
    <ActionForm action={createTrip} closeOnSuccess={false} className="space-y-3">
      {copyId ? <input type="hidden" name="copy" value={copyId} /> : null}
      <fieldset className="live-dir-pick">
        <legend className="field-label">Direction</legend>
        {CHOICES.map((c) => (
          <label key={c.v} className="live-dir-card" data-on={dir === c.v || undefined}>
            <input type="radio" name="direction" value={c.v} checked={dir === c.v} onChange={() => setDir(c.v)} />
            <span className={`live-dir-icon live-dir-${c.v}`}>
              <c.icon size={16} />
            </span>
            <span className="min-w-0">
              <strong>{c.title}</strong>
              <small>{c.sub}</small>
            </span>
          </label>
        ))}
      </fieldset>
      {dir === "incoming" ? (
        <p className="live-note">If the supplier already uses Rahdari, he can create the trip himself and just send you his tracking link.</p>
      ) : null}
      <section className="panel live-form-block">
        <Field label="Trip name" name="trip_name" required hint="Trip number is given automatically. Name and number never change.">
          <Input name="trip_name" required maxLength={80} autoComplete="off" placeholder={dir === "incoming" ? "e.g. Clay from Morbi supplier" : "e.g. Rajkot order 448"} />
        </Field>
      </section>
      <div className="live-form-actions">
        <SubmitButton className="w-full sm:w-auto" pendingLabel="Creating…">
          Create trip
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
