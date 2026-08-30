import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Trash2,
  Truck as TruckIcon,
} from "lucide-react";

import {
  checkTruckNow,
  deleteTruckAlert,
  removeTruck,
  setTruckAlertEnabled,
  setTruckPaused,
  updateTruck,
} from "../actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { Checkbox, Field, FormActions, Input } from "@/components/form";
import { LatestPosition, Timeline } from "@/components/Timeline";
import { TruckAlertForm } from "@/components/TruckAlertForm";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE, lastCheckedLabel } from "@/components/TruckCard";
import { Badge, DescRow, EmptyState, Mono, Panel, StatCard } from "@/components/ui";
import { intervalWords } from "@/lib/alerts";
import { CREDIT_ACTIONS, costOf, formatCredits, loadRate } from "@/lib/credits";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  AlertLog,
  AlertRuleTemplate,
  SearchLog,
  TrackedTruck,
  TruckAlertWithTemplate,
  TruckEvent,
} from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await getSupabaseAdmin()
    .from("tracked_trucks")
    .select("truck_number")
    .eq("id", id)
    .maybeSingle();
  return { title: `${data?.truck_number ?? "Truck"} — Truck Watch` };
}

export default async function TruckDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const { data: truck } = await admin
    .from("tracked_trucks")
    .select("*")
    .eq("id", id)
    .eq("user_id", overview.id)
    .maybeSingle<TrackedTruck>();

  if (!truck) notFound();

  const [
    { data: events },
    { data: alerts },
    { data: checks },
    { data: rules },
    { data: templates },
    { data: plazas },
    manualRate,
  ] = await Promise.all([
    admin
      .from("truck_events")
      .select("*")
      .eq("user_id", overview.id)
      .eq("truck_number", truck.truck_number)
      .order("event_time", { ascending: false, nullsFirst: false })
      .limit(120),
    admin
      .from("alert_logs")
      .select("*")
      .eq("user_id", overview.id)
      .eq("truck_number", truck.truck_number)
      .order("created_at", { ascending: false })
      .limit(15),
    admin
      .from("search_logs")
      .select("*")
      .eq("user_id", overview.id)
      .eq("truck_number", truck.truck_number)
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("truck_alerts")
      .select("*, template:alert_rule_templates(*)")
      .eq("user_id", overview.id)
      .eq("tracked_truck_id", truck.id)
      .order("created_at", { ascending: true }),
    admin
      .from("alert_rule_templates")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    admin.from("toll_plazas").select("name").order("name", { ascending: true }).limit(500),
    loadRate(admin, CREDIT_ACTIONS.manualSearch),
  ]);

  const eventList = (events ?? []) as TruckEvent[];
  const alertList = (alerts ?? []) as AlertLog[];
  const checkList = (checks ?? []) as SearchLog[];
  const ruleList = (rules ?? []) as TruckAlertWithTemplate[];
  const templateList = (templates ?? []) as AlertRuleTemplate[];
  const plazaNames = ((plazas ?? []) as { name: string }[]).map((row) => row.name);
  const latest = eventList[0] ?? null;

  const enabledRules = ruleList.filter((rule) => rule.is_enabled);
  const manualCost = costOf(manualRate);
  const status = truck.is_active ? truck.status : "unknown";
  const uniquePlazas = new Set(eventList.map((event) => event.loc_name).filter(Boolean)).size;

  return (
    <>
      <Link
        href="/portal/trucks"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-brand-400"
      >
        <ArrowLeft size={13} />
        All my trucks
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-9 items-center justify-center rounded-xl border border-line bg-raised text-muted">
              <TruckIcon size={17} />
            </span>
            <h1 className="font-mono text-2xl font-semibold tracking-wide text-strong">
              {truck.truck_number}
            </h1>
            <Badge tone={TRUCK_STATUS_TONE[status]}>{TRUCK_STATUS_LABEL[status]}</Badge>
            {truck.is_active ? null : <Badge>paused</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted">
            {truck.label ? `${truck.label} · ` : ""}
            {lastCheckedLabel(truck, ruleList)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={checkTruckNow} closeOnSuccess={false}>
            <input type="hidden" name="truck_id" value={truck.id} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Checking...">
              <RefreshCw size={13} />
              Check now · {formatCredits(manualCost)} credit{manualCost === 1 ? "" : "s"}
            </SubmitButton>
          </ActionForm>

          <InlineActionForm
            action={setTruckPaused}
            hidden={{ truck_id: truck.id, is_active: truck.is_active ? "false" : "true" }}
          >
            <SubmitButton variant="ghost" size="sm">
              {truck.is_active ? <PauseCircle size={13} /> : <PlayCircle size={13} />}
              {truck.is_active ? "Pause" : "Resume"}
            </SubmitButton>
          </InlineActionForm>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Crossings on record" value={eventList.length} />
        <StatCard label="Distinct plazas" value={uniquePlazas} />
        <StatCard
          label="Alerts switched on"
          value={enabledRules.length}
          tone={enabledRules.length > 0 ? "brand" : "neutral"}
        />
        <StatCard
          label="Alerts raised"
          value={alertList.length}
          tone={alertList.length > 0 ? "warn" : "neutral"}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title="Alerts on this truck"
            description="This truck is checked only when one of these is due, and each check costs credits."
          >
            {/* The list is shown even when the plan has alerts switched off,
                because an alert still brings the truck up for checking. */}
            {ruleList.length === 0 ? (
              <p className="text-xs leading-relaxed text-muted">
                No alerts yet, so nothing is being checked. Add one below.
              </p>
            ) : (
              <ul className="divide-y divide-divider overflow-hidden rounded-lg border border-line">
                {ruleList.map((rule) => (
                  <li
                    key={rule.id}
                    className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm text-ink">{rule.template.name}</p>
                        {rule.is_enabled ? null : <Badge>off</Badge>}
                        {rule.template.is_active ? null : (
                          <Badge tone="warn">withdrawn by admin</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        Every {intervalWords(rule.interval_minutes)}
                        {rule.plaza ? ` · ${rule.plaza}` : ""}
                        {rule.last_run_at ? ` · last run ${fmtRelative(rule.last_run_at)}` : ""}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <InlineActionForm
                        action={setTruckAlertEnabled}
                        hidden={{
                          alert_id: rule.id,
                          is_enabled: rule.is_enabled ? "false" : "true",
                        }}
                      >
                        <SubmitButton variant="ghost" size="sm">
                          {rule.is_enabled ? "Turn off" : "Turn on"}
                        </SubmitButton>
                      </InlineActionForm>

                      <InlineActionForm action={deleteTruckAlert} hidden={{ alert_id: rule.id }}>
                        <ConfirmSubmitButton
                          message={`Remove the "${rule.template.name}" alert from ${truck.truck_number}?`}
                          variant="ghost"
                        >
                          <Trash2 size={13} />
                          <span className="sr-only">Remove alert</span>
                        </ConfirmSubmitButton>
                      </InlineActionForm>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-5 border-t border-divider pt-4">
              {overview.alerts_enabled ? (
                <>
                  <p className="mb-3 text-[11px] font-semibold tracking-wider text-muted uppercase">
                    Add an alert
                  </p>
                  <TruckAlertForm
                    truckId={truck.id}
                    templates={templateList}
                    plazas={plazaNames}
                  />
                </>
              ) : (
                <div className="flex items-start gap-2.5 rounded-lg border border-warn-500/40 bg-warn-500/10 px-3 py-2.5">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn-500" />
                  <p className="text-xs leading-relaxed text-warn-500">
                    Alerts are not enabled on your plan. Ask your administrator to switch them on.
                  </p>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Route" description="Newest crossing first, grouped by day.">
            <Timeline events={eventList} />
          </Panel>
        </div>

        <div className="space-y-5">
          <LatestPosition event={latest} />

          <Panel title="Tracking settings">
            <ActionForm action={updateTruck} closeOnSuccess={false}>
              <input type="hidden" name="truck_id" value={truck.id} />
              <div className="space-y-4">
                <Field label="Label" name="label">
                  <Input
                    name="label"
                    defaultValue={truck.label ?? ""}
                    placeholder="Which case is this for?"
                  />
                </Field>

                <Checkbox
                  name="is_active"
                  label="Tracking active"
                  hint="Uncheck to pause every alert on this truck without losing its history."
                  defaultChecked={truck.is_active}
                />
              </div>
              <FormActions>
                <SubmitButton>Save</SubmitButton>
              </FormActions>
            </ActionForm>
          </Panel>

          <Panel title="Recent alerts" bodyClassName="p-0">
            {alertList.length === 0 ? (
              <EmptyState title="No alerts for this truck" />
            ) : (
              <ul className="divide-y divide-divider">
                {alertList.map((alert) => (
                  <li key={alert.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-ink">{alert.title}</p>
                      {alert.delivered ? null : <Badge tone="warn">not sent</Badge>}
                    </div>
                    {alert.message ? (
                      <p className="mt-0.5 text-xs text-muted">{alert.message}</p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-faint">
                      {fmtDateTime(alert.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Recent checks"
            description="Checks that found a movement, or failed. Quiet checks are not listed."
            bodyClassName="p-0"
          >
            {checkList.length === 0 ? (
              <EmptyState title="No checks yet" />
            ) : (
              <ul className="divide-y divide-divider">
                {checkList.map((check) => (
                  <li
                    key={check.id}
                    className="flex items-center justify-between gap-2 px-4 py-2"
                  >
                    <span className="text-xs text-muted">{fmtDateTime(check.created_at)}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={check.source === "manual" ? "brand" : "neutral"}>
                        {check.source}
                      </Badge>
                      {check.ok ? (
                        <span className="text-xs text-muted">
                          {check.new_events > 0 ? `${check.new_events} new` : "no change"}
                        </span>
                      ) : (
                        <Badge tone="bad">failed</Badge>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Remove this truck" className="border-bad-500/25">
            <p className="text-xs leading-relaxed text-muted">
              Frees a tracking slot and removes its alerts. The {eventList.length} toll crossing
              {eventList.length === 1 ? "" : "s"} on record are kept.
            </p>
            <ActionForm action={removeTruck} closeOnSuccess={false} className="mt-3">
              <input type="hidden" name="truck_id" value={truck.id} />
              <ConfirmSubmitButton
                message={`Remove ${truck.truck_number} from tracking?`}
                size="md"
              >
                <Trash2 size={13} />
                Remove truck
              </ConfirmSubmitButton>
            </ActionForm>
          </Panel>

          <Panel title="Details">
            <dl>
              <DescRow label="Added">{fmtDateTime(truck.created_at)}</DescRow>
              <DescRow label="Last checked">
                {truck.last_polled_at ? fmtRelative(truck.last_polled_at) : "not yet"}
              </DescRow>
              <DescRow label="Failed checks">
                {truck.consecutive_errors > 0 ? (
                  <span className="text-bad-500">{truck.consecutive_errors} in a row</span>
                ) : (
                  "none"
                )}
              </DescRow>
              <DescRow label="Truck number">
                <Mono>{truck.truck_number}</Mono>
              </DescRow>
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}
