import { Archive, Copy, Eye, Package, Pencil, Plus, RotateCcw, Trash2, Users } from "lucide-react";
import Link from "next/link";

import { PlanFields } from "./PlanFields";
import { PlanPreview } from "./PlanPreview";
import { createPlan, deletePlan, duplicatePlan, setPlanActive, updatePlan } from "./actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { FormActions } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Badge, EmptyState, Panel, cx } from "@/components/ui";
import { formatCredits, planChargeInr, planTermLabel, planTermSuffix } from "@/lib/credits";
import { fmtRupees } from "@/lib/format";
import { NUMERIC_LIMITS, formatLimit } from "@/lib/limits";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Plan } from "@/lib/types";

/**
 * The plan catalogue: what a customer buys first, and what it opens their
 * account with. Settings only - who is on which plan is a question for the
 * Accounts page, and what they paid is a question for the History tab.
 */
export async function PlansTab() {
  const admin = getSupabaseAdmin();

  const [{ data: plans }, { data: assignments }, settings] = await Promise.all([
    admin.from("plans").select("*").order("sort_order").order("name"),
    // "officer" is the role name the database has always used for a customer
    // account. It is a stored value, not wording, so it stays as it is.
    admin.from("profiles").select("plan_id").eq("role", "officer"),
    loadSettings(admin),
  ]);

  const counts = new Map<string, number>();
  for (const row of assignments ?? []) {
    if (row.plan_id) counts.set(row.plan_id, (counts.get(row.plan_id) ?? 0) + 1);
  }

  const list = (plans ?? []) as Plan[];
  const onSale = list.filter((plan) => plan.is_active);
  const trial = list.find((plan) => plan.is_trial) ?? null;
  const lifetime = onSale.filter((plan) => !plan.is_trial && plan.duration_months === null);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <NewPlanButton />
      </div>

      {/*
        Two states worth saying out loud on this screen, because both are
        invisible in a grid of cards and both cost money.

        A plan with no term is one payment for permanent access - fine for the
        owner's own account, a mistake to leave on a plan strangers can buy. And
        an archived trial means the portal has nothing to offer a new account
        except a bill, which is the state this whole section was in before the
        trial existed.
      */}
      {lifetime.length > 0 ? (
        <p className="mb-4 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <span className="text-warn-500">No end date on {lifetime.map((p) => p.name).join(", ")}.</span>{" "}
          One payment buys that plan for ever, and nothing will prompt a renewal. Set a term on it
          unless that is deliberate.
        </p>
      ) : null}

      {trial && !trial.is_active ? (
        <p className="mb-4 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5 text-xs leading-relaxed text-muted">
          <span className="text-warn-500">The free trial is archived.</span> A new account has
          nothing to try, so the plan page asks a stranger to pay before they have searched for
          anything. Reactivate it below to put it back.
        </p>
      ) : null}

      {list.length === 0 ? (
        <Panel>
          <EmptyState
            title="No plans yet"
            description="Nobody can sign up and start working until there is at least one plan to buy."
            action={<NewPlanButton />}
          />
        </Panel>
      ) : (
        <>
          <Panel
            className="mb-6"
            title={`The plan page on ${settings.brandName}`}
            description={
              onSale.length === 0
                ? "Every plan is archived, so the public plan page is empty and nobody can buy anything."
                : "Exactly what a visitor sees, in this order. Archived plans are left out."
            }
          >
            {onSale.length === 0 ? (
              <EmptyState
                title="Nothing is on sale"
                description="Reactivate a plan below to put it back on the public page."
              />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {onSale.map((plan) => (
                  <PlanPreview
                    key={plan.id}
                    name={plan.name}
                    description={plan.description}
                    pricePerMonth={plan.price_per_month}
                    durationMonths={plan.duration_months}
                    includedCredits={plan.included_credits}
                    truckLimit={plan.truck_limit}
                    isTrial={plan.is_trial}
                    trialDays={plan.trial_days}
                  />
                ))}
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {list.map((plan) => (
              <PlanCard key={plan.id} plan={plan} customers={counts.get(plan.id) ?? 0} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

function NewPlanButton() {
  return (
    <Modal
      triggerLabel="New plan"
      triggerIcon={<Plus size={15} />}
      title="Create a plan"
      description="Everything here can be changed later. The card on the right is what a customer will see."
      width="xl"
    >
      <ActionForm action={createPlan}>
        <PlanFields />
        <FormActions>
          <SubmitButton pendingLabel="Creating...">Create plan</SubmitButton>
        </FormActions>
      </ActionForm>
    </Modal>
  );
}

function PlanCard({ plan, customers }: { plan: Plan; customers: number }) {
  return (
    <section className="panel flex flex-col overflow-hidden">
      {/* Wraps, so the price and customer count drop below the name rather than
          squeezing it. A plan card is a single grid column on a phone - about
          290px - and without this the name was truncated to make room for a
          figure that has a whole line spare underneath it. */}
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Package size={15} className="shrink-0 text-brand-400" />
            <h2 className="truncate text-base font-semibold text-strong">{plan.name}</h2>
            {plan.is_trial ? <Badge tone="brand">Free trial</Badge> : null}
            {plan.is_active ? null : <Badge tone="warn">Archived</Badge>}
          </div>
          {plan.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted">{plan.description}</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          {/* What the customer is billed, not the unit price. A twelve-month
              plan at Rs 199 takes Rs 2,388, and "Rs 199/mo" beside it is the
              one number an admin would check and be reassured by. */}
          <p className="text-sm font-semibold text-ink">
            {plan.is_trial
              ? "Free"
              : planChargeInr(plan) > 0
                ? fmtRupees(planChargeInr(plan))
                : "Free"}
          </p>
          {!plan.is_trial && planChargeInr(plan) > 0 ? (
            <p className="text-[11px] text-muted">{planTermSuffix(plan)}</p>
          ) : null}
          <Link
            href={`/admin/officers?plan=${plan.id}`}
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted transition hover:text-brand-400"
          >
            <Users size={12} />
            {customers} customer{customers === 1 ? "" : "s"}
          </Link>
        </div>
      </header>

      <dl className="flex-1 divide-y divide-divider px-5 pt-1 pb-3">
        <div className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-xs text-muted">Lasts</dt>
          <dd
            className={cx(
              "text-sm font-medium tabular-nums",
              /* No expiry is not a neutral setting: it is one payment for
                 permanent access, and it should look different from a term. */
              !plan.is_trial && plan.duration_months === null ? "text-warn-500" : "text-ink",
            )}
          >
            {plan.is_trial
              ? `${plan.trial_days ?? 7} day${plan.trial_days === 1 ? "" : "s"}`
              : planTermLabel(plan)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 py-2">
          <dt className="text-xs text-muted">Credits included</dt>
          <dd className="text-sm font-medium tabular-nums text-brand-400">
            {formatCredits(plan.included_credits)}
          </dd>
        </div>
        {NUMERIC_LIMITS.map((field) => (
          <div key={field.key} className="flex items-baseline justify-between gap-4 py-2">
            <dt className="text-xs text-muted">{field.label}</dt>
            <dd className="text-sm font-medium tabular-nums text-ink">
              {formatLimit(plan[field.key])}
            </dd>
          </div>
        ))}
        <div className="flex items-center gap-1.5 py-2 text-[11px] text-faint">
          <Eye size={12} className="shrink-0" />
          {plan.is_active ? "Shown on the public plan page" : "Hidden from the public plan page"}
        </div>
      </dl>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line/70 bg-raised/40 px-5 py-3">
        <Modal
          triggerLabel="Edit"
          triggerIcon={<Pencil size={13} />}
          triggerVariant="secondary"
          triggerSize="sm"
          title={`Edit ${plan.name}`}
          description={
            customers > 0
              ? `${customers} customer${customers === 1 ? "" : "s"} pick up the new truck limit immediately, and the new price applies from their next renewal. Credits already handed out are not clawed back or topped up.`
              : "Nobody is on this plan yet, so nothing changes for anyone."
          }
          width="xl"
        >
          <ActionForm action={updatePlan}>
            <input type="hidden" name="plan_id" value={plan.id} />
            <PlanFields plan={plan} />
            <FormActions>
              <SubmitButton>Save plan</SubmitButton>
            </FormActions>
          </ActionForm>
        </Modal>

        <InlineActionForm action={duplicatePlan} hidden={{ plan_id: plan.id }}>
          <SubmitButton variant="ghost" size="sm">
            <Copy size={13} />
            Duplicate
          </SubmitButton>
        </InlineActionForm>

        <InlineActionForm
          action={setPlanActive}
          hidden={{ plan_id: plan.id, is_active: plan.is_active ? "false" : "true" }}
        >
          <SubmitButton variant="ghost" size="sm">
            {plan.is_active ? <Archive size={13} /> : <RotateCcw size={13} />}
            {plan.is_active ? "Archive" : "Reactivate"}
          </SubmitButton>
        </InlineActionForm>

        <div className="ml-auto">
          <InlineActionForm action={deletePlan} hidden={{ plan_id: plan.id }}>
            <ConfirmSubmitButton message={`Delete the plan "${plan.name}"? This cannot be undone.`}>
              <Trash2 size={13} />
              Delete
            </ConfirmSubmitButton>
          </InlineActionForm>
        </div>
      </footer>
    </section>
  );
}
