"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";

import { deleteCreditPack, saveCreditPack } from "./actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { Checkbox, Field, Input } from "@/components/form";
import { Badge } from "@/components/ui";
// Only the pure formatters and the two ladder sums. The service-role helpers in
// the same module are never referenced here, so nothing privileged is
// constructed in the browser.
import { bonusPercent, formatCredits, rupeesPerCredit } from "@/lib/credits";
import type { CreditPack } from "@/lib/types";

type Draft = { price: string; credits: string };

/** "Rs 0.45 per credit". Three decimals only when the ladder is that fine. */
function perCredit(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return `Rs ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} per credit`;
}

function parse(raw: string, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The money-to-credits ladder, edited in place.
 *
 * Every row is recalculated from the values currently in the boxes, not from
 * what is stored, so raising one pack's credits shows immediately how it now
 * compares with the rest. The ladder is not a formula - the bonus tiers are
 * deliberately uneven - so seeing the comparison is the only way to keep it
 * sensible while editing it.
 */
export function PackLadder({ packs }: { packs: CreditPack[] }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      packs.map((pack) => [
        pack.id,
        { price: String(pack.price_inr), credits: String(pack.credits) },
      ]),
    ),
  );

  const edit = (id: string, patch: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  // What each row would be if saved right now.
  const live: CreditPack[] = packs.map((pack) => {
    const draft = drafts[pack.id];
    return {
      ...pack,
      price_inr: parse(draft?.price ?? "", pack.price_inr),
      credits: parse(draft?.credits ?? "", pack.credits),
    };
  });

  // The entry rung: the cheapest thing an officer can buy. Everything above it
  // is expected to give more credits per rupee, and the percentage says by how
  // much.
  const baseline = live.reduce<CreditPack | undefined>(
    (lowest, pack) => (!lowest || pack.price_inr < lowest.price_inr ? pack : lowest),
    undefined,
  );

  return (
    <ul className="space-y-3">
      {packs.map((pack, index) => {
        const row = live[index];
        const rate = rupeesPerCredit(row);
        const bonus = bonusPercent(row, baseline);
        const isBaseline = baseline?.id === pack.id;

        return (
          <li key={pack.id} className="overflow-hidden rounded-xl border border-line/70 bg-panel/50">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-divider px-4 py-2.5">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-ink">{pack.name}</p>
                  {pack.is_active ? null : <Badge tone="warn">hidden</Badge>}
                  {isBaseline ? (
                    <Badge tone="neutral">entry rung</Badge>
                  ) : bonus === 0 ? null : (
                    <Badge tone={bonus > 0 ? "good" : "bad"}>
                      {bonus > 0 ? `+${bonus}%` : `${bonus}%`} vs {baseline?.name}
                    </Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  Rs {row.price_inr.toLocaleString("en-IN")} buys{" "}
                  {formatCredits(row.credits)} credits — {perCredit(rate)}
                </p>
              </div>

              <InlineActionForm action={deleteCreditPack} hidden={{ pack_id: pack.id }}>
                <ConfirmSubmitButton
                  message={`Delete the "${pack.name}" pack? Payments already made through it keep their own amount and credits.`}
                >
                  <Trash2 size={13} />
                  Delete
                </ConfirmSubmitButton>
              </InlineActionForm>
            </div>

            <ActionForm action={saveCreditPack} closeOnSuccess={false} className="px-4 py-4">
              <input type="hidden" name="pack_id" value={pack.id} />

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Name" name={`name_${pack.id}`}>
                  <Input
                    name="name"
                    id={`name_${pack.id}`}
                    required
                    defaultValue={pack.name}
                    autoComplete="off"
                  />
                </Field>

                <Field label="Price (Rs)" name={`price_${pack.id}`}>
                  <Input
                    name="price_inr"
                    id={`price_${pack.id}`}
                    type="number"
                    required
                    min={1}
                    step="1"
                    value={drafts[pack.id]?.price ?? ""}
                    onChange={(e) => edit(pack.id, { price: e.target.value })}
                  />
                </Field>

                <Field label="Credits" name={`credits_${pack.id}`}>
                  <Input
                    name="credits"
                    id={`credits_${pack.id}`}
                    type="number"
                    required
                    min={1}
                    step="1"
                    value={drafts[pack.id]?.credits ?? ""}
                    onChange={(e) => edit(pack.id, { credits: e.target.value })}
                  />
                </Field>

                <Field label="Order" name={`sort_${pack.id}`} hint="Lowest first.">
                  <Input
                    name="sort_order"
                    id={`sort_${pack.id}`}
                    type="number"
                    min={0}
                    step="10"
                    defaultValue={pack.sort_order}
                  />
                </Field>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <Checkbox
                  name="is_active"
                  label="Offered to officers"
                  hint="Off keeps the pack and its history, but hides it on the buy page."
                  defaultChecked={pack.is_active}
                />
                <SubmitButton size="sm">Save pack</SubmitButton>
              </div>
            </ActionForm>
          </li>
        );
      })}
    </ul>
  );
}
