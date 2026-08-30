import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bell,
  Coins,
  KeyRound,
  MapPin,
  MessageCircle,
  PauseCircle,
  PlayCircle,
  Search as SearchIcon,
  Trash2,
  Truck,
  Wallet,
} from "lucide-react";

import { OverridesPanel } from "./OverridesPanel";
import { OfficerFields } from "../OfficerFields";
import {
  assignPlan,
  deleteOfficer,
  resetOfficerPassword,
  saveOfficerIntegrations,
  setOfficerStatus,
  updateOfficer,
} from "../actions";
import { GrantCreditsForm } from "../../credits/GrantCreditsForm";
import { loadDailyCalls } from "../../usage/ledger";
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
import { CREDIT_REASON_LABEL, formatCredits } from "@/lib/credits";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative, initials } from "@/lib/format";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  AlertLog,
  CreditTransaction,
  LimitOverrides,
  OfficerOverview,
  Plan,
  Profile,
  SearchLog,
  TelegramConfig,
  TruckDirectoryRow,
} from "@/lib/types";

/** Below this the officer is worth chasing before they stop mid-case. */
const LOW_CREDIT_BALANCE = 20;

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

  const [
    { data: profile },
    { data: plans },
    { data: overrides },
    { data: trucks },
    { data: searches },
    { data: alerts },
    dailyCalls,
    { data: telegram },
    { data: ledger },
    settings,
  ] = await Promise.all([
    admin.from("profiles").select("*").eq("id", id).maybeSingle<Profile>(),
    admin.from("plans").select("*").order("sort_order"),
    admin.from("user_limit_overrides").select("*").eq("user_id", id).maybeSingle<LimitOverrides>(),
    // truck_directory already carries the alert and event counts, so the truck
    // table below is one query rather than one per truck.
    admin
      .from("truck_directory")
      .select("*")
      .eq("officer_id", id)
      .order("last_event_at", { ascending: false, nullsFirst: false })
      .limit(200),
    admin
      .from("search_logs")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(12),
    admin
      .from("alert_logs")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(12),
    loadDailyCalls(admin, { days: 30, userId: id }),
    admin.from("telegram_configs").select("*").eq("user_id", id).maybeSingle<TelegramConfig>(),
    admin
      .from("credit_transactions")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    loadSettings(admin),
  ]);

  const planList = (plans ?? []) as Plan[];
  const currentPlan = planList.find((p) => p.id === overview.plan_id) ?? null;
  const truckList = (trucks ?? []) as TruckDirectoryRow[];
  const searchList = (searches ?? []) as SearchLog[];
  const alertList = (alerts ?? []) as AlertLog[];
  const movements = (ledger ?? []) as CreditTransaction[];
  const series = buildUsageSeries(dailyCalls, 30);
  const suspended = overview.status === "suspended";
  const expired =
    overview.plan_expires_on !== null && new Date(overview.plan_expires_on) < new Date();

  const balance = Number(overview.credits ?? 0);
  const balanceTone = balance <= 0 ? "bad" : balance < LOW_CREDIT_BALANCE ? "warn" : "good";
  const trucksNeverChecked = truckList.filter((truck) => truck.alert_count === 0).length;

  const posting = [overview.office, overview.district, overview.state].filter(Boolean).join(" · ");

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
            {posting ? <span className="text-faint">· {posting}</span> : null}
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
          <Badge tone={overview.plan_active ? "brand" : "warn"}>
            {overview.plan_name}
            {overview.plan_active ? "" : " — not live"}
          </Badge>
        ) : (
          <Badge tone="bad">No plan</Badge>
        )}
        {overview.has_overrides ? <Badge tone="warn">Custom limits</Badge> : null}
        {expired ? <Badge tone="bad">Plan expired {overview.plan_expires_on}</Badge> : null}
        <Badge tone={overview.telegram_connected ? "good" : "neutral"}>
          <MessageCircle size={11} />
          {overview.telegram_connected ? "Telegram linked" : "No Telegram"}
        </Badge>
        <span className="text-xs text-faint">
          Added {fmtDate(overview.created_at)} · last seen {fmtRelative(overview.last_active_at)}
        </span>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Credits left"
          value={formatCredits(balance)}
          sub={
            balance <= 0
              ? "Out of credits — every search is refused"
              : `${formatCredits(overview.credits_purchased)} bought in total`
          }
          tone={balance <= 0 ? "bad" : balance < LOW_CREDIT_BALANCE ? "warn" : "brand"}
          icon={<Wallet size={15} />}
        />
        <StatCard
          label="Credits spent"
          value={formatCredits(overview.credits_spent_month)}
          sub={`${formatCredits(overview.credits_spent_today)} today · this month so far`}
          icon={<Coins size={15} />}
        />
        <StatCard
          label="Tracked trucks"
          value={overview.active_trucks}
          sub={<QuotaBar used={overview.active_trucks} limit={overview.truck_limit} />}
          icon={<Truck size={15} />}
        />
        <StatCard
          label="Alerts today"
          value={overview.alerts_today}
          sub={`${overview.active_alerts} switched on · last event ${fmtRelative(overview.last_event_at)}`}
          icon={<Bell size={15} />}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Panel
            title="Contact and posting"
            description="Everything you hold about this officer. Edit it in Officer details on the right."
            bodyClassName="px-5 py-2"
          >
            <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <dl>
                <DescRow label="Name">{overview.full_name ?? "--"}</DescRow>
                <DescRow label="Email">
                  <a href={`mailto:${overview.email}`} className="hover:text-brand-500">
                    {overview.email}
                  </a>
                </DescRow>
                <DescRow label="Phone">
                  {overview.phone ? (
                    <a href={`tel:${overview.phone}`} className="hover:text-brand-500">
                      {overview.phone}
                    </a>
                  ) : (
                    "--"
                  )}
                </DescRow>
                <DescRow label="Designation">{overview.designation ?? "--"}</DescRow>
              </dl>
              <dl>
                <DescRow label="Office">{overview.office ?? "--"}</DescRow>
                <DescRow label="District">{overview.district ?? "--"}</DescRow>
                <DescRow label="State">{overview.state ?? "--"}</DescRow>
                <DescRow label="Account created">{fmtDate(overview.created_at)}</DescRow>
              </dl>
            </div>
            {overview.notes ? (
              <p className="mt-2 border-t border-divider pt-3 pb-2 text-sm whitespace-pre-line text-muted">
                <span className="mb-1 block text-xs tracking-wide text-faint uppercase">
                  Internal notes
                </span>
                {overview.notes}
              </p>
            ) : null}
          </Panel>

          <OverridesPanel officer={overview} plan={currentPlan} overrides={overrides ?? null} />

          <Panel
            title={`Trucks tracked (${truckList.length})`}
            description="Every truck this officer has under tracking. Read-only here — they add and remove trucks from their own dashboard."
            bodyClassName="p-0"
          >
            {truckList.length === 0 ? (
              <EmptyState title="No trucks under tracking" />
            ) : (
              <TableWrap>
                <Thead>
                  <th className="th">Truck</th>
                  <th className="th">Status</th>
                  <th className="th">Last toll plaza</th>
                  <th className="th">Last event</th>
                  <th className="th">Last checked</th>
                  <th className="th text-right">Alerts</th>
                  <th className="th text-right">Events</th>
                  <th className="th">Added</th>
                </Thead>
                <Tbody>
                  {truckList.map((truck) => (
                    <Tr key={truck.tracked_truck_id}>
                      <td className="td">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link
                            href={`/admin/explore?q=${truck.truck_number}`}
                            className="transition hover:text-brand-500"
                          >
                            <Mono className="font-semibold text-ink">{truck.truck_number}</Mono>
                          </Link>
                          {truck.is_active ? null : <Badge>paused</Badge>}
                        </span>
                        {truck.label ? (
                          <span className="block text-xs text-faint">{truck.label}</span>
                        ) : null}
                      </td>
                      <td className="td">
                        <Badge tone={TRUCK_STATUS_TONE[truck.status]}>
                          {TRUCK_STATUS_LABEL[truck.status]}
                        </Badge>
                      </td>
                      <td className="td">
                        {truck.last_location ? (
                          <span className="flex items-center gap-1.5 text-sm">
                            <MapPin size={13} className="shrink-0 text-faint" />
                            {truck.last_location}
                          </span>
                        ) : (
                          "--"
                        )}
                      </td>
                      <td className="td text-xs whitespace-nowrap text-muted">
                        {fmtDateTime(truck.last_event_at)}
                      </td>
                      <td className="td text-xs whitespace-nowrap text-muted">
                        {fmtRelative(truck.last_polled_at)}
                      </td>
                      <td className="td text-right">
                        {truck.alert_count === 0 ? (
                          <Badge tone="warn">never checked</Badge>
                        ) : (
                          <span className="text-sm tabular-nums text-ink">{truck.alert_count}</span>
                        )}
                      </td>
                      <td className="td text-right text-sm tabular-nums text-muted">
                        {fmtNumber(truck.event_count)}
                      </td>
                      <td className="td text-xs whitespace-nowrap text-muted">
                        {fmtDate(truck.created_at)}
                      </td>
                    </Tr>
                  ))}
                </Tbody>
              </TableWrap>
            )}
            {trucksNeverChecked > 0 ? (
              <p className="border-t border-divider px-5 py-3 text-xs text-muted">
                {trucksNeverChecked} truck{trucksNeverChecked === 1 ? " has" : "s have"} no alert
                switched on, so {trucksNeverChecked === 1 ? "it is" : "they are"} never checked.
              </p>
            ) : null}
          </Panel>

          <Panel
            title="Usage, last 30 days"
            description="Manual searches and background checks per day, counted from the credit ledger."
          >
            <UsageChart series={series} />
          </Panel>

          <Panel
            title="Credit history"
            description="Every movement on this officer's balance, newest first."
            bodyClassName="p-0"
          >
            {movements.length === 0 ? (
              <EmptyState
                title="No movements yet"
                description="Add credits on the right, or wait for their first search to be charged."
              />
            ) : (
              <TableWrap>
                <Thead>
                  <th className="th">When</th>
                  <th className="th">Reason</th>
                  <th className="th">Truck</th>
                  <th className="th text-right">Change</th>
                  <th className="th text-right">Balance after</th>
                </Thead>
                <Tbody>
                  {movements.map((row) => (
                    <Tr key={row.id}>
                      <td className="td text-xs whitespace-nowrap text-muted">
                        {fmtDateTime(row.created_at)}
                      </td>
                      <td className="td">
                        <span className="block text-sm text-ink">
                          {CREDIT_REASON_LABEL[row.reason] ?? row.reason}
                        </span>
                        {row.note ? (
                          <span className="block max-w-xs truncate text-xs text-faint">
                            {row.note}
                          </span>
                        ) : null}
                      </td>
                      <td className="td">
                        {row.truck_number ? <Mono>{row.truck_number}</Mono> : "--"}
                      </td>
                      <td
                        className={`td text-right text-sm font-medium tabular-nums ${
                          Number(row.delta) < 0 ? "text-muted" : "text-good-500"
                        }`}
                      >
                        {Number(row.delta) > 0 ? "+" : "-"}
                        {formatCredits(Math.abs(Number(row.delta)))}
                      </td>
                      <td className="td text-right text-sm tabular-nums text-ink">
                        {formatCredits(row.balance_after)}
                      </td>
                    </Tr>
                  ))}
                </Tbody>
              </TableWrap>
            )}
            {movements.length === 50 ? (
              <p className="border-t border-divider px-5 py-3 text-xs text-faint">
                Showing the 50 most recent movements.
              </p>
            ) : null}
          </Panel>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Panel
              title="Recent searches"
              description="Manual searches, and background checks that found something or failed."
              bodyClassName="p-0"
            >
              {searchList.length === 0 ? (
                <EmptyState title="No calls yet" />
              ) : (
                <ul className="divide-y divide-divider">
                  {searchList.map((log) => (
                    <li key={log.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                      <span className="min-w-0">
                        <Link
                          href={`/admin/explore?q=${log.truck_number}`}
                          className="transition hover:text-brand-500"
                        >
                          <Mono className="text-ink">{log.truck_number}</Mono>
                        </Link>
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

            <Panel
              title="Recent alerts"
              bodyClassName="p-0"
              actions={
                <Link
                  href={`/admin/alerts/log?officer=${id}`}
                  className="text-xs text-brand-400 hover:underline"
                >
                  Full log
                </Link>
              }
            >
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
          <Panel
            title="Credits"
            description="One balance pays for every search and every background check."
            actions={<Badge tone={balanceTone}>{formatCredits(balance)} left</Badge>}
          >
            <p className="mb-4 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums text-strong">
                {formatCredits(balance)}
              </span>
              <span className="text-sm text-muted">credits</span>
            </p>

            <GrantCreditsForm userId={id} />

            <dl className="mt-4 border-t border-divider pt-3">
              <DescRow label="Spent today">{formatCredits(overview.credits_spent_today)}</DescRow>
              <DescRow label="Spent this month">
                {formatCredits(overview.credits_spent_month)}
              </DescRow>
              <DescRow label="Searches this month">
                {fmtNumber(overview.manual_searches_month)} manual ·{" "}
                {fmtNumber(overview.tracking_queries_month)} automatic
              </DescRow>
              <DescRow label="Bought so far">
                {formatCredits(overview.credits_purchased)}
              </DescRow>
              <DescRow label="Plan includes">
                {overview.included_credits === null
                  ? "--"
                  : `${formatCredits(overview.included_credits)} on assignment`}
              </DescRow>
            </dl>

            <p className="mt-3 text-[11px] leading-relaxed text-faint">
              {settings.razorpayEnabled
                ? "Officers can also buy credits themselves, as long as their plan is live."
                : "Officers cannot buy credits themselves yet — switch on payments in Settings when you have Razorpay keys."}{" "}
              Rates for each action are set under Credits.
            </p>
          </Panel>

          <Panel
            title="Plan"
            description="Changing the plan takes effect on the next search."
            actions={
              <Badge tone={overview.plan_active ? "good" : "bad"}>
                {overview.plan_active ? "live" : "not live"}
              </Badge>
            }
          >
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
                <DescRow label="Truck limit">
                  {overview.truck_limit === -1 ? "Unlimited" : fmtNumber(overview.truck_limit)}
                </DescRow>
              </dl>
            ) : null}
          </Panel>

          <Panel
            title="Telegram"
            description="Where this officer's alerts are delivered. You can fill it in for them, or let them do it from their dashboard."
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
                />
              </div>
              <FormActions>
                <SubmitButton>Save Telegram</SubmitButton>
              </FormActions>
            </ActionForm>

            <dl className="mt-4 border-t border-divider pt-3">
              <DescRow label="Verified">{fmtRelative(telegram?.verified_at)}</DescRow>
              {telegram?.last_error ? (
                <DescRow label="Last error">
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

          <Panel title="Elsewhere in the console" bodyClassName="p-0">
            <ul className="divide-y divide-divider text-sm">
              <li>
                <Link
                  href={`/admin/trucks?officer=${id}`}
                  className="flex items-center gap-2.5 px-5 py-3 text-ink transition hover:bg-raised/60"
                >
                  <Truck size={14} className="text-faint" />
                  This officer&apos;s trucks in the fleet view
                </Link>
              </li>
              <li>
                <Link
                  href={`/admin/explore?q=${encodeURIComponent(overview.email)}`}
                  className="flex items-center gap-2.5 px-5 py-3 text-ink transition hover:bg-raised/60"
                >
                  <SearchIcon size={14} className="text-faint" />
                  Cross-reference their trucks with other officers
                </Link>
              </li>
              <li>
                <Link
                  href={`/admin/alerts/log?officer=${id}`}
                  className="flex items-center gap-2.5 px-5 py-3 text-ink transition hover:bg-raised/60"
                >
                  <Bell size={14} className="text-faint" />
                  Every alert sent to this officer
                </Link>
              </li>
            </ul>
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
