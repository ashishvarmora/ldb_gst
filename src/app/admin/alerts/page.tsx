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
import { CapNote, pageWindow } from "../pager";
import { Pager } from "@/components/Pager";
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

/** The catalogue is short by nature, so a page of ten is already generous. */
const PAGE_SIZE = 10;

/** PostgREST caps one select at the project's max-rows, so usage is walked. */
const BATCH = 1000;
const MAX_BATCHES = 10;

type Admin = ReturnType<typeof getSupabaseAdmin>;
type Usage = { total: number; enabled: number };

/**
 * How many alerts sit on each of these rules. Deleting a rule takes them all
 * with it, so the number belongs next to the delete button - and it has to be
 * exact for that warning to mean anything.
 *
 * Scoped to the rules on screen, which keeps it a small read however long the
 * catalogue grows.
 */
async function loadUsage(
  admin: Admin,
  ids: string[],
): Promise<{ usage: Map<string, Usage>; capped: boolean }> {
  const usage = new Map<string, Usage>();
  if (ids.length === 0) return { usage, capped: false };

  let after = "";
  let capped = false;

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    let query = admin
      .from("truck_alerts")
      .select("id, template_id, is_enabled")
      .in("template_id", ids)
      .order("id", { ascending: true })
      .limit(BATCH);
    if (after) query = query.gt("id", after);

    const { data, error } = await query;
    if (error || !data || data.length === 0) break;

    const rows = data as { id: string; template_id: string; is_enabled: boolean }[];
    for (const row of rows) {
      const entry = usage.get(row.template_id) ?? { total: 0, enabled: 0 };
      entry.total += 1;
      if (row.is_enabled) entry.enabled += 1;
      usage.set(row.template_id, entry);
    }

    after = rows[rows.length - 1].id;
    if (rows.length < BATCH) break;
    capped = batch === MAX_BATCHES - 1;
  }

  return { usage, capped };
}

export default async function AlertRulesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  await requireSuperAdmin();
  const { page: pageParam } = await searchParams;
  const admin = getSupabaseAdmin();

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();

  // The catalogue is counted before a page of it is asked for. PostgREST
  // answers a range that starts past the last rule with an error and no count
  // at all, which would leave a stale ?page= showing an empty catalogue and no
  // link back to the rules that are there.
  const [{ count: ruleCount, error: countError }, { count: attachedTotal }, { count: activeRules }, { count: sent24h }] =
    await Promise.all([
      admin.from("alert_rule_templates").select("id", { count: "exact", head: true }),
      admin.from("truck_alerts").select("id", { count: "exact", head: true }),
      admin
        .from("alert_rule_templates")
        .select("id", { count: "exact", head: true })
        .eq("is_active", true),
      admin.from("alert_logs").select("id", { count: "exact", head: true }).gte("created_at", dayAgo),
    ]);

  const total = ruleCount ?? 0;
  const { page: requested, from, to } = pageWindow(pageParam, total, PAGE_SIZE);

  const { data: rules, error: rulesError } = await admin
    .from("alert_rule_templates")
    .select("*")
    .order("sort_order")
    .order("name")
    .range(from, to);

  const error = countError ?? rulesError;
  const list = (rules ?? []) as AlertRuleTemplate[];
  const { usage, capped } = await loadUsage(
    admin,
    list.map((rule) => rule.id),
  );

  return (
    <>
      <PageHeader
        title="Alert rules"
        subtitle="The catalogue people choose from. They attach a rule to a truck and set its interval — they never write a rule themselves."
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
              description="It appears in every truck's alert picker as soon as you save it."
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
          value={fmtNumber(total)}
          sub={`${fmtNumber(activeRules ?? 0)} offered to people`}
          icon={<Bell size={15} />}
        />
        <StatCard
          label="Alerts using them"
          value={fmtNumber(attachedTotal ?? 0)}
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
            title={total > 0 ? "That page is past the end of the catalogue" : "No rules yet"}
            description={
              total > 0
                ? "Use the page links below to get back."
                : "Nobody has anything to attach until you add one. Start with a plain location update."
            }
          />
        </Panel>
      ) : (
        <div className="space-y-3">
          {list.map((rule, index) => (
            <RuleCard
              key={rule.id}
              rule={rule}
              usage={usage.get(rule.id) ?? { total: 0, enabled: 0 }}
              // Position in the whole catalogue, not on this page: the first
              // rule of page two can still be nudged up into page one.
              first={from + index === 0}
              last={from + index === total - 1}
            />
          ))}
        </div>
      )}

      <Pager
        page={requested}
        pageSize={PAGE_SIZE}
        total={total}
        noun="rules"
        href={{ path: "/admin/alerts" }}
      />

      {capped ? (
        <CapNote>
          The “in use” counts stopped at {fmtNumber(BATCH * MAX_BATCHES)} alerts per page of rules,
          so they are a floor rather than an exact figure here.
        </CapNote>
      ) : null}

      <Panel
        className="mt-5"
        title="How the catalogue works"
        description="Worth knowing before you add a fast rule."
      >
        <ul className="space-y-2.5 text-xs leading-relaxed text-muted">
          <li>
            <span className="text-ink">One rule, many trucks.</span> The same rule can be attached to
            as many trucks as someone likes, and twice to one truck — two toll plazas watched on the
            same lorry, for instance.
          </li>
          <li>
            <span className="text-ink">A truck is only checked when an alert is due.</span> There is
            no separate polling schedule, so the fastest repeat you allow here is what decides how
            often the platform calls LDB — and how many credits the account spends.
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
  usage: Usage;
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

        {/* No shrink-0: it pinned the list at its widest, so its own flex-wrap
            could never engage and an interval that reads "1 hour 30 minutes"
            was clipped by the card's overflow-hidden on a narrow phone. */}
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-right">
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
              ? `${usage.total} alert${usage.total === 1 ? "" : "s"} use this rule. Wording changes show up immediately; intervals already chosen are left alone.`
              : "Nobody is using this rule yet."
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
                  ? `Delete "${rule.name}"? This also deletes ${usage.total} alert${usage.total === 1 ? "" : "s"} built on it, and nobody is told. Stop offering the rule instead if you only want to retire it.`
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
