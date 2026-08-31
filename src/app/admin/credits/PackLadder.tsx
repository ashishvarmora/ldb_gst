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
// Only the pure formatters and the ladder sums. The service-role helpers in
// the same module are never referenced here, so nothing privileged is
// constructed in the browser.
//
// bonusPercent is aliased on the way in: it is the comparison between two fixed
// rungs, not the credit_percent column an open tier stores. Two different ideas
// that would otherwise share a name on the same row.
import {
  bonusPercent as valueAgainstEntryRung,
  creditsForAmount,
  describeOpenTier,
  formatCredits,
  rupeesPerCredit,
} from "@/lib/credits";
import type { CreditPack } from "@/lib/types";

type Draft = { price: string; credits: string; open: boolean; percent: string };

/** "Rs 0.45 per credit". Three decimals only when the ladder is that fine. */
function perCredit(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "--";
  return `Rs ${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 3 })} per credit`;
}

function parse(raw: string, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Rupees, the way this page writes them everywhere else. */
function rupees(value: number): string {
  return `Rs ${value.toLocaleString("en-IN")}`;
}

/**
 * The money-to-credits ladder, edited in place.
 *
 * Every row is recalculated from the values currently in the boxes, not from
 * what is stored, so raising one pack's credits shows immediately how it now
 * compares with the rest. The ladder is not a formula - the rungs are
 * deliberately uneven - so seeing the comparison is the only way to keep it
 * sensible while editing it.
 *
 * A row prices itself in one of two ways and never both. A fixed rung leads
 * with the sentence it makes: "Rs 500 buys 1,100 credits" - the whole of what
 * that row decides, and reading it as a sentence is what stops a price and a
 * credit count being swapped. An open tier has no such sentence, because the
 * buyer picks the amount; it states its rule and then shows what that rule
 * actually costs at three amounts, so the consequence is on screen rather than
 * left as arithmetic.
 */
export function PackLadder({
  packs,
  creditsPerRupee,
}: {
  packs: CreditPack[];
  /** The base rate an open tier multiplies. Edited just above this ladder. */
  creditsPerRupee: number;
}) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(
      packs.map((pack) => [
        pack.id,
        {
          price: String(pack.price_inr),
          credits: String(pack.credits),
          open: pack.is_open_ended,
          percent: String(pack.credit_percent),
        },
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
      is_open_ended: draft?.open ?? pack.is_open_ended,
      credit_percent: parse(draft?.percent ?? "", pack.credit_percent),
    };
  });

  // The entry rung: the cheapest fixed thing a customer can buy. Everything
  // above it is expected to give more credits per rupee, and the percentage
  // says by how much.
  //
  // An open tier is left out of this comparison on purpose. Its credits column
  // is not what it sells, so a rupees-per-credit figure for it would be a
  // number nobody could ever pay.
  const baseline = live.reduce<CreditPack | undefined>((lowest, pack) => {
    if (pack.is_open_ended) return lowest;
    return !lowest || pack.price_inr < lowest.price_inr ? pack : lowest;
  }, undefined);

  return (
    <ul className="space-y-3">
      {packs.map((pack, index) => {
        const row = live[index];
        const open = row.is_open_ended;
        const rate = rupeesPerCredit(row);
        const valueGain = open ? 0 : valueAgainstEntryRung(row, baseline);
        const isBaseline = !open && baseline?.id === pack.id;

        // The minimum, then double, then quadruple it. Written against the row
        // rather than hard-coded, so changing the minimum changes the worked
        // example along with it.
        const examples = open
          ? [row.price_inr, row.price_inr * 2, row.price_inr * 4].map((amount) => ({
              amount,
              credits: creditsForAmount(row, amount, creditsPerRupee),
            }))
          : [];

        return (
          <li key={pack.id} className="overflow-hidden rounded-xl border border-line/70 bg-panel/50">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-divider px-4 py-3">
              <div className="min-w-0">
                {open ? (
                  <p className="text-base text-strong">
                    <span className="font-semibold tabular-nums">{rupees(row.price_inr)}</span>{" "}
                    <span className="text-muted">or more · {describeOpenTier(row, creditsPerRupee)}</span>
                  </p>
                ) : (
                  <p className="text-base text-strong">
                    <span className="font-semibold tabular-nums">{rupees(row.price_inr)}</span>{" "}
                    <span className="text-muted">buys</span>{" "}
                    <span className="font-semibold tabular-nums">{formatCredits(row.credits)}</span>{" "}
                    <span className="text-muted">credits</span>
                  </p>
                )}

                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted">{pack.name}</span>
                  {open ? (
                    <Badge tone="brand">open tier</Badge>
                  ) : (
                    <span className="text-xs tabular-nums text-brand-500">{perCredit(rate)}</span>
                  )}
                  {pack.is_active ? null : <Badge tone="warn">hidden</Badge>}
                  {isBaseline ? (
                    <Badge tone="neutral">entry rung</Badge>
                  ) : open || valueGain === 0 ? null : (
                    <Badge tone={valueGain > 0 ? "good" : "bad"}>
                      {valueGain > 0 ? `+${valueGain}%` : `${valueGain}%`} vs {baseline?.name}
                    </Badge>
                  )}
                </div>
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

            {open ? (
              <div className="border-b border-divider bg-sunken/50 px-4 py-3">
                <p className="text-xs text-muted">
                  What that comes to, at the base rate above and this tier&apos;s percentage:
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1">
                  {examples.map((example) => (
                    <li key={example.amount} className="text-xs tabular-nums text-ink">
                      {rupees(example.amount)} <span className="text-muted">buys</span>{" "}
                      <span className="font-medium text-brand-500">
                        {example.credits === null ? "--" : formatCredits(example.credits)}
                      </span>{" "}
                      <span className="text-muted">credits</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <ActionForm action={saveCreditPack} closeOnSuccess={false} className="px-4 py-4">
              <input type="hidden" name="pack_id" value={pack.id} />

              {/* credits is not-null in the table but means nothing on an open
                  tier, so the stored value rides along untouched rather than a
                  new one being invented on every save. */}
              {open ? <input type="hidden" name="credits" value={pack.credits} /> : null}

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

                <Field label={open ? "Minimum (Rs)" : "Price (Rs)"} name={`price_${pack.id}`}>
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

                {open ? (
                  <Field
                    label="Credit (%)"
                    name={`percent_${pack.id}`}
                    hint="Share of the money. 100 is the base rate, 250 is two and a half times it."
                  >
                    <Input
                      name="credit_percent"
                      id={`percent_${pack.id}`}
                      type="number"
                      required
                      min={1}
                      max={10000}
                      step="any"
                      value={drafts[pack.id]?.percent ?? ""}
                      onChange={(e) => edit(pack.id, { percent: e.target.value })}
                    />
                  </Field>
                ) : (
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
                )}

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

              {/* The shared Checkbox is uncontrolled, and the sentence at the
                  top of this row has to change the moment the box is ticked.
                  Listening on the wrapper picks the change up without a second
                  checkbox implementation living in this file. */}
              <div
                className="mt-3 grid gap-3 sm:grid-cols-2"
                onChange={(e) => {
                  const target = e.target as HTMLInputElement;
                  if (target.name === "is_open_ended" && target.type === "checkbox") {
                    edit(pack.id, { open: target.checked });
                  }
                }}
              >
                <Checkbox
                  name="is_active"
                  label="Offered to customers"
                  hint="Off keeps the pack and its history, but hides it on the buy page."
                  defaultChecked={pack.is_active}
                />
                <Checkbox
                  name="is_open_ended"
                  label="Open tier — the buyer names the amount"
                  hint="The price becomes a minimum, and credits are the base rate times the percentage. The credits box does not apply."
                  defaultChecked={pack.is_open_ended}
                />
              </div>

              <div className="mt-3 flex justify-end">
                <SubmitButton size="sm">Save pack</SubmitButton>
              </div>
            </ActionForm>
          </li>
        );
      })}
    </ul>
  );
}
