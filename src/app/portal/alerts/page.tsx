import { AlertTriangle, Bell, BellOff, MessageCircle, Pencil, Plus, Sheet, Trash2 } from "lucide-react";

import { AlertRuleForm } from "./AlertRuleForm";
import { deleteAlertRule, toggleAlertRule } from "./actions";
import { ConfirmSubmitButton, InlineActionForm, SubmitButton } from "@/components/ActionForm";
import { Modal } from "@/components/Modal";
import {
  Badge,
  EmptyState,
  LinkButton,
  Mono,
  PageHeader,
  Panel,
  StatCard,
} from "@/components/ui";
import { ALERT_KIND_LABEL, describeRule } from "@/lib/alerts";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { formatLimit } from "@/lib/limits";
import { requirePortalSession } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertLog, AlertRule } from "@/lib/types";

export const metadata = { title: "Alerts — Truck Watch" };

export default async function AlertsPage() {
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: rules }, { data: logs }, { data: telegram }, settings] = await Promise.all([
    admin
      .from("alert_rules")
      .select("*")
      .eq("user_id", overview.id)
      .order("created_at", { ascending: false }),
    admin
      .from("alert_logs")
      .select("*")
      .eq("user_id", overview.id)
      .order("created_at", { ascending: false })
      .limit(60),
    admin.from("telegram_configs").select("chat_id, is_enabled").eq("user_id", overview.id).maybeSingle(),
    loadSettings(admin),
  ]);

  const ruleList = (rules ?? []) as AlertRule[];
  const alertList = (logs ?? []) as AlertLog[];
  const activeRules = ruleList.filter((rule) => rule.is_active).length;
  const undelivered = alertList.filter((alert) => !alert.delivered).length;

  const telegramReady = Boolean(telegram?.chat_id) && (telegram?.is_enabled ?? false);
  const canCreate =
    overview.alert_rules_enabled &&
    (overview.max_alert_rules === -1 || ruleList.length < overview.max_alert_rules);

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Rules apply to every truck you track. When one matches, you get a Telegram message within minutes."
        actions={
          canCreate ? (
            <Modal
              triggerLabel="New rule"
              triggerIcon={<Plus size={15} />}
              title="Create an alert rule"
              description="Pick a trigger and the rest of the form adapts to it."
              width="lg"
            >
              <AlertRuleForm mode="create" settings={settings} />
            </Modal>
          ) : null
        }
      />

      {!overview.alert_rules_enabled ? (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-warn-500" />
          <p className="text-sm text-warn-500">
            Alert rules are not enabled on your plan. Ask your administrator to switch them on.
          </p>
        </div>
      ) : !telegramReady ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <p className="flex items-start gap-2.5 text-sm text-warn-500">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            Telegram is not connected, so alerts will be recorded but not delivered.
          </p>
          <LinkButton href="/portal/settings" size="sm" variant="secondary">
            Connect Telegram
          </LinkButton>
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Active rules"
          value={activeRules}
          sub={`of ${formatLimit(overview.max_alert_rules)} allowed`}
          icon={<Bell size={15} />}
        />
        <StatCard label="Alerts today" value={overview.alerts_today} tone="brand" />
        <StatCard label="Alerts shown" value={alertList.length} sub="newest 60" />
        <StatCard
          label="Not delivered"
          value={undelivered}
          tone={undelivered > 0 ? "warn" : "neutral"}
          sub={undelivered > 0 ? "Usually a Telegram setup issue" : "All delivered"}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Panel
          title="My rules"
          description={
            overview.max_alert_rules === -1
              ? "Unlimited rules on your plan."
              : `${ruleList.length} of ${overview.max_alert_rules} used.`
          }
          bodyClassName="p-0"
        >
          {ruleList.length === 0 ? (
            <EmptyState
              title="No rules yet"
              description="Without a rule, crossings are still logged — you just are not messaged about them. Watchlist trucks are the quickest way to start."
            />
          ) : (
            <ul className="divide-y divide-ink-800">
              {ruleList.map((rule) => (
                <li key={rule.id} className="px-4 py-3.5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-ink-100">{rule.name}</p>
                        <Badge tone={rule.is_active ? "good" : "neutral"}>
                          {rule.is_active ? "on" : "off"}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-400">
                        {ALERT_KIND_LABEL[rule.kind]} · {describeRule(rule, settings)}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        {rule.notify_telegram ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-ink-500">
                            <MessageCircle size={10} />
                            Telegram
                          </span>
                        ) : null}
                        {rule.notify_sheet ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-ink-500">
                            <Sheet size={10} />
                            Sheet
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Modal
                        triggerLabel="Edit"
                        triggerIcon={<Pencil size={12} />}
                        triggerVariant="secondary"
                        triggerSize="sm"
                        title={`Edit ${rule.name}`}
                        width="lg"
                      >
                        <AlertRuleForm mode="edit" rule={rule} settings={settings} />
                      </Modal>

                      <InlineActionForm
                        action={toggleAlertRule}
                        hidden={{ rule_id: rule.id, is_active: rule.is_active ? "false" : "true" }}
                      >
                        <SubmitButton variant="ghost" size="sm">
                          {rule.is_active ? <BellOff size={12} /> : <Bell size={12} />}
                          {rule.is_active ? "Off" : "On"}
                        </SubmitButton>
                      </InlineActionForm>

                      <InlineActionForm action={deleteAlertRule} hidden={{ rule_id: rule.id }}>
                        <ConfirmSubmitButton message={`Delete the rule "${rule.name}"?`}>
                          <Trash2 size={12} />
                        </ConfirmSubmitButton>
                      </InlineActionForm>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Alert history"
          description="What actually fired, and whether it reached you."
          bodyClassName="p-0"
        >
          {alertList.length === 0 ? (
            <EmptyState
              title="Nothing has fired yet"
              description="Alerts appear here the moment a tracked truck matches one of your rules."
            />
          ) : (
            <ul className="divide-y divide-ink-800">
              {alertList.map((alert) => (
                <li key={alert.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-ink-100">{alert.title}</p>
                    {alert.delivered ? (
                      <Badge tone="good">sent</Badge>
                    ) : (
                      <Badge tone="warn">not sent</Badge>
                    )}
                  </div>
                  {alert.message ? (
                    <p className="mt-0.5 text-xs text-ink-400">{alert.message}</p>
                  ) : null}
                  <p className="mt-1 text-[11px] text-ink-500">
                    {alert.truck_number ? (
                      <>
                        <Mono>{alert.truck_number}</Mono> ·{" "}
                      </>
                    ) : null}
                    {fmtDateTime(alert.created_at)} · {fmtRelative(alert.created_at)}
                  </p>
                  {alert.delivery_error ? (
                    <p className="mt-1 text-[11px] text-bad-500">{alert.delivery_error}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
