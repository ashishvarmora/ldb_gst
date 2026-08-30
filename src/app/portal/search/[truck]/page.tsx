import Link from "next/link";
import { ArrowLeft, ExternalLink, FolderPlus, Plus, RefreshCw, Truck as TruckIcon } from "lucide-react";

import { searchAgain } from "../actions";
import { addTruckToCase } from "@/app/portal/cases/actions";
import { addTruck } from "@/app/portal/trucks/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
import { RouteSummary, Timeline, directionLabel } from "@/components/Timeline";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE } from "@/components/TruckCard";
import { Badge, DescRow, EmptyState, LinkButton, Mono, Panel } from "@/components/ui";
import { fmtDateTime, fmtRelative } from "@/lib/format";
import { normalizeTruck } from "@/lib/forms";
import { stateFromLocation } from "@/lib/geo";
import { requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SearchLog, TrackedTruck, TruckEvent, TruckGroup } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ truck: string }> }) {
  const { truck } = await params;
  return { title: `${normalizeTruck(decodeURIComponent(truck))} — Truck Watch` };
}

/**
 * The route comes first and full width: it is the whole reason the officer typed
 * a number. Plaza detail, timings, tracking and case actions sit underneath, in
 * the order someone reads them after they already know where the truck went.
 */
export default async function SearchResultPage({
  params,
}: {
  params: Promise<{ truck: string }>;
}) {
  const { truck: rawTruck } = await params;
  const truckNumber = normalizeTruck(decodeURIComponent(rawTruck));
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const [{ data: events }, { data: tracked }, { data: lastSearch }, { data: cases }] =
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
    ]);

  const eventList = (events ?? []) as TruckEvent[];
  const caseList = (cases ?? []) as TruckGroup[];
  const latest = eventList[0] ?? null;
  const slots = truckSlotsLeft(overview);
  const state = stateFromLocation(latest?.loc_name);

  return (
    <>
      <Link
        href="/portal/search"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-brand-400"
      >
        <ArrowLeft size={13} />
        Search another truck
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
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
        </div>

        <ActionForm action={searchAgain} closeOnSuccess={false}>
          <input type="hidden" name="truck_number" value={truckNumber} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Checking...">
            <RefreshCw size={13} />
            Check again
          </SubmitButton>
        </ActionForm>
      </div>

      {/* ------------------------------- the route ----------------------- */}
      <Panel
        title="Route"
        description="Every toll crossing on record, newest first, grouped by day."
        className="mb-3"
      >
        {eventList.length === 0 ? (
          <EmptyState
            title="Nothing on record for this truck"
            description={
              lastSearch?.ok === false
                ? `The last lookup failed: ${lastSearch.error}`
                : "The portal only reports roughly the last week, so a truck that has not passed a plaza recently shows nothing."
            }
          />
        ) : (
          <Timeline events={eventList} />
        )}
      </Panel>

      <RouteSummary events={eventList} />

      {/* ------------------------------- the detail ---------------------- */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        {latest ? (
          <Panel title="Last crossing in detail">
            <dl>
              <DescRow label="Toll plaza">{latest.loc_name ?? "Unnamed plaza"}</DescRow>
              <DescRow label="State">
                {state ?? <span className="text-faint">not recognised</span>}
              </DescRow>
              <DescRow label="Crossed at">{fmtDateTime(latest.event_time)}</DescRow>
              <DescRow label="Time since">{fmtRelative(latest.event_time)}</DescRow>
              <DescRow label="Direction">
                {directionLabel(latest.direction) ?? <span className="text-faint">not reported</span>}
              </DescRow>
              <DescRow label="On the map">
                {latest.lat !== null && latest.lng !== null ? (
                  <a
                    href={`https://www.google.com/maps?q=${latest.lat},${latest.lng}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-brand-500 hover:underline"
                  >
                    {latest.lat.toFixed(4)}, {latest.lng.toFixed(4)}
                    <ExternalLink size={11} />
                  </a>
                ) : (
                  <span className="text-faint">no coordinates</span>
                )}
              </DescRow>
              <DescRow label="Crossing id">
                <Mono>{latest.seq_no}</Mono>
              </DescRow>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-faint">
              The state is worked out from the plaza name, so treat it as a hint rather than a
              boundary check. District is not reported by the portal.
            </p>
          </Panel>
        ) : null}

        <Panel title="This truck">
          {tracked ? (
            <dl>
              <DescRow label="Tracking">
                {tracked.is_active ? (
                  <span className="text-good-500">on</span>
                ) : (
                  <span className="text-muted">paused</span>
                )}
              </DescRow>
              <DescRow label="Last automatic check">{fmtRelative(tracked.last_polled_at)}</DescRow>
              <DescRow label="Last known plaza">
                {tracked.last_location ?? <span className="text-faint">none yet</span>}
              </DescRow>
              <DescRow label="Last looked up">
                {lastSearch ? fmtDateTime(lastSearch.created_at) : "--"}
              </DescRow>
            </dl>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-muted">
                This was a one-off lookup. Nothing about this truck is checked in the background
                until you add it to tracking and give it an alert.
              </p>
              <dl className="mt-3">
                <DescRow label="Last looked up">
                  {lastSearch ? fmtDateTime(lastSearch.created_at) : "--"}
                </DescRow>
              </dl>
            </>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-divider pt-4">
            {tracked ? (
              <LinkButton href={`/portal/trucks/${tracked.id}`} variant="primary" size="sm">
                Manage this truck
              </LinkButton>
            ) : (
              <Modal
                triggerLabel="Add to tracking"
                triggerIcon={<Plus size={14} />}
                triggerSize="sm"
                title={`Track ${truckNumber}`}
                description={
                  slots === Number.POSITIVE_INFINITY
                    ? "Adds the truck to your list so you can put alerts on it."
                    : `${slots} tracking slot${slots === 1 ? "" : "s"} free on your plan.`
                }
                width="sm"
              >
                <ActionForm action={addTruck} closeOnSuccess={false}>
                  <input type="hidden" name="truck_number" value={truckNumber} />
                  <Field
                    label="Label"
                    name="label"
                    hint="Optional. Something you will recognise later."
                  >
                    <Input name="label" placeholder="Textile case — supplier vehicle" />
                  </Field>
                  <p className="mt-4 rounded-lg border border-line bg-raised px-3 py-2.5 text-xs leading-relaxed text-muted">
                    A tracked truck is only checked when it has an alert on it. Once it is added,
                    open its page under Trucks and switch on the alert you want.
                  </p>
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

            <LinkButton href={`/portal/records?view=all&truck=${truckNumber}&range=all`} size="sm">
              All records
            </LinkButton>
          </div>
        </Panel>
      </div>
    </>
  );
}
