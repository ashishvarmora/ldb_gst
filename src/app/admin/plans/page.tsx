import { Archive, Copy, Eye, Package, Pencil, Plus, RotateCcw, Trash2, Users } from "lucide-react";
import Link from "next/link";

import { PlanFields } from "./PlanFields";
import { PlanPreview } from "./PlanPreview";
import {
  createPlan,
  deletePlan,
  duplicatePlan,
  setPlanActive,
  updatePlan,
} from "./actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { FormActions } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Badge, EmptyState, PageHeader, Panel } from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { formatCredits } from "@/lib/credits";
import { fmtRupees } from "@/lib/format";
import { NUMERIC_LIMITS, formatLimit } from "@/lib/limits";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Plan } from "@/lib/types";

export const metadata = { title: "Plans — Admin" };

export default async function PlansPage() {
  await requireSuperAdmin();
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

  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="A plan is what a customer buys first. It sets the monthly price, the credits the account opens with, and how many trucks may be tracked automatically. Everything they then do is paid for out of the credit balance."
        actions={
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
        }
      />

      {list.length === 0 ? (
        <Panel>
          <EmptyState
            title="No plans yet"
            description="Nobody can sign up and start working until there is at least one plan to buy."
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
                    includedCredits={plan.included_credits}
                    truckLimit={plan.truck_limit}
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

function PlanCard({ plan, customers }: { plan: Plan; customers: number }) {
  return (
    <section className="panel flex flex-col overflow-hidden">
      <header className="flex items-start justify-between gap-3 border-b border-line/70 px-5 py-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Package size={15} className="shrink-0 text-brand-400" />
            <h2 className="truncate text-base font-semibold text-strong">{plan.name}</h2>
            {plan.is_active ? null : <Badge tone="warn">Archived</Badge>}
          </div>
          {plan.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-muted">{plan.description}</p>
          ) : null}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-semibold text-ink">
            {plan.price_per_month > 0 ? `${fmtRupees(plan.price_per_month)}/mo` : "Free"}
          </p>
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
