import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  Star,
  Trash2,
  Truck as TruckIcon,
} from "lucide-react";

import {
  checkTruckNow,
  removeTruck,
  setTruckPaused,
  toggleWatchlist,
  updateTruck,
} from "../actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { Checkbox, Field, FormActions, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
import { LatestPosition, Timeline } from "@/components/Timeline";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE } from "@/components/TruckCard";
import { Badge, DescRow, EmptyState, Mono, Panel, StatCard } from "@/components/ui";
import { fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { INTERVAL_CHOICES, intervalLabel, monthlyCallsAt } from "@/lib/intervals";
import { requirePortalSession } from "@/lib/officer";
import { loadSettings } from "@/lib/settings";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { AlertLog, SearchLog, TrackedTruck, TruckEvent } from "@/lib/types";

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

  const [{ data: events }, { data: alerts }, { data: checks }, settings] = await Promise.all([
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
    loadSettings(admin),
  ]);

  const eventList = (events ?? []) as TruckEvent[];
  const alertList = (alerts ?? []) as AlertLog[];
  const checkList = (checks ?? []) as SearchLog[];
  const latest = eventList[0] ?? null;

  const floor = Math.max(overview.min_polling_interval_minutes, settings.globalPollingFloor);
  const intervals = INTERVAL_CHOICES.filter((minutes) => minutes >= floor);
  const status = truck.is_active ? truck.status : "unknown";
  const uniquePlazas = new Set(eventList.map((event) => event.loc_name).filter(Boolean)).size;

  return (
    <>
      <Link
        href="/portal/trucks"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-ink-400 transition hover:text-brand-400"
      >
        <ArrowLeft size={13} />
        All my trucks
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-9 items-center justify-center rounded-xl border border-ink-700 bg-ink-850 text-ink-400">
              <TruckIcon size={17} />
            </span>
            <h1 className="font-mono text-2xl font-semibold tracking-wide text-white">
              {truck.truck_number}
            </h1>
            <Badge tone={TRUCK_STATUS_TONE[status]}>{TRUCK_STATUS_LABEL[status]}</Badge>
            {truck.is_watchlist ? (
              <Badge tone="warn">
                <Star size={9} />
                watchlist
              </Badge>
            ) : null}
            {truck.is_active ? null : <Badge>paused</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-ink-400">
            {truck.label ? `${truck.label} · ` : ""}
            {truck.is_active
              ? `Checked every ${truck.polling_interval_minutes} min · last check ${fmtRelative(truck.last_polled_at)}`
              : "Tracking is paused — no background checks and no quota used."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={checkTruckNow} closeOnSuccess={false}>
            <input type="hidden" name="truck_id" value={truck.id} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Checking...">
              <RefreshCw size={13} />
              Check now (1 credit)
            </SubmitButton>
          </ActionForm>

          <InlineActionForm
            action={toggleWatchlist}
            hidden={{ truck_id: truck.id, is_watchlist: truck.is_watchlist ? "false" : "true" }}
          >
            <SubmitButton variant="ghost" size="sm">
              <Star size={13} />
              {truck.is_watchlist ? "Remove from watchlist" : "Add to watchlist"}
            </SubmitButton>
          </InlineActionForm>

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
          label="Alerts raised"
          value={alertList.length}
          tone={alertList.length > 0 ? "warn" : "neutral"}
        />
        <StatCard
          label="Monthly cost"
          value={truck.is_active ? `~${fmtNumber(monthlyCallsAt(truck.polling_interval_minutes))}` : "0"}
          sub="background checks"
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="xl:col-span-2">
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

                <Field
                  label="Check every"
                  name="polling_interval_minutes"
                  hint={`Fastest allowed on your plan: ${floor} min.`}
                >
                  <Select
                    name="polling_interval_minutes"
                    defaultValue={String(truck.polling_interval_minutes)}
                  >
                    {intervals.map((minutes) => (
                      <option key={minutes} value={minutes}>
                        {intervalLabel(minutes)} · ~{fmtNumber(monthlyCallsAt(minutes))} checks/month
                      </option>
                    ))}
                    {intervals.includes(truck.polling_interval_minutes as never) ? null : (
                      <option value={truck.polling_interval_minutes}>
                        {intervalLabel(truck.polling_interval_minutes)} (current)
                      </option>
                    )}
                  </Select>
                </Field>

                <Checkbox
                  name="is_watchlist"
                  label="Watchlist truck"
                  hint="Alert on every crossing."
                  defaultChecked={truck.is_watchlist}
                />
                <Checkbox
                  name="is_active"
                  label="Tracking active"
                  hint="Uncheck to pause background checks without losing history."
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
              <ul className="divide-y divide-ink-800">
                {alertList.map((alert) => (
                  <li key={alert.id} className="px-4 py-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm text-ink-100">{alert.title}</p>
                      {alert.delivered ? null : <Badge tone="warn">not sent</Badge>}
                    </div>
                    {alert.message ? (
                      <p className="mt-0.5 text-xs text-ink-400">{alert.message}</p>
                    ) : null}
                    <p className="mt-0.5 text-[11px] text-ink-500">
                      {fmtDateTime(alert.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Recent checks" bodyClassName="p-0">
            {checkList.length === 0 ? (
              <EmptyState title="No checks yet" />
            ) : (
              <ul className="divide-y divide-ink-800">
                {checkList.map((check) => (
                  <li
                    key={check.id}
                    className="flex items-center justify-between gap-2 px-4 py-2"
                  >
                    <span className="text-xs text-ink-400">{fmtDateTime(check.created_at)}</span>
                    <span className="flex items-center gap-2">
                      <Badge tone={check.source === "manual" ? "brand" : "neutral"}>
                        {check.source}
                      </Badge>
                      {check.ok ? (
                        <span className="text-xs text-ink-300">
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
            <p className="text-xs leading-relaxed text-ink-400">
              Removing frees a tracking slot. You can keep the toll history for your records, or
              delete it along with the truck.
            </p>
            <div className="mt-3">
              <Modal
                triggerLabel="Remove truck"
                triggerIcon={<Trash2 size={13} />}
                triggerVariant="danger"
                triggerSize="sm"
                title={`Remove ${truck.truck_number}`}
                width="sm"
              >
                <ActionForm action={removeTruck} closeOnSuccess={false}>
                  <input type="hidden" name="truck_id" value={truck.id} />
                  <Checkbox
                    name="keep_history"
                    label="Keep the toll crossing history"
                    hint={`${eventList.length} crossings on record. Uncheck to delete them too.`}
                    defaultChecked
                  />
                  <FormActions>
                    <ConfirmSubmitButton
                      message={`Remove ${truck.truck_number} from tracking?`}
                      size="md"
                    >
                      Remove truck
                    </ConfirmSubmitButton>
                  </FormActions>
                </ActionForm>
              </Modal>
            </div>
          </Panel>

          <Panel title="Details">
            <dl>
              <DescRow label="Added">{fmtDateTime(truck.created_at)}</DescRow>
              <DescRow label="Last auto check">{fmtRelative(truck.last_polled_at)}</DescRow>
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
