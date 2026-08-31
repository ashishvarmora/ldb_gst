import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FolderOpen, Pencil, Plus, Trash2, X } from "lucide-react";

import { addTruckToCase, deleteCase, removeTruckFromCase, updateCase } from "../actions";
import {
  ActionForm,
  ConfirmSubmitButton,
  InlineActionForm,
  SubmitButton,
} from "@/components/ActionForm";
import { Disclosure } from "@/components/Disclosure";
import { Field, FormActions, Input, Textarea } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Pager, pageCount, pageFromParam, pageSlice } from "@/components/Pager";
import { publicSettings } from "@/components/SiteFooter";
import { Timeline } from "@/components/Timeline";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE } from "@/components/TruckCard";
import { Badge, EmptyState, Mono, Panel } from "@/components/ui";
import { fmtDate, fmtNumber, fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TrackedTruck, TruckEvent, TruckGroup } from "@/lib/types";

/** Trucks listed per page, and crossings per page of the combined timeline. */
const TRUCKS_PER_PAGE = 25;
const CROSSINGS_PER_PAGE = 50;

/** A group with more members than this is not something a phone should render. */
const MEMBER_CAP = 1000;

type GroupQuery = { t?: string; page?: string };

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const [{ id }, { brandName }] = await Promise.all([params, publicSettings()]);
  const { data } = await getSupabaseAdmin()
    .from("truck_groups")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  return { title: `${data?.name ?? "Group"} — ${brandName}` };
}

export default async function CaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<GroupQuery>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const { data: group } = await admin
    .from("truck_groups")
    .select("*")
    .eq("id", id)
    .eq("user_id", overview.id)
    .maybeSingle<TruckGroup>();

  if (!group) notFound();

  // Every member number is needed for the combined timeline's filter, so the
  // list itself is paged in memory rather than in a second query.
  const { data: members } = await admin
    .from("truck_group_members")
    .select("truck_number, added_at")
    .eq("group_id", id)
    .order("added_at")
    .limit(MEMBER_CAP);

  const numbers = (members ?? []).map((row) => row.truck_number);

  const truckPage = pageFromParam(query.t, pageCount(numbers.length, TRUCKS_PER_PAGE));
  const shownNumbers = pageSlice(numbers, truckPage, TRUCKS_PER_PAGE);

  const eventPage = pageFromParam(query.page);
  const eventFrom = (eventPage - 1) * CROSSINGS_PER_PAGE;

  const [{ data: events, count }, { data: tracked }] = await Promise.all([
    numbers.length > 0
      ? admin
          .from("truck_events")
          .select("*", { count: "exact" })
          .eq("user_id", overview.id)
          .in("truck_number", numbers)
          .order("event_time", { ascending: false, nullsFirst: false })
          .range(eventFrom, eventFrom + CROSSINGS_PER_PAGE - 1)
      : Promise.resolve({ data: [] as TruckEvent[], count: 0 }),
    numbers.length > 0
      ? admin
          .from("tracked_trucks")
          .select("*")
          .eq("user_id", overview.id)
          .in("truck_number", numbers)
      : Promise.resolve({ data: [] as TrackedTruck[] }),
  ]);

  const eventList = (events ?? []) as TruckEvent[];
  const totalEvents = count ?? eventList.length;
  const trackedList = (tracked ?? []) as TrackedTruck[];
  const trackedByNumber = new Map(trackedList.map((truck) => [truck.truck_number, truck]));

  // Latest crossing per truck, read off whichever page is open. Only a fallback
  // for untracked trucks - a tracked one carries its own last position.
  const latestByTruck = new Map<string, TruckEvent>();
  for (const event of eventList) {
    if (!latestByTruck.has(event.truck_number)) latestByTruck.set(event.truck_number, event);
  }

  const activeTracking = trackedList.filter((truck) => truck.is_active).length;

  return (
    <>
      <Link
        href="/portal/cases"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-brand-400"
      >
        <ArrowLeft size={13} />
        All groups
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 items-center justify-center rounded-xl border border-line bg-raised text-brand-400">
              <FolderOpen size={17} />
            </span>
            <h1 className="text-2xl font-semibold tracking-tight text-strong">{group.name}</h1>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            {group.description ?? `Created ${fmtDate(group.created_at)}.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Modal
            triggerLabel="Add truck"
            triggerIcon={<Plus size={14} />}
            triggerSize="sm"
            title="Add a truck to this group"
            width="sm"
          >
            {/* case_id is the field name these actions have always used - the
                copy is neutral now, the wire format is untouched. */}
            <ActionForm action={addTruckToCase} closeOnSuccess={false} resetOnSuccess>
              <input type="hidden" name="case_id" value={group.id} />
              <Field
                label="Truck number"
                name="truck_number"
                hint="It does not have to be under tracking."
              >
                <Input
                  name="truck_number"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="e.g. MH12AB1234"
                  className="font-mono tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
                />
              </Field>
              <FormActions>
                <SubmitButton>Add to group</SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>

          <Modal
            triggerLabel="Edit"
            triggerIcon={<Pencil size={13} />}
            triggerVariant="secondary"
            triggerSize="sm"
            title="Edit group"
            width="sm"
          >
            <ActionForm action={updateCase} closeOnSuccess={false}>
              <input type="hidden" name="case_id" value={group.id} />
              <div className="space-y-4">
                <Field label="Group name" name="name">
                  <Input name="name" required defaultValue={group.name} />
                </Field>
                <Field label="Notes" name="description">
                  <Textarea name="description" rows={3} defaultValue={group.description ?? ""} />
                </Field>
              </div>
              <FormActions>
                <SubmitButton>Save</SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>

          <InlineActionForm action={deleteCase} hidden={{ case_id: group.id }}>
            <ConfirmSubmitButton
              message={`Delete the group "${group.name}"? The trucks and their history are kept.`}
            >
              <Trash2 size={13} />
              Delete group
            </ConfirmSubmitButton>
          </InlineActionForm>
        </div>
      </div>

      <p className="mb-4 text-xs text-muted">
        {fmtNumber(numbers.length)} truck{numbers.length === 1 ? "" : "s"} · {activeTracking} under
        tracking · {fmtNumber(totalEvents)} crossing{totalEvents === 1 ? "" : "s"} on record
      </p>

      {numbers.length === 0 ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title="No trucks in this group yet"
            description="Add the vehicles you want to follow and their movements appear together here."
          />
        </Panel>
      ) : (
        <div className="space-y-4">
          <Panel
            title={`Trucks (${fmtNumber(numbers.length)})`}
            description="Each truck, with its latest position."
            bodyClassName="p-0"
          >
            <ul className="divide-y divide-divider">
              {shownNumbers.map((number) => {
                const truck = trackedByNumber.get(number);
                const latest = latestByTruck.get(number) ?? null;
                const status = truck ? (truck.is_active ? truck.status : "unknown") : "unknown";

                /* A tracked truck carries its own last position, which is true
                   whatever page of crossings is open. Everything else falls
                   back to this page, and says so rather than claiming there is
                   nothing on record. */
                const lastSeen = truck?.last_event_at
                  ? `${truck.last_location ?? "Unnamed plaza"} · ${fmtRelative(truck.last_event_at)}`
                  : latest
                    ? `${latest.loc_name ?? "Unnamed plaza"} · ${fmtRelative(latest.event_time)}`
                    : truck
                      ? "No crossing on record yet"
                      : "Open to look it up";

                return (
                  <li key={number} className="flex items-start justify-between gap-2 px-4 py-3">
                    <Link
                      href={truck ? `/portal/trucks/${truck.id}` : `/portal/search/${number}`}
                      className="group min-w-0"
                    >
                      <Mono className="block font-semibold text-ink group-hover:text-brand-500">
                        {number}
                      </Mono>
                      <span className="mt-0.5 block truncate text-xs text-muted">{lastSeen}</span>
                    </Link>

                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badge tone={TRUCK_STATUS_TONE[status]}>
                        {truck ? TRUCK_STATUS_LABEL[status] : "not tracked"}
                      </Badge>
                      <InlineActionForm
                        action={removeTruckFromCase}
                        hidden={{ case_id: group.id, truck_number: number }}
                      >
                        <ConfirmSubmitButton
                          message={`Remove ${number} from this group?`}
                          variant="ghost"
                        >
                          <X size={12} />
                          <span className="sr-only">Remove from group</span>
                        </ConfirmSubmitButton>
                      </InlineActionForm>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* Each list keeps its own page key, and carries the other one, so
                turning the trucks over does not reset the timeline. */}
            <Pager
              page={truckPage}
              total={numbers.length}
              pageSize={TRUCKS_PER_PAGE}
              noun="trucks"
              href={{
                path: `/portal/cases/${group.id}`,
                params: { page: query.page },
                pageKey: "t",
              }}
              className="border-t border-divider px-4 py-3"
            />
          </Panel>

          <Disclosure
            title="Combined movement"
            /* Paging happens inside this section, so a page other than the
               first has to open it - otherwise Next shuts it again. */
            defaultOpen={eventPage > 1}
            hint={
              totalEvents === 0
                ? "No crossings on record"
                : `${fmtNumber(totalEvents)} crossing${totalEvents === 1 ? "" : "s"} across every truck, newest first`
            }
          >
            {eventList.length === 0 ? (
              <EmptyState
                title="No crossings on record"
                description="Search one of these trucks, or add it to tracking, and its movements will show up here."
              />
            ) : (
              <>
                <CombinedTimeline events={eventList} />
                <Pager
                  page={eventPage}
                  total={totalEvents}
                  pageSize={CROSSINGS_PER_PAGE}
                  noun="crossings"
                  href={{
                    path: `/portal/cases/${group.id}`,
                    params: { t: query.t },
                    pageKey: "page",
                  }}
                  className="mt-4 border-t border-divider pt-3"
                />
              </>
            )}
          </Disclosure>
        </div>
      )}
    </>
  );
}

/**
 * The plain Timeline does not show which truck a crossing belongs to, which is
 * exactly what matters when several vehicles are mixed together.
 */
function CombinedTimeline({ events }: { events: TruckEvent[] }) {
  const labelled = events.map((event) => ({
    ...event,
    loc_name: `${event.truck_number} — ${event.loc_name ?? "Unnamed plaza"}`,
  }));
  return <Timeline events={labelled} />;
}

