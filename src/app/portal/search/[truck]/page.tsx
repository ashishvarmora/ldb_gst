import Link from "next/link";
import { ArrowLeft, FolderPlus, Plus, RefreshCw } from "lucide-react";

import { searchAgain } from "../actions";
import { addTruckToCase } from "@/app/portal/cases/actions";
import { addTruck } from "@/app/portal/trucks/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
import { RouteHistory, RouteSummary } from "@/components/Timeline";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE } from "@/components/TruckCard";
import { Badge, EmptyState, LinkButton, Panel } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime } from "@/lib/format";
import { normalizeTruck } from "@/lib/forms";
import { requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SearchLog, TrackedTruck, TruckEvent, TruckGroup } from "@/lib/types";

/**
 * How much history is loaded onto the page. The officer asked to see the whole
 * record rather than the last week, so this is deliberately generous - but a
 * cap still exists, because a phone should not be handed a year of crossings
 * in one response. Anything past it is reachable from the Records page.
 */
const HISTORY_LIMIT = 400;

export async function generateMetadata({ params }: { params: Promise<{ truck: string }> }) {
  const { truck } = await params;
  return { title: `${normalizeTruck(decodeURIComponent(truck))} — Truck Watch` };
}

/**
 * The route comes first and full width: it is the whole reason the officer
 * typed a number. What they can do about it sits underneath, in the order
 * someone reads it once they already know where the truck went.
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

  const [{ data: events, count }, { data: tracked }, { data: lastSearch }, { data: cases }] =
    await Promise.all([
      // Every crossing kept for this number, not just the recent window - the
      // stored history is the case record.
      admin
        .from("truck_events")
        .select("*", { count: "exact" })
        .eq("user_id", overview.id)
        .eq("truck_number", truckNumber)
        .order("event_time", { ascending: false, nullsFirst: false })
        .limit(HISTORY_LIMIT),
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
  const total = count ?? eventList.length;
  const slots = truckSlotsLeft(overview);
  const status = tracked ? (tracked.is_active ? tracked.status : "unknown") : null;

  return (
    <>
      <Link
        href="/portal/search"
        className="mb-3 inline-flex min-h-9 items-center gap-1.5 text-xs text-muted transition hover:text-brand-500"
      >
        <ArrowLeft size={13} />
        Search another truck
      </Link>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h1 className="font-mono text-xl font-semibold tracking-wide text-strong sm:text-2xl">
            {truckNumber}
          </h1>
          {status ? (
            <Badge tone={TRUCK_STATUS_TONE[status]}>{TRUCK_STATUS_LABEL[status]}</Badge>
          ) : (
            <Badge>not tracked</Badge>
          )}
        </div>

        <ActionForm action={searchAgain} closeOnSuccess={false}>
          <input type="hidden" name="truck_number" value={truckNumber} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Checking...">
            <RefreshCw size={13} />
            Check again
          </SubmitButton>
        </ActionForm>
      </div>

      {/* ------------------------------- the route ------------------------- */}
      <Panel
        title="Route"
        description={
          total === 0
            ? "Nothing on record yet."
            : `Every crossing kept for this number - ${total} in all, newest first, with the time it was recorded.`
        }
        className="mb-4"
      >
        {eventList.length === 0 ? (
          <EmptyState
            title="Nothing on record for this truck"
            description={
              lastSearch?.ok === false
                ? friendlyError(lastSearch.error)
                : "The portal only reports roughly the last week, so a truck that has not passed a plaza recently shows nothing."
            }
          />
        ) : (
          <RouteHistory events={eventList} total={total} />
        )}
      </Panel>

      <RouteSummary events={eventList} />

      {/* ------------------------------- what to do next ------------------- */}
      <Panel title="This truck" className="mt-4">
        <p className="text-sm leading-relaxed text-muted">
          {tracked ? (
            tracked.is_active ? (
              <>
                This truck is under tracking. It is checked when one of its alerts is due, and
                every crossing it finds lands here.
              </>
            ) : (
              <>Tracking is paused on this truck, so nothing is being checked.</>
            )
          ) : (
            <>
              This was a one-off lookup. Nothing about this truck is checked in the background
              until you add it to tracking and give it an alert.
            </>
          )}
        </p>

        {lastSearch ? (
          <p className="mt-2 text-xs text-faint">
            Last looked up {fmtDateTime(lastSearch.created_at)}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-divider pt-4">
          {tracked ? (
            <LinkButton href={`/portal/trucks/${tracked.id}`} variant="primary" size="sm">
              Open this truck
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
                  Adding it on its own checks nothing. A truck is only checked once it has an
                  alert, so open it afterwards and add the alert you want.
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
    </>
  );
}
