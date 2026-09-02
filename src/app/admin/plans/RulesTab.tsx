import Link from "next/link";
import type { ReactNode } from "react";
import { Plus, Settings } from "lucide-react";

import { PackLadder } from "../credits/PackLadder";
import { RateEditor } from "../credits/RateEditor";
import { createCreditPack, saveCreditsPerRupee } from "../credits/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { Checkbox, Field, FormActions, FormGrid, Input } from "@/components/form";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { Badge, EmptyState, LinkButton, Panel } from "@/components/ui";
import { formatCredits, loadCreditPacks, loadCreditRates } from "@/lib/credits";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The rules, and nothing that has already happened.
 *
 * Two conversions in one place, because neither can be judged alone: money
 * becomes credits at the ladder below, credits become work at the rates under
 * it. What was actually bought and spent lives in the History tab, so a price
 * can be changed without scrolling past a year of receipts.
 *
 * This screen used to open with three panels of explanation - a two-line
 * summary of the whole model, a Step 1 / Step 2 diagram with a paragraph in
 * each, a description under every section heading - so the first editable
 * control was several screens down on a phone. None of it was wrong and none of
 * it was needed twice. It is all still here, behind the (i) beside each heading
 * and inside the folded panel below the ladder, one hover or one tap away. The
 * page itself now shows the current prices and the boxes that change them.
 *
 * The order is also a claim about the model, and the old order made the wrong
 * one. "The base rate" sat first, under its own heading, which read as though
 * Rs 1 = 1 credit were the rule the product runs on. It is not: a fixed pack
 * states its own credits and credits_for_amount() returns them without ever
 * looking at the rate. The ladder is what money buys, so the ladder comes
 * first, and the rate is a field below it that says whether anything is
 * currently using it.
 */
export async function RulesTab() {
  const admin = getSupabaseAdmin();

  const [rates, packs, settings] = await Promise.all([
    loadCreditRates(admin),
    // Hidden packs included: this is the page where they are un-hidden.
    loadCreditPacks(admin, false),
    loadSettings(admin),
  ]);

  /*
   * The only packs the base rate reaches. credits_for_amount() reads the rate
   * inside its open-ended branch alone, and looks up the pack with
   * `where id = p_pack and is_active` - so an open tier that is switched off is
   * not using the rate either, and with none on sale the field below changes
   * nothing a customer can buy. Worth saying outright rather than leaving an
   * admin to wonder why editing it moves no price on screen.
   */
  const openTiers = packs.filter((pack) => pack.is_active && pack.is_open_ended);
  const rateInUse = openTiers.length > 0;
  const perRupee = formatCredits(settings.creditsPerRupee);
  const plural = settings.creditsPerRupee === 1 ? "" : "s";

  return (
    <>
      <div className="mb-4 flex justify-end">
        <LinkButton href="/admin/settings" variant="secondary">
          <Settings size={14} />
          Payment settings
        </LinkButton>
      </div>

      {/* A state, not an explanation, so it stays on screen: every price below
          is unbuyable while this is true, and that is not something to fold
          away behind an (i). */}
      {settings.razorpayEnabled ? null : (
        <p className="mb-4 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <span className="text-warn-500">Online payment is off.</span> These prices are still the
          list you charge against, but nothing can be bought in the app — credits arrive only when
          you add them on a customer&apos;s page. Turn it on in{" "}
          <Link href="/admin/settings" className="text-brand-400 hover:underline">
            settings
          </Link>
          .
        </p>
      )}

      <FlowSection
        step="1"
        title="Money → credits"
        action={<NewPackButton />}
        info={
          <>
            <p>
              A fixed pack is one sentence: this much money buys this many credits. It states its own
              credits and nothing else changes them — not the base rate, not a discount code.
            </p>
            <p>
              An open tier is a rule instead — a minimum, and a percentage of whatever the buyer
              types — so the ladder does not end in a wall. That is the only kind of pack the base
              rate below applies to.
            </p>
          </>
        }
      >
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

        <Disclosure
          className="mt-3"
          title="Base rate for open tiers"
          badge={rateInUse ? null : <Badge tone="neutral">not in use</Badge>}
          hint={
            rateInUse
              ? `Rs 1 = ${perRupee} credit${plural} at 100% · used by ${openTiers
                  .map((tier) => tier.name)
                  .join(", ")}`
              : `Rs 1 = ${perRupee} credit${plural} at 100% — but no open tier is on sale, so nothing uses it.`
          }
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

            <p className="mt-2 text-xs leading-relaxed text-muted">
              Rs 1 = {perRupee} credit{plural} at 100%, so Rs 1,000 would buy{" "}
              {formatCredits(1000 * settings.creditsPerRupee)} credits on a tier of 100%. Each open
              tier applies its own percentage on top of that, and the ladder above shows what each
              one comes to.
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              {rateInUse
                ? "Fixed packs are not affected: each states its own credits and never reads this."
                : "Nothing on sale reads this at the moment. Fixed packs state their own credits, and an open tier has to be switched on before the rate reaches a customer."}
            </p>
          </ActionForm>
        </Disclosure>
      </FlowSection>

      <FlowSection
        step="2"
        title="Credits → usage"
        info={
          <>
            <p>
              Each action has a rate you can write either way round — one credit buys so many
              searches, or so many credits buy one search — and the worked example under each shows
              what that comes to in a normal day.
            </p>
            <p>
              Nothing is capped: a customer works until the balance runs out. A change applies from
              the next call onwards and never reprices anything already charged.
            </p>
          </>
        }
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
 *
 * The paragraph that used to sit under each heading is now the `info` behind the
 * (i) on it. The number and the title are enough to orient somebody who has
 * been here before, which is almost everybody; the explanation is for the first
 * visit and for the one time a year somebody has to re-derive the model.
 */
function FlowSection({
  step,
  title,
  info,
  action,
  children,
}: {
  step: string;
  title: string;
  info: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        {/* min-w-0 flex-1 so the explanation opens to the full width of the
            row rather than to the width of the heading it hangs off. */}
        <InfoTip label={title} info={info} className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-strong">
            <span className="inline-flex size-5 items-center justify-center rounded-full border border-brand-500/40 bg-brand-500/12 text-[11px] font-semibold text-brand-400">
              {step}
            </span>
            {title}
          </h2>
        </InfoTip>
        {action}
      </div>
      {children}
    </section>
  );
}
