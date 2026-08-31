import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight, Plus, Settings } from "lucide-react";

import { PackLadder } from "../credits/PackLadder";
import { RateEditor } from "../credits/RateEditor";
import { createCreditPack, saveCreditsPerRupee } from "../credits/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, FormGrid, Input } from "@/components/form";
import { Modal } from "@/components/Modal";
import { EmptyState, LinkButton, Panel } from "@/components/ui";
import {
  describeOpenTier,
  describeRate,
  formatCredits,
  loadCreditPacks,
  loadCreditRates,
} from "@/lib/credits";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { CreditPack } from "@/lib/types";

/**
 * The rules, and nothing that has already happened.
 *
 * Two conversions in one place, because neither can be judged alone: money
 * becomes credits at the ladder below, credits become work at the rates under
 * it. What was actually bought and spent lives in the History tab, so a price
 * can be changed without scrolling past a year of receipts.
 */
export async function RulesTab() {
  const admin = getSupabaseAdmin();

  const [rates, packs, settings] = await Promise.all([
    loadCreditRates(admin),
    // Hidden packs included: this is the page where they are un-hidden.
    loadCreditPacks(admin, false),
    loadSettings(admin),
  ]);

  // The rung a customer starts on - the cheapest fixed pack, by price rather
  // than by sort order, because an admin can order the ladder however they like
  // and the entry rung is still whichever costs least.
  const entryPack = packs
    .filter((pack) => pack.is_active && !pack.is_open_ended)
    .reduce<CreditPack | undefined>(
      (lowest, pack) => (!lowest || pack.price_inr < lowest.price_inr ? pack : lowest),
      undefined,
    );

  // The rule the ladder ends in, if there is one. Only the first is described:
  // two open tiers would be two answers to the same question.
  const openTier = packs.find((pack) => pack.is_active && pack.is_open_ended);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <LinkButton href="/admin/settings" variant="secondary">
          <Settings size={14} />
          Payment settings
        </LinkButton>
      </div>

      <Panel
        className="mb-6"
        title="The whole of it, in two lines"
        description="Read this once and every number on this tab makes sense."
      >
        <div className="grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1fr_auto_1fr]">
          <div className="rounded-lg border border-line/70 bg-panel/50 p-4">
            <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Step 1</p>
            <p className="mt-1 text-sm font-medium text-ink">Rupees buy credits</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              A fixed pack is one sentence: this much money buys this many credits. An open tier is a
              rule instead — a minimum, and a percentage of whatever the buyer types — so the ladder
              does not end in a wall.
            </p>
            {entryPack ? (
              <p className="mt-2 text-xs text-brand-500">
                Right now: Rs {entryPack.price_inr.toLocaleString("en-IN")} buys{" "}
                {formatCredits(entryPack.credits)} credits.
              </p>
            ) : null}
            {openTier ? (
              <p className="mt-1 text-xs text-brand-500">
                Above that: Rs {openTier.price_inr.toLocaleString("en-IN")} or more, at{" "}
                {describeOpenTier(openTier, settings.creditsPerRupee)}.
              </p>
            ) : null}
          </div>

          <span className="flex items-center justify-center text-faint">
            <ArrowRight size={18} className="rotate-90 lg:rotate-0" />
          </span>

          <div className="rounded-lg border border-line/70 bg-panel/50 p-4">
            <p className="text-[11px] font-semibold tracking-wider text-muted uppercase">Step 2</p>
            <p className="mt-1 text-sm font-medium text-ink">Credits buy work</p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              Each action has a rate you can write either way round — one credit buys so many
              searches, or so many credits buy one search. Nothing is capped: a customer works until
              the balance runs out.
            </p>
            {rates.length > 0 ? (
              <p className="mt-2 text-xs text-brand-500">
                Right now:{" "}
                {rates
                  .map((rate) => `${rate.label.toLowerCase()}, ${describeRate(rate)}`)
                  .join(" · ")}
                .
              </p>
            ) : null}
          </div>
        </div>
      </Panel>

      <FlowSection
        step="1"
        title="Money → credits"
        description="What a rupee buys. A fixed pack is bought whole; an open tier takes whatever amount the customer types, from its minimum up."
        action={<NewPackButton />}
      >
        <Panel
          className="mb-3"
          title="The base rate"
          description="What one rupee buys on a tier of 100%. Fixed packs state their own credits and ignore it; an open tier is built entirely on it."
        >
          <ActionForm action={saveCreditsPerRupee} closeOnSuccess={false}>
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Credits per rupee" name="credits_per_rupee" className="w-44">
                {/* step="any": the rate is not always a whole number, and a
                    stepping rule the browser enforces would refuse to submit a
                    perfectly good one. */}
                <Input
                  name="credits_per_rupee"
                  type="number"
                  required
                  min={0.0001}
                  step="any"
                  defaultValue={settings.creditsPerRupee}
                />
              </Field>
              <SubmitButton size="sm">Save rate</SubmitButton>
            </div>
            <p className="mt-2 text-xs text-muted">
              Rs 1 = {formatCredits(settings.creditsPerRupee)} credit
              {settings.creditsPerRupee === 1 ? "" : "s"} at 100%, so Rs 1,000 would buy{" "}
              {formatCredits(1000 * settings.creditsPerRupee)} credits on a tier of 100%. Each open
              tier below shows what it comes to once its own percentage is applied.
            </p>
          </ActionForm>
        </Panel>

        {packs.length === 0 ? (
          <Panel>
            <EmptyState
              title="No credit packs yet"
              description="Without a pack there is nothing to top up with, so credits can only be added by hand on a customer's page."
              action={<NewPackButton />}
            />
          </Panel>
        ) : (
          <PackLadder packs={packs} creditsPerRupee={settings.creditsPerRupee} />
        )}

        {settings.razorpayEnabled ? null : (
          <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
            <span className="text-warn-500">Online payment is switched off.</span> These packs are
            still the price list you charge against, but nothing can be bought in the app — credits
            arrive only when you add them on a customer&apos;s page. Turn it on in{" "}
            <Link href="/admin/settings" className="text-brand-400 hover:underline">
              settings
            </Link>
            .
          </p>
        )}
      </FlowSection>

      <FlowSection
        step="2"
        title="Credits → usage"
        description="What each chargeable action draws from the balance. Set it from either end, and the worked example shows what it costs in a normal day. Changes apply from the next call onwards."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {rates.length === 0 ? (
            <Panel>
              <EmptyState
                title="No credit rates found"
                description="Run 0008_credits_and_alert_rules.sql against your Supabase project — it seeds the rate rows."
              />
            </Panel>
          ) : (
            rates.map((rate) => <RateEditor key={rate.action} rate={rate} />)
          )}
        </div>
      </FlowSection>
    </>
  );
}

function NewPackButton() {
  return (
    <Modal
      triggerLabel="New pack"
      triggerIcon={<Plus size={15} />}
      triggerSize="sm"
      title="Add a credit pack"
      description="A price, and either what it buys or the rule it follows. Everything here can be changed later."
    >
      <ActionForm action={createCreditPack}>
        <div className="space-y-4">
          <FormGrid cols={2}>
            <Field label="Pack name" name="name" hint="Shown to the customer on the buy page.">
              <Input name="name" required placeholder="Standard" autoComplete="off" />
            </Field>
            <Field label="Sort order" name="sort_order" hint="Lowest first, so cheapest at the top.">
              <Input name="sort_order" type="number" min={0} step="10" defaultValue={100} />
            </Field>
          </FormGrid>

          <FormGrid cols={2}>
            <Field
              label="Price (Rs)"
              name="price_inr"
              hint="What the customer pays — or the minimum they may pay, on an open tier."
            >
              <Input name="price_inr" type="number" required min={1} step="1" placeholder="500" />
            </Field>
            <Field
              label="Credits"
              name="credits"
              hint="What they get for it. Leave blank on an open tier — the amount decides."
            >
              <Input name="credits" type="number" min={1} step="1" placeholder="1200" />
            </Field>
          </FormGrid>

          <Checkbox
            name="is_open_ended"
            label="Open tier — the buyer names the amount"
            hint="The price becomes a minimum, and credits are the base rate times the percentage below."
          />

          <Field
            label="Credit (%)"
            name="credit_percent"
            hint="Open tiers only. Share of the money that becomes credits: 100 is the base rate, 250 is two and a half times it."
          >
            <Input
              name="credit_percent"
              type="number"
              min={1}
              max={10000}
              step="any"
              defaultValue={100}
            />
          </Field>

          <Checkbox
            name="is_active"
            label="Offered to customers"
            hint="Off keeps the pack but hides it on the buy page."
            defaultChecked
          />
        </div>
        <FormActions>
          <SubmitButton pendingLabel="Adding...">Add pack</SubmitButton>
        </FormActions>
      </ActionForm>
    </Modal>
  );
}

/**
 * A numbered band around one half of the flow. The two editors do different
 * things to different numbers, and putting them in plain panels side by side is
 * how an admin ends up editing the rate when they meant the price.
 */
function FlowSection({
  step,
  title,
  description,
  action,
  children,
}: {
  step: string;
  title: string;
  description: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-strong">
            <span className="inline-flex size-5 items-center justify-center rounded-full border border-brand-500/40 bg-brand-500/12 text-[11px] font-semibold text-brand-400">
              {step}
            </span>
            {title}
          </h2>
          <p className="mt-1 max-w-2xl text-xs text-muted">{description}</p>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
