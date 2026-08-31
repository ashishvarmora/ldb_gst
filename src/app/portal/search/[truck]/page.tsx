import Link from "next/link";
import { ArrowLeft, FolderPlus, Plus, RefreshCw } from "lucide-react";

import { searchAgain } from "../actions";
import { addTruckToCase } from "@/app/portal/cases/actions";
import { addTruck } from "@/app/portal/trucks/actions";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Input, Select } from "@/components/form";
import { Modal } from "@/components/Modal";
import { Pager, pageFromParam } from "@/components/Pager";
import { publicSettings } from "@/components/SiteFooter";
import { RouteHistory, RouteSummary } from "@/components/Timeline";
import { TRUCK_STATUS_LABEL, TRUCK_STATUS_TONE } from "@/components/TruckCard";
import { Badge, EmptyState, LinkButton, Panel } from "@/components/ui";
import { friendlyError } from "@/lib/errors";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import { normalizeTruck } from "@/lib/forms";
import { requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { SearchLog, TrackedTruck, TruckEvent, TruckGroup } from "@/lib/types";

/**
 * Crossings loaded per page. The whole record is kept and the count below the
 * route says how much of it there is, but a phone is never handed a year of
 * crossings in one response - older pages are one tap away instead.
 */
const PAGE_SIZE = 50;

export async function generateMetadata({ params }: { params: Promise<{ truck: string }> }) {
  const [{ truck }, { brandName }] = await Promise.all([params, publicSettings()]);
  return { title: `${normalizeTruck(decodeURIComponent(truck))} — ${brandName}` };
}

/**
 * The route comes first and full width: it is the whole reason a number was
 * typed. What can be done about it sits underneath, in the order someone reads
 * it once they already know where the truck went.
 */
export default async function SearchResultPage({
  params,
  searchParams,
}: {
  params: Promise<{ truck: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { truck: rawTruck } = await params;
  const truckNumber = normalizeTruck(decodeURIComponent(rawTruck));
  const { overview } = await requirePortalSession();
  const admin = getSupabaseAdmin();

  const page = pageFromParam((await searchParams).page);
  const from = (page - 1) * PAGE_SIZE;

  const [
    { data: events, count },
    { data: oldestRows },
    { data: tracked },
    { data: lastSearch },
    { data: cases },
  ] = await Promise.all([
    // One page of the crossings kept for this number. The exact count comes
    // back with it, so the page can always say how many are stored in all.
    admin
      .from("truck_events")
      .select("*", { count: "exact" })
      .eq("user_id", overview.id)
      .eq("truck_number", truckNumber)
      .order("event_time", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE - 1),
    // The first crossing ever recorded, so the summary can span the whole
    // history rather than only the page on screen.
    admin
      .from("truck_events")
      .select("*")
      .eq("user_id", overview.id)
      .eq("truck_number", truckNumber)
      .order("event_time", { ascending: true, nullsFirst: false })
      .limit(1),
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
  const oldest = ((oldestRows ?? []) as TruckEvent[])[0] ?? null;
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
            : `${fmtNumber(total)} crossing${total === 1 ? "" : "s"} kept for this number, newest first, with the time each was recorded.`
        }
        className="mb-4"
      >
        {eventList.length === 0 ? (
          <EmptyState
            title={page > 1 ? "Nothing on this page" : "Nothing on record for this truck"}
            description={
              page > 1
                ? "There are no crossings this far back."
                : lastSearch?.ok === false
                  ? friendlyError(lastSearch.error)
                  : "The toll network only reports roughly the last week, so a truck that has not passed a plaza recently shows nothing."
            }
            action={
              page > 1 ? (
                <LinkButton href={`/portal/search/${truckNumber}`}>Back to the newest</LinkButton>
              ) : null
            }
          />
        ) : (
          <RouteHistory events={eventList} />
        )}
      </Panel>

      <Pager
        page={page}
        total={total}
        pageSize={PAGE_SIZE}
        noun="crossings on record"
        href={{ path: `/portal/search/${truckNumber}` }}
        className="mb-4"
      />

      {/* The summary reads the newest crossing, which only the first page
          holds. Further back it would quietly describe the wrong moment. */}
      {page === 1 ? <RouteSummary events={eventList} total={total} oldest={oldest} /> : null}

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
                  <Input name="label" placeholder="e.g. Supplier vehicle — north route" />
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
              triggerLabel="Add to group"
              triggerIcon={<FolderPlus size={14} />}
              triggerVariant="secondary"
              triggerSize="sm"
              title="Add to a group"
              width="sm"
            >
              {/* case_id is the field name the group actions have always used -
                  a copy change does not rename the wire format. */}
              <ActionForm action={addTruckToCase} closeOnSuccess={false}>
                <input type="hidden" name="truck_number" value={truckNumber} />
                <Field label="Group" name="case_id">
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

