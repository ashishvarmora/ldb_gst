import Link from "next/link";
import { ArrowLeft, FolderPlus, Plus, RefreshCw, Truck as TruckIcon } from "lucide-react";

import { searchAgain } from "../actions";
import { addTruckToCase } from "@/app/portal/cases/actions";
import { addTruck } from "@/app/portal/trucks/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Checkbox, Field, FormActions, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
import { LatestPosition, Timeline } from "@/components/Timeline";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE } from "@/components/TruckCard";
import { Badge, EmptyState, LinkButton, Mono, Panel, StatCard } from "@/components/ui";
import { normalizeTruck } from "@/lib/forms";
import { IntervalField } from "@/components/IntervalField";
import { intervalLabel } from "@/lib/intervals";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { loadSettings } from "@/lib/settings";
import type { SearchLog, TrackedTruck, TruckEvent, TruckGroup } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ truck: string }> }) {
  const { truck } = await params;
  return { title: `${normalizeTruck(decodeURIComponent(truck))} — Truck Watch` };
}

export default async function SearchResultPage({
  params,
}: {
  params: Promise<{ truck: string }>;
}) {
  const { truck: rawTruck } = await params;
  const truckNumber = normalizeTruck(decodeURIComponent(rawTruck));
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: events }, { data: tracked }, { data: lastSearch }, { data: cases }, settings] =
    await Promise.all([
      admin
        .from("truck_events")
        .select("*")
        .eq("user_id", overview.id)
        .eq("truck_number", truckNumber)
        .order("event_time", { ascending: false, nullsFirst: false })
        .limit(120),
      admin
        .from("tracked_trucks")
        .select("*")
        .eq("user_id", overview.id)
        .eq("truck_number", truckNumber)
        .maybeSingle<TrackedTruck>(),
      admin
        .from("search_logs")
        .select("*")
        .eq("user_id", overview.id)
        .eq("truck_number", truckNumber)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<SearchLog>(),
      admin.from("truck_groups").select("*").eq("user_id", overview.id).order("name"),
      loadSettings(admin),
    ]);

  const eventList = (events ?? []) as TruckEvent[];
  const caseList = (cases ?? []) as TruckGroup[];
  const latest = eventList[0] ?? null;
  const floor = Math.max(overview.min_polling_interval_minutes, settings.globalPollingFloor);
  const slots = truckSlotsLeft(overview);

  const uniquePlazas = new Set(eventList.map((event) => event.loc_name).filter(Boolean)).size;
  const firstSeen = eventList[eventList.length - 1] ?? null;

  return (
    <>
      <Link
        href="/portal/search"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-brand-400"
      >
        <ArrowLeft size={13} />
        Search another truck
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex size-9 items-center justify-center rounded-xl border border-line bg-raised text-muted">
              <TruckIcon size={17} />
            </span>
            <h1 className="font-mono text-2xl font-semibold tracking-wide text-strong">
              {truckNumber}
            </h1>
            {tracked ? (
              <Badge tone={TRUCK_STATUS_TONE[tracked.is_active ? tracked.status : "unknown"]}>
                {TRUCK_STATUS_LABEL[tracked.is_active ? tracked.status : "unknown"]}
              </Badge>
            ) : (
              <Badge>not tracked</Badge>
            )}
          </div>
          <p className="mt-1.5 text-sm text-muted">
            {lastSearch
              ? `Last looked up ${fmtRelative(lastSearch.created_at)} · ${fmtDateTime(lastSearch.created_at)}`
              : "No lookup recorded for this truck yet."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ActionForm action={searchAgain} closeOnSuccess={false}>
            <input type="hidden" name="truck_number" value={truckNumber} />
            <SubmitButton variant="secondary" size="sm" pendingLabel="Checking...">
              <RefreshCw size={13} />
              Check again (1 credit)
            </SubmitButton>
          </ActionForm>

          {tracked ? (
            <LinkButton href={`/portal/trucks/${tracked.id}`} variant="primary" size="sm">
              Open tracking
            </LinkButton>
          ) : (
            <Modal
              triggerLabel="Add to tracking"
              triggerIcon={<Plus size={14} />}
              triggerSize="sm"
              title={`Track ${truckNumber}`}
              description={
                slots === Number.POSITIVE_INFINITY
                  ? "The platform will check this truck in the background."
                  : `${slots} tracking slot${slots === 1 ? "" : "s"} free on your plan.`
              }
              width="sm"
            >
              <ActionForm action={addTruck} closeOnSuccess={false}>
                <input type="hidden" name="truck_number" value={truckNumber} />
                <div className="space-y-4">
                  <Field
                    label="Label"
                    name="label"
                    hint="Optional. Something you will recognise later."
                  >
                    <Input name="label" placeholder="Textile case — supplier vehicle" />
                  </Field>
                  <Field
                    label="Check every"
                    hint={`Your administrator allows ${intervalLabel(floor)} at the fastest.`}
                  >
                    <IntervalField
                      defaultMinutes={Math.max(30, floor)}
                      floorMinutes={floor}
                    />
                  </Field>
                  <Checkbox
                    name="is_watchlist"
                    label="Watchlist truck"
                    hint="Alert me on every crossing, not just rule matches."
                  />
                </div>
                <FormActions>
                  <SubmitButton pendingLabel="Adding...">Start tracking</SubmitButton>
                </FormActions>
              </ActionForm>
            </Modal>
          )}

          {caseList.length > 0 ? (
            <Modal
              triggerLabel="Add to case"
              triggerIcon={<FolderPlus size={14} />}
              triggerVariant="secondary"
              triggerSize="sm"
              title="Add to a case folder"
              width="sm"
            >
              <ActionForm action={addTruckToCase} closeOnSuccess={false}>
                <input type="hidden" name="truck_number" value={truckNumber} />
                <Field label="Case folder" name="case_id">
                  <Select name="case_id" defaultValue={caseList[0].id}>
                    {caseList.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <FormActions>
                  <SubmitButton>Add</SubmitButton>
                </FormActions>
              </ActionForm>
            </Modal>
          ) : null}
        </div>
      </div>

      {eventList.length === 0 ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title="Nothing on record for this truck"
            description={
              lastSearch?.ok === false
                ? `The last lookup failed: ${lastSearch.error}`
                : "The portal returned no toll crossings. It only reports roughly the last week, so a truck that has not moved recently shows nothing."
            }
          />
        </Panel>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Crossings on record" value={eventList.length} />
            <StatCard label="Distinct plazas" value={uniquePlazas} />
            <StatCard
              label="Newest crossing"
              value={fmtRelative(latest?.event_time)}
              sub={latest?.loc_name ?? undefined}
            />
            <StatCard
              label="Oldest on record"
              value={fmtRelative(firstSeen?.event_time)}
              sub={firstSeen?.loc_name ?? undefined}
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

              {tracked ? (
                <Panel title="Tracking">
                  <dl className="space-y-2 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Interval</dt>
                      <dd className="text-ink">
                        every {tracked.polling_interval_minutes} min
                      </dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Last auto check</dt>
                      <dd className="text-ink">{fmtRelative(tracked.last_polled_at)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted">Watchlist</dt>
                      <dd className="text-ink">{tracked.is_watchlist ? "Yes" : "No"}</dd>
                    </div>
                  </dl>
                  <div className="mt-3">
                    <LinkButton href={`/portal/trucks/${tracked.id}`} size="sm" variant="secondary">
                      Manage this truck
                    </LinkButton>
                  </div>
                </Panel>
              ) : (
                <Panel title="Not being tracked">
                  <p className="text-xs leading-relaxed text-muted">
                    This was a one-off lookup. Nothing is checked automatically and no monthly quota
                    is used. Add it to tracking to get background checks and alerts.
                  </p>
                </Panel>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
