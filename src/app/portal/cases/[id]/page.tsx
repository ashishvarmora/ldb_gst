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
import { Field, FormActions, Input, Textarea } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Timeline } from "@/components/Timeline";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE } from "@/components/TruckCard";
import { Badge, EmptyState, LinkButton, Mono, Panel, StatCard } from "@/components/ui";
import { fmtDate, fmtRelative } from "@/lib/format";
import { requirePortalSession } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { TrackedTruck, TruckEvent, TruckGroup } from "@/lib/types";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { data } = await getSupabaseAdmin()
    .from("truck_groups")
    .select("name")
    .eq("id", id)
    .maybeSingle();
  return { title: `${data?.name ?? "Case"} — Truck Watch` };
}

export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const { data: group } = await admin
    .from("truck_groups")
    .select("*")
    .eq("id", id)
    .eq("user_id", overview.id)
    .maybeSingle<TruckGroup>();

  if (!group) notFound();

  const { data: members } = await admin
    .from("truck_group_members")
    .select("truck_number, added_at")
    .eq("group_id", id)
    .order("added_at");

  const numbers = (members ?? []).map((row) => row.truck_number);

  const [{ data: events }, { data: tracked }] = await Promise.all([
    numbers.length > 0
      ? admin
          .from("truck_events")
          .select("*")
          .eq("user_id", overview.id)
          .in("truck_number", numbers)
          .order("event_time", { ascending: false, nullsFirst: false })
          .limit(150)
      : Promise.resolve({ data: [] as TruckEvent[] }),
    numbers.length > 0
      ? admin
          .from("tracked_trucks")
          .select("*")
          .eq("user_id", overview.id)
          .in("truck_number", numbers)
      : Promise.resolve({ data: [] as TrackedTruck[] }),
  ]);

  const eventList = (events ?? []) as TruckEvent[];
  const trackedList = (tracked ?? []) as TrackedTruck[];
  const trackedByNumber = new Map(trackedList.map((truck) => [truck.truck_number, truck]));

  const eventsByTruck = new Map<string, TruckEvent[]>();
  for (const event of eventList) {
    const list = eventsByTruck.get(event.truck_number) ?? [];
    list.push(event);
    eventsByTruck.set(event.truck_number, list);
  }

  const activeTracking = trackedList.filter((truck) => truck.is_active).length;

  return (
    <>
      <Link
        href="/portal/cases"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-brand-400"
      >
        <ArrowLeft size={13} />
        All cases
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
            title="Add a truck to this case"
            width="sm"
          >
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
                  placeholder="GJ02AT8546"
                  className="font-mono tracking-wider uppercase placeholder:font-sans placeholder:tracking-normal placeholder:normal-case"
                />
              </Field>
              <FormActions>
                <SubmitButton>Add to case</SubmitButton>
              </FormActions>
            </ActionForm>
          </Modal>

          <Modal
            triggerLabel="Edit"
            triggerIcon={<Pencil size={13} />}
            triggerVariant="secondary"
            triggerSize="sm"
            title="Edit case"
            width="sm"
          >
            <ActionForm action={updateCase} closeOnSuccess={false}>
              <input type="hidden" name="case_id" value={group.id} />
              <div className="space-y-4">
                <Field label="Case name" name="name">
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
              message={`Delete the case "${group.name}"? The trucks and their history are kept.`}
            >
              <Trash2 size={13} />
              Delete case
            </ConfirmSubmitButton>
          </InlineActionForm>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Trucks in case" value={numbers.length} />
        <StatCard label="Under tracking" value={activeTracking} tone="brand" />
        <StatCard label="Crossings on record" value={eventList.length} />
        <StatCard
          label="Newest crossing"
          value={fmtRelative(eventList[0]?.event_time)}
          sub={eventList[0]?.loc_name ?? undefined}
        />
      </div>

      {numbers.length === 0 ? (
        <Panel bodyClassName="p-0">
          <EmptyState
            title="No trucks in this case yet"
            description="Add the vehicles you are investigating and their movements appear together here."
          />
        </Panel>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-4">
            <Panel
              title={`Trucks (${numbers.length})`}
              description="Each truck, with its latest position."
              bodyClassName="p-0"
            >
              <ul className="divide-y divide-divider">
                {numbers.map((number) => {
                  const truck = trackedByNumber.get(number);
                  const latest = eventsByTruck.get(number)?.[0] ?? null;
                  const status = truck ? (truck.is_active ? truck.status : "unknown") : "unknown";

                  return (
                    <li key={number} className="px-4 py-3">
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          href={
                            truck ? `/portal/trucks/${truck.id}` : `/portal/search/${number}`
                          }
                          className="min-w-0 group"
                        >
                          <Mono className="block font-semibold text-ink group-hover:text-brand-400">
                            {number}
                          </Mono>
                          <span className="mt-0.5 block truncate text-xs text-muted">
                            {latest?.loc_name ?? "No crossings on record"}
                          </span>
                          <span className="block text-[11px] text-faint">
                            {latest ? fmtRelative(latest.event_time) : "—"}
                          </span>
                        </Link>

                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <Badge tone={TRUCK_STATUS_TONE[status]}>
                            {truck ? TRUCK_STATUS_LABEL[status] : "not tracked"}
                          </Badge>
                          <InlineActionForm
                            action={removeTruckFromCase}
                            hidden={{ case_id: group.id, truck_number: number }}
                          >
                            <ConfirmSubmitButton
                              message={`Remove ${number} from this case?`}
                              variant="ghost"
                            >
                              <X size={12} />
                            </ConfirmSubmitButton>
                          </InlineActionForm>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel title="Tip">
              <p className="text-xs leading-relaxed text-muted">
                A truck can sit in a case without being tracked — useful for vehicles you only need
                to look up occasionally. Add it to tracking from its own page when you want
                background checks and alerts.
              </p>
              <div className="mt-3">
                <LinkButton href="/portal/trucks" size="sm" variant="secondary">
                  Manage tracking
                </LinkButton>
              </div>
            </Panel>
          </div>

          <div className="xl:col-span-2">
            <Panel
              title="Combined movement"
              description="Every crossing by every truck in this case, newest first."
            >
              {eventList.length === 0 ? (
                <EmptyState
                  title="No crossings on record"
                  description="Search one of these trucks, or add it to tracking, and its movements will show up here."
                />
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {numbers.map((number) => {
                      const count = eventsByTruck.get(number)?.length ?? 0;
                      return (
                        <span
                          key={number}
                          className="rounded-full border border-line bg-raised px-2.5 py-1 text-[11px] text-muted"
                        >
                          <Mono>{number}</Mono>
                          <span className="ml-1.5 text-faint">{count}</span>
                        </span>
                      );
                    })}
                  </div>
                  <CombinedTimeline events={eventList} />
                </>
              )}
            </Panel>
          </div>
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
