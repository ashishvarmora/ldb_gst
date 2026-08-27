import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  KeyRound,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  Sheet,
  Trash2,
  Truck,
} from "lucide-react";

import { OverridesPanel } from "./OverridesPanel";
import { OfficerFields } from "../OfficerFields";
import {
  assignPlan,
  deleteOfficer,
  resetOfficerPassword,
  resetOfficerUsage,
  saveOfficerIntegrations,
  setOfficerStatus,
  updateOfficer,
} from "../actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { Checkbox, Field, FormActions, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
import { UsageChart, buildUsageSeries } from "@/components/UsageChart";
import {
  Avatar,
  Badge,
  DescRow,
  EmptyState,
  Mono,
  PageHeader,
  Panel,
  QuotaBar,
  StatCard,
  TableWrap,
  Tbody,
  Thead,
  Tr,
} from "@/components/ui";
import { requireSuperAdmin } from "@/lib/auth";
import { fmtDateTime, fmtRelative, initials } from "@/lib/format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  AlertLog,
  LimitOverrides,
  OfficerOverview,
  Plan,
  Profile,
  SearchLog,
  TrackedTruck,
  UsageCounter,
} from "@/lib/types";

const TRUCK_STATUS_TONE = {
  moving: "good",
  idle: "warn",
  no_activity: "bad",
  unknown: "neutral",
} as const;

const TRUCK_STATUS_LABEL = {
  moving: "Moving",
  idle: "Idle",
  no_activity: "No activity",
  unknown: "Unknown",
} as const;

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await getSupabaseAdmin()
    .from("profiles")
    .select("full_name, email")
    .eq("id", id)
    .maybeSingle();
  return { title: `${data?.full_name ?? data?.email ?? "Officer"} — Admin` };
}

export default async function OfficerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSuperAdmin();
  const { id } = await params;
  const admin = getSupabaseAdmin();

  const { data: overview } = await admin
    .from("officer_overview")
    .select("*")
    .eq("id", id)
    .maybeSingle<OfficerOverview>();

  if (!overview) notFound();

  const since = new Date(Date.now() - 29 * 86_400_000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  });

  const [
    { data: profile },
    { data: plans },
    { data: overrides },
    { data: trucks },
    { data: searches },
    { data: alerts },
    { data: usage },
    { data: telegram },
    { data: sheet },
  ] = await Promise.all([
    admin.from("profiles").select("*").eq("id", id).maybeSingle<Profile>(),
    admin.from("plans").select("*").order("sort_order"),
    admin.from("user_limit_overrides").select("*").eq("user_id", id).maybeSingle<LimitOverrides>(),
    admin
      .from("tracked_trucks")
      .select("*")
      .eq("user_id", id)
      .order("last_event_at", { ascending: false, nullsFirst: false })
      .limit(50),
    admin
      .from("search_logs")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    admin
      .from("alert_logs")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(10),
    admin.from("usage_counters").select("*").eq("user_id", id).gte("usage_date", since),
    admin.from("telegram_configs").select("*").eq("user_id", id).maybeSingle(),
    admin.from("google_sheet_configs").select("*").eq("user_id", id).maybeSingle(),
  ]);

  const planList = (plans ?? []) as Plan[];
  const currentPlan = planList.find((p) => p.id === overview.plan_id) ?? null;
  const truckList = (trucks ?? []) as TrackedTruck[];
  const searchList = (searches ?? []) as SearchLog[];
  const alertList = (alerts ?? []) as AlertLog[];
  const series = buildUsageSeries((usage ?? []) as UsageCounter[], 30);
  const suspended = overview.status === "suspended";
  const expired =
    overview.plan_expires_on !== null && new Date(overview.plan_expires_on) < new Date();

  return (
    <>
      <Link
        href="/admin/officers"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-brand-400"
      >
        <ArrowLeft size={13} />
        All officers
      </Link>

      <PageHeader
        title={overview.full_name ?? overview.email}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{overview.email}</span>
            {overview.designation ? <span className="text-faint">· {overview.designation}</span> : null}
            {overview.office ? <span className="text-faint">· {overview.office}</span> : null}
          </span>
        }
        actions={
          <>
            <Avatar text={initials(overview.full_name, overview.email)} />

            <InlineActionForm
              action={setOfficerStatus}
              hidden={{ user_id: id, status: suspended ? "active" : "suspended" }}
            >
              <ConfirmSubmitButton
                variant={suspended ? "secondary" : "danger"}
                message={
                  suspended
                    ? "Reactivate this account?"
                    : "Suspend this account? The officer is signed out of searching and all background tracking pauses."
                }
              >
                {suspended ? <PlayCircle size={13} /> : <PauseCircle size={13} />}
                {suspended ? "Reactivate" : "Suspend"}
              </ConfirmSubmitButton>
            </InlineActionForm>

            <Modal
              triggerLabel="Reset password"
              triggerIcon={<KeyRound size={13} />}
              triggerVariant="secondary"
              triggerSize="sm"
              title="Reset password"
              description="The officer is not emailed. Pass the new password on yourself."
              width="sm"
            >
              <ActionForm action={resetOfficerPassword} closeOnSuccess={false}>
                <input type="hidden" name="user_id" value={id} />
                <Field
                  label="New password"
                  name="new_password"
                  hint="Leave blank to generate a strong one."
                >
                  <Input name="new_password" type="text" minLength={8} placeholder="auto-generate" />
                </Field>
                <FormActions>
                  <SubmitButton>Set password</SubmitButton>
                </FormActions>
              </ActionForm>
            </Modal>
          </>
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge tone={suspended ? "bad" : "good"}>{suspended ? "Suspended" : "Active"}</Badge>
        {overview.plan_name ? (
          <Badge tone="brand">{overview.plan_name}</Badge>
        ) : (
          <Badge tone="bad">No plan</Badge>
        )}
        {overview.has_overrides ? <Badge tone="warn">Custom limits</Badge> : null}
        {expired ? <Badge tone="bad">Plan expired {overview.plan_expires_on}</Badge> : null}
        <Badge tone={overview.telegram_connected ? "good" : "neutral"}>
          <MessageCircle size={11} />
          {overview.telegram_connected ? "Telegram linked" : "No Telegram"}
        </Badge>
        <Badge tone={overview.sheet_connected ? "good" : "neutral"}>
          <Sheet size={11} />
          {overview.sheet_connected ? "Sheet linked" : "No sheet"}
        </Badge>
        <span className="text-xs text-faint">Added {fmtDateTime(overview.created_at)}</span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Tracked trucks"
          value={overview.active_trucks}
          sub={<QuotaBar used={overview.active_trucks} limit={overview.truck_limit} />}
          icon={<Truck size={15} />}
        />
        <StatCard
          label="Searches today"
          value={overview.manual_searches_today}
          sub={
            <QuotaBar
              used={overview.manual_searches_today}
              limit={overview.manual_search_limit_per_day}
            />
          }
        />
        <StatCard
          label="Queries this month"
          value={overview.tracking_queries_month}
          sub={
            <QuotaBar
              used={overview.tracking_queries_month}
              limit={overview.tracking_queries_per_month}
            />
          }
        />
        <StatCard
          label="Alerts today"
          value={overview.alerts_today}
          sub={`Last event ${fmtRelative(overview.last_event_at)}`}
          icon={<Bell size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <OverridesPanel officer={overview} plan={currentPlan} overrides={overrides ?? null} />

          <Panel title="Usage, last 30 days" description="Manual searches and background tracking calls per day.">
            <UsageChart series={series} />
            <div className="mt-4 flex flex-wrap gap-2 border-t border-divider pt-4">
              <InlineActionForm action={resetOfficerUsage} hidden={{ user_id: id, scope: "today" }}>
                <ConfirmSubmitButton
                  variant="secondary"
                  message="Reset today's counters to zero for this officer?"
                >
                  Reset today
                </ConfirmSubmitButton>
              </InlineActionForm>
              <InlineActionForm action={resetOfficerUsage} hidden={{ user_id: id, scope: "month" }}>
                <ConfirmSubmitButton
                  variant="secondary"
                  message="Reset every counter for this month to zero?"
                >
                  Reset this month
                </ConfirmSubmitButton>
              </InlineActionForm>
              <p className="ml-auto max-w-xs text-right text-xs text-faint">
                Resetting counters grants quota back immediately. It does not delete the LDB call
                history.
              </p>
            </div>
          </Panel>

          <Panel
            title={`Tracked trucks (${truckList.length})`}
            description="Read-only here. The officer adds and removes trucks from their own dashboard."
            bodyClassName="p-0"
          >
            {truckList.length === 0 ? (
              <EmptyState title="No trucks under tracking" />
            ) : (
              <TableWrap>
                <Thead>
                  <th className="th">Truck</th>
                  <th className="th">Interval</th>
                  <th className="th">Last toll</th>
                  <th className="th">Last seen</th>
                  <th className="th">Status</th>
                </Thead>
                <Tbody>
                  {truckList.map((truck) => (
                    <Tr key={truck.id}>
                      <td className="td">
                        <span className="flex items-center gap-2">
                          <Mono className="font-semibold text-ink">{truck.truck_number}</Mono>
                          {truck.is_watchlist ? <Badge tone="warn">watchlist</Badge> : null}
                          {truck.is_active ? null : <Badge>paused</Badge>}
                        </span>
                        {truck.label ? (
                          <span className="block text-xs text-faint">{truck.label}</span>
                        ) : null}
                      </td>
                      <td className="td text-sm tabular-nums">{truck.polling_interval_minutes} min</td>
                      <td className="td text-sm">{truck.last_location ?? "--"}</td>
                      <td className="td text-xs whitespace-nowrap text-muted">
                        {fmtRelative(truck.last_event_at)}
                      </td>
                      <td className="td">
                        <Badge tone={TRUCK_STATUS_TONE[truck.status]}>
                          {TRUCK_STATUS_LABEL[truck.status]}
                        </Badge>
                      </td>
                    </Tr>
                  ))}
                </Tbody>
              </TableWrap>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel title="Last 10 LDB calls" bodyClassName="p-0">
              {searchList.length === 0 ? (
                <EmptyState title="No calls yet" />
              ) : (
                <ul className="divide-y divide-divider">
                  {searchList.map((log) => (
                    <li key={log.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <span className="min-w-0">
                        <Mono className="text-ink">{log.truck_number}</Mono>
                        <span className="block text-xs text-faint">
                          {fmtDateTime(log.created_at)}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <Badge tone={log.source === "manual" ? "brand" : "neutral"}>
                          {log.source}
                        </Badge>
                        <Badge tone={log.ok ? "good" : "bad"}>
                          {log.ok ? `${log.new_events} new` : (log.error ?? "failed").slice(0, 24)}
                        </Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Last 10 alerts" bodyClassName="p-0">
              {alertList.length === 0 ? (
                <EmptyState title="No alerts yet" />
              ) : (
                <ul className="divide-y divide-divider">
                  {alertList.map((log) => (
                    <li key={log.id} className="px-5 py-2.5">
                      <span className="flex items-center justify-between gap-3">
                        <span className="truncate text-sm text-ink">{log.title}</span>
                        <Badge tone={log.delivered ? "good" : "warn"}>
                          {log.delivered ? "sent" : "not sent"}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block text-xs text-faint">
                        {log.truck_number ? `${log.truck_number} · ` : ""}
                        {fmtDateTime(log.created_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>

        <div className="space-y-5">
          <Panel title="Plan" description="Changing the plan takes effect on the next search.">
            <ActionForm action={assignPlan} closeOnSuccess={false}>
              <input type="hidden" name="user_id" value={id} />
              <div className="space-y-4">
                <Field label="Assigned plan" name="plan_id">
                  <Select name="plan_id" defaultValue={overview.plan_id ?? ""}>
                    <option value="">No plan — searches refused</option>
                    {planList.map((plan) => (
                      <option key={plan.id} value={plan.id}>
                        {plan.name}
                        {plan.is_active ? "" : " (archived)"}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field
                  label="Expires on"
                  name="plan_expires_on"
                  hint="Blank means no expiry. Past dates block every search."
                >
                  <Input
                    name="plan_expires_on"
                    type="date"
                    defaultValue={overview.plan_expires_on ?? ""}
                  />
                </Field>
              </div>
              <FormActions>
                <SubmitButton>Save plan</SubmitButton>
              </FormActions>
            </ActionForm>

            {currentPlan ? (
              <dl className="mt-4 border-t border-divider pt-3">
                <DescRow label="Assigned">{fmtDateTime(overview.plan_assigned_at)}</DescRow>
                <DescRow label="Charge">
                  {currentPlan.price_per_month > 0 ? `Rs ${currentPlan.price_per_month}/mo` : "None"}
                </DescRow>
              </dl>
            ) : null}
          </Panel>

          <Panel
            title="Integrations"
            description="You can fill these in for the officer, or let them do it from their dashboard."
          >
            <ActionForm action={saveOfficerIntegrations} closeOnSuccess={false}>
              <input type="hidden" name="user_id" value={id} />
              <div className="space-y-4">
                <Field
                  label="Telegram chat id"
                  name="telegram_chat_id"
                  hint="The officer sends /start to your bot; the bot replies with this number."
                >
                  <Input
                    name="telegram_chat_id"
                    defaultValue={telegram?.chat_id ?? ""}
                    placeholder="123456789"
                  />
                </Field>

                <Field
                  label="Own bot token"
                  name="telegram_bot_token"
                  hint="Leave blank to use the platform bot. Only set this if the officer insists on their own."
                >
                  <Input
                    name="telegram_bot_token"
                    defaultValue={telegram?.bot_token ?? ""}
                    placeholder="platform bot"
                  />
                </Field>

                <Checkbox
                  name="telegram_is_enabled"
                  label="Send Telegram alerts"
                  defaultChecked={telegram?.is_enabled ?? true}
                  disabled={!overview.telegram_enabled}
                  hint={
                    overview.telegram_enabled
                      ? undefined
                      : "Blocked by the plan. Enable Telegram in the limits above first."
                  }
                />

                <Field
                  label="Google Sheet URL"
                  name="sheet_url"
                  hint="Share the sheet with your service account as Editor, then paste the link."
                >
                  <Input
                    name="sheet_url"
                    defaultValue={sheet?.sheet_url ?? ""}
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                  />
                </Field>

                <Checkbox
                  name="sheet_is_enabled"
                  label="Mirror events into the sheet"
                  defaultChecked={sheet?.is_enabled ?? true}
                  disabled={!overview.google_sheet_enabled}
                  hint={
                    overview.google_sheet_enabled
                      ? undefined
                      : "Blocked by the plan. Enable Google Sheet sync in the limits above first."
                  }
                />
              </div>
              <FormActions>
                <SubmitButton>Save integrations</SubmitButton>
              </FormActions>
            </ActionForm>

            <dl className="mt-4 border-t border-divider pt-3">
              <DescRow label="Sheet id">
                {sheet?.spreadsheet_id ? <Mono>{sheet.spreadsheet_id.slice(0, 18)}…</Mono> : "--"}
              </DescRow>
              <DescRow label="Last sync">{fmtRelative(sheet?.last_synced_at)}</DescRow>
              {sheet?.last_error ? (
                <DescRow label="Sheet error">
                  <span className="text-bad-500">{sheet.last_error}</span>
                </DescRow>
              ) : null}
              {telegram?.last_error ? (
                <DescRow label="Telegram error">
                  <span className="text-bad-500">{telegram.last_error}</span>
                </DescRow>
              ) : null}
            </dl>
          </Panel>

          <Panel title="Officer details">
            <ActionForm action={updateOfficer} closeOnSuccess={false}>
              <input type="hidden" name="user_id" value={id} />
              <OfficerFields mode="edit" officer={profile ?? undefined} />
              <FormActions>
                <SubmitButton>Save details</SubmitButton>
              </FormActions>
            </ActionForm>
          </Panel>

          <Panel title="Danger zone" className="border-bad-500/30">
            <p className="text-xs leading-relaxed text-muted">
              Deleting removes the login, every tracked truck, all toll events, search history and
              alerts for this officer. There is no undo.
            </p>
            <div className="mt-3">
              <Modal
                triggerLabel="Delete officer"
                triggerIcon={<Trash2 size={13} />}
                triggerVariant="danger"
                triggerSize="sm"
                title="Delete this officer"
                description="Everything belonging to this account is removed."
                width="sm"
              >
                <ActionForm action={deleteOfficer} closeOnSuccess={false}>
                  <input type="hidden" name="user_id" value={id} />
                  <Field
                    label="Type the email to confirm"
                    name="confirm_email"
                    hint={overview.email}
                  >
                    <Input name="confirm_email" autoComplete="off" placeholder={overview.email} />
                  </Field>
                  <FormActions>
                    <SubmitButton variant="danger" pendingLabel="Deleting...">
                      Delete permanently
                    </SubmitButton>
                  </FormActions>
                </ActionForm>
              </Modal>
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
