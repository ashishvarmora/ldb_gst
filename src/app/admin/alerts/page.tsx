import {
  ArrowDown,
  ArrowUp,
  Bell,
  BellOff,
  Eye,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
} from "lucide-react";

import { RuleFields } from "./RuleFields";
import {
  createAlertRule,
  deleteAlertRule,
  moveAlertRule,
  setAlertRuleActive,
  updateAlertRule,
} from "./actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { FormActions } from "@/components/form";
import { Modal } from "@/components/Modal";
import {
  Badge,
  EmptyState,
  LinkButton,
  PageHeader,
  Panel,
  StatCard,
  cx,
} from "@/components/ui";
import { ALERT_KIND_HINT, ALERT_KIND_LABEL } from "@/lib/alerts";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtNumber } from "@/lib/format";
import { intervalLabel } from "@/lib/intervals";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertRuleTemplate } from "@/lib/types";

export const metadata = { title: "Alert rules — Admin" };

export default async function AlertRulesPage() {
  await requireSuperAdmin();
  const admin = getSupabaseAdmin();

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  const [{ data: rules, error }, { data: attached }, { count: sent24h }] = await Promise.all([
    admin.from("alert_rule_templates").select("*").order("sort_order").order("name"),
    admin.from("truck_alerts").select("template_id, is_enabled").limit(5000),
    admin.from("alert_logs").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
  ]);

  const list = (rules ?? []) as AlertRuleTemplate[];

  // How many officer alerts sit on each rule. Deleting a rule takes them all
  // with it, so the number belongs next to the delete button.
  const usage = new Map<string, { total: number; enabled: number }>();
  for (const row of (attached ?? []) as { template_id: string; is_enabled: boolean }[]) {
    const entry = usage.get(row.template_id) ?? { total: 0, enabled: 0 };
    entry.total += 1;
    if (row.is_enabled) entry.enabled += 1;
    usage.set(row.template_id, entry);
  }

  const attachedTotal = (attached ?? []).length;
  const activeRules = list.filter((rule) => rule.is_active).length;

  return (
    <>
      <PageHeader
        title="Alert rules"
        subtitle="The catalogue officers choose from. They attach a rule to a truck and set its interval — they never write a rule themselves."
        actions={
          <>
            <LinkButton href="/admin/alerts/log" variant="secondary">
              <ScrollText size={14} />
              Delivery log
            </LinkButton>
            <Modal
              triggerLabel="New rule"
              triggerIcon={<Plus size={15} />}
              title="Add an alert rule"
              description="Officers see this in their truck's alert picker as soon as you save it."
              width="xl"
            >
              <ActionForm action={createAlertRule}>
                <RuleFields />
                <FormActions>
                  <SubmitButton pendingLabel="Adding...">Add rule</SubmitButton>
                </FormActions>
              </ActionForm>
            </Modal>
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Rules in catalogue"
          value={fmtNumber(list.length)}
          sub={`${activeRules} offered to officers`}
          icon={<Bell size={15} />}
        />
        <StatCard
          label="Officer alerts using them"
          value={fmtNumber(attachedTotal)}
          sub="Across every truck on the platform"
          tone="brand"
        />
        <StatCard
          label="Alerts sent (24h)"
          value={fmtNumber(sent24h ?? 0)}
          sub="What actually went out"
        />
        <StatCard
          label="Kinds available"
          value={Object.keys(ALERT_KIND_LABEL).length}
          sub="What the worker knows how to evaluate"
        />
      </div>

      {error ? (
        <Panel className="mb-5 border-bad-500/40">
          <p className="text-sm text-bad-500">
            Could not read <code className="font-mono">alert_rule_templates</code>: {error.message}
          </p>
          <p className="mt-2 text-xs text-muted">
            Run <code className="font-mono">0008_credits_and_alert_rules.sql</code> against your
            Supabase project, then reload.
          </p>
        </Panel>
      ) : null}

      {list.length === 0 ? (
        <Panel>
          <EmptyState
            title="No rules yet"
            description="Officers have nothing to attach until you add one. Start with a plain location update."
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {list.map((rule, index) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              usage={usage.get(rule.id) ?? { total: 0, enabled: 0 }}
              first={index === 0}
              last={index === list.length - 1}
            />
          ))}
        </div>
      )}

      <Panel
        className="mt-5"
        title="How the catalogue works"
        description="Worth knowing before you add a fast rule."
      >
        <ul className="space-y-2.5 text-xs leading-relaxed text-muted">
          <li>
            <span className="text-ink">One rule, many trucks.</span> An officer attaches the same
            rule to as many trucks as they like, and may attach it twice to one truck — two toll
            plazas watched on the same lorry, for instance.
          </li>
          <li>
            <span className="text-ink">A truck is only checked when an alert is due.</span> There is
            no separate polling schedule, so the fastest repeat you allow here is what decides how
            often the platform calls LDB — and how many credits the officer spends.
          </li>
          <li>
            <span className="text-ink">Deactivating is almost always the right move.</span> It hides
            the rule from the picker and leaves every alert already built on it running. Deleting
            removes those alerts too.
          </li>
        </ul>
      </Panel>
    </>
  );
}

function RuleCard({
  rule,
  usage,
  first,
  last,
}: {
  rule: AlertRuleTemplate;
  usage: { total: number; enabled: number };
  first: boolean;
  last: boolean;
}) {
  const kindLabel = ALERT_KIND_LABEL[rule.kind] ?? rule.kind;

  return (
    <section className={cx("panel overflow-hidden", rule.is_active ? "" : "opacity-75")}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {rule.is_active ? (
              <Bell size={15} className="shrink-0 text-brand-400" />
            ) : (
              <BellOff size={15} className="shrink-0 text-faint" />
            )}
            <h2 className="text-base font-semibold text-strong">{rule.name}</h2>
            <Badge tone="brand">{kindLabel}</Badge>
            {rule.is_active ? null : <Badge tone="warn">Not offered</Badge>}
          </div>
          <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-muted">
            {rule.description ?? ALERT_KIND_HINT[rule.kind] ?? "No description."}
          </p>
        </div>

        <dl className="flex shrink-0 flex-wrap gap-x-6 gap-y-1 text-right">
          <div>
            <dt className="text-[11px] tracking-wide text-muted uppercase">Fastest</dt>
            <dd className="text-sm tabular-nums text-ink">
              {intervalLabel(rule.min_interval_minutes)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-muted uppercase">Suggested</dt>
            <dd className="text-sm tabular-nums text-ink">
              {intervalLabel(rule.default_interval_minutes)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-wide text-muted uppercase">In use</dt>
            <dd className="text-sm tabular-nums text-ink">
              {usage.total === 0 ? (
                <span className="text-faint">none</span>
              ) : (
                `${fmtNumber(usage.enabled)} on / ${fmtNumber(usage.total)}`
              )}
            </dd>
          </div>
        </dl>
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-line/70 bg-raised/40 px-5 py-3">
        <Modal
          triggerLabel="Edit"
          triggerIcon={<Pencil size={13} />}
          triggerVariant="secondary"
          triggerSize="sm"
          title={`Edit ${rule.name}`}
          description={
            usage.total > 0
              ? `${usage.total} officer alert${usage.total === 1 ? "" : "s"} use this rule. Wording changes show up immediately; intervals they already chose are left alone.`
              : "No officer is using this rule yet."
          }
          width="xl"
        >
          <ActionForm action={updateAlertRule}>
            <input type="hidden" name="rule_id" value={rule.id} />
            <RuleFields rule={rule} />
            <FormActions>
              <SubmitButton>Save rule</SubmitButton>
            </FormActions>
          </ActionForm>
        </Modal>

        <InlineActionForm action={moveAlertRule} hidden={{ rule_id: rule.id, direction: "up" }}>
          <SubmitButton variant="ghost" size="sm" className={first ? "invisible" : undefined}>
            <ArrowUp size={13} />
            Up
          </SubmitButton>
        </InlineActionForm>

        <InlineActionForm action={moveAlertRule} hidden={{ rule_id: rule.id, direction: "down" }}>
          <SubmitButton variant="ghost" size="sm" className={last ? "invisible" : undefined}>
            <ArrowDown size={13} />
            Down
          </SubmitButton>
        </InlineActionForm>

        <InlineActionForm
          action={setAlertRuleActive}
          hidden={{ rule_id: rule.id, is_active: rule.is_active ? "false" : "true" }}
        >
          <SubmitButton variant="ghost" size="sm">
            {rule.is_active ? <BellOff size={13} /> : <Eye size={13} />}
            {rule.is_active ? "Stop offering" : "Offer again"}
          </SubmitButton>
        </InlineActionForm>

        <div className="ml-auto">
          <InlineActionForm action={deleteAlertRule} hidden={{ rule_id: rule.id }}>
            <ConfirmSubmitButton
              message={
                usage.total > 0
                  ? `Delete "${rule.name}"? This also deletes ${usage.total} officer alert${usage.total === 1 ? "" : "s"} built on it, and those officers are not told. Stop offering the rule instead if you only want to retire it.`
                  : `Delete "${rule.name}"? This cannot be undone.`
              }
            >
              <Trash2 size={13} />
              Delete
            </ConfirmSubmitButton>
          </InlineActionForm>
        </div>
      </footer>
    </section>
  );
}
