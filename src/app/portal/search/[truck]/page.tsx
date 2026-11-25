import type { ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  FolderPlus,
  MapPin,
  MessageCircle,
  Navigation,
  Plus,
  RefreshCw,
  Star,
} from "lucide-react";

import { searchAgain } from "../actions";
import { addTruckToCase } from "@/app/portal/cases/actions";
import { AddTruckForm } from "@/app/portal/trucks/AddTruckForm";
import { loadAlertDelivery } from "@/components/AlertDeliveryBanner";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Field, FormActions, Select } from "@/components/form";
import { InfoTip } from "@/components/InfoTip";
import { Modal } from "@/components/Modal";
import { Pager, pageFromParam } from "@/components/Pager";
import { SaveTruckButton } from "@/components/SaveTruckButton";
import { publicSettings } from "@/components/SiteFooter";
import { directionLabel } from "@/components/Timeline";
import { Badge, EmptyState, LinkButton, Panel, buttonClass, cx } from "@/components/ui";
import { formatCredits } from "@/lib/credits";
import { friendlyError } from "@/lib/errors";
import { fmtDate, fmtDateTime, fmtNumber, fmtRelative } from "@/lib/format";
import { normalizeTruck } from "@/lib/forms";
import { stateFromLocation } from "@/lib/geo";
import { loadSearchCost, requirePortalSession, truckSlotsLeft } from "@/lib/officer";
import { isTruckSaved } from "@/lib/saved-trucks";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type {
  AlertRuleTemplate,
  SearchLog,
  TrackedTruck,
  TruckEvent,
  TruckGroup,
} from "@/lib/types";

import { CopyPlate } from "./CopyPlate";
import { RouteTimeline } from "./RouteTimeline";
import {
  MOVING_WITHIN_MS,
  fmtSpan,
  istDayKey,
  mapUrl,
  msBetween,
  plazaName,
  whatsappUrl,
} from "./result-utils";

/**
 * Crossings loaded per page. The whole record is kept and the pager says how
 * much of it there is, but a phone is never handed a year of crossings in one
 * response - older pages are one tap away instead.
 */
const PAGE_SIZE = 50;

/** Enough to count distinct plazas over any real history without paging. */
const PLAZA_SCAN_LIMIT = 5000;

export async function generateMetadata({ params }: { params: Promise<{ truck: string }> }) {
  const [{ truck }, { brandName }] = await Promise.all([params, publicSettings()]);
  return { title: `${normalizeTruck(decodeURIComponent(truck))} — ${brandName}` };
}

/**
 * One truck's answer, in the order it is read on a phone: which truck, what
 * can be done with it, where it was last seen, the route that led there, and
 * the totals.
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
  const [{ overview }, searchCost] = await Promise.all([requirePortalSession(), loadSearchCost()]);
  const admin = getSupabaseAdmin();

  const page = pageFromParam((await searchParams).page);
  const from = (page - 1) * PAGE_SIZE;

  const [
    { data: events, count },
    { data: newestRows },
    { data: oldestRows },
    { data: plazaRows },
    { data: tracked },
    { data: lastSearch },
    { data: cases },
    saved,
    { data: templates },
    delivery,
  ] = await Promise.all([
    // One page of crossings plus one more: the extra row is never shown, it
    // only lets the last row on the page say how long after the previous
    // crossing it came. The exact count comes back with it.
    admin
      .from("truck_events")
      .select("*", { count: "exact" })
      .eq("user_id", overview.id)
      .eq("truck_number", truckNumber)
      .order("event_time", { ascending: false, nullsFirst: false })
      .range(from, from + PAGE_SIZE),
    // The newest crossing, so "Last seen" is right on every page, not only the first.
    admin
      .from("truck_events")
      .select("*")
      .eq("user_id", overview.id)
      .eq("truck_number", truckNumber)
      .order("event_time", { ascending: false, nullsFirst: false })
      .limit(1),
    // The first crossing ever recorded, for "First seen" and "Days covered".
    admin
      .from("truck_events")
      .select("*")
      .eq("user_id", overview.id)
      .eq("truck_number", truckNumber)
      .not("event_time", "is", null)
      .order("event_time", { ascending: true })
      .limit(1),
    // Plaza names only, to count distinct plazas over the whole history.
    admin
      .from("truck_events")
      .select("loc_name")
      .eq("user_id", overview.id)
      .eq("truck_number", truckNumber)
      .limit(PLAZA_SCAN_LIMIT),
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
    isTruckSaved(admin, overview.id, truckNumber),
    /* For the "Track automatically" sheet, which is now the full add-truck
       form (number fixed): the alert catalogue and where alerts would go -
       the latter shares the layout's cached read. */
    admin
      .from("alert_rule_templates")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true }),
    loadAlertDelivery(overview.id),
  ]);

  const loaded = (events ?? []) as TruckEvent[];
  const eventList = loaded.slice(0, PAGE_SIZE);
  const olderNeighbour = loaded[PAGE_SIZE] ?? null;
  const caseList = (cases ?? []) as TruckGroup[];
  const total = count ?? eventList.length;
  const newest = ((newestRows ?? []) as TruckEvent[])[0] ?? null;
  const oldest = ((oldestRows ?? []) as TruckEvent[])[0] ?? null;
  const plazaCount = new Set(
    ((plazaRows ?? []) as Pick<TruckEvent, "loc_name">[])
      .map((row) => row.loc_name?.trim().toLowerCase())
      .filter(Boolean),
  ).size;
  const slots = truckSlotsLeft(overview);
  const costLabel = `${formatCredits(searchCost)} ${searchCost === 1 ? "credit" : "credits"}`;

  // Tracked and active, tracked but paused, or a one-off lookup.
  const trackState: "live" | "paused" | "none" = tracked
    ? tracked.is_active
      ? "live"
      : "paused"
    : "none";

  return (
    <>
      <Link
        href="/portal/search"
        className="mb-2 inline-flex min-h-10 items-center gap-1.5 text-sm text-muted transition hover:text-brand-500"
      >
        <ArrowLeft size={15} />
        Search another truck
      </Link>

      {/* ------------------------------- header ---------------------------- */}
      <header className="mb-4">
        <CopyPlate truckNumber={truckNumber} />

        <InfoTip
          label="About this lookup"
          className="mt-1"
          info={
            trackState === "live" ? (
              <p>
                This truck is tracked. It is checked whenever one of its alerts is due, and every
                crossing found appears here.
              </p>
            ) : trackState === "paused" ? (
              <p>Tracking is paused, so nothing is checked in the background.</p>
            ) : (
              <p>
                One-time lookup. Tap Check again to refresh, or Track automatically to have it
                checked for you.
              </p>
            )
          }
        >
          {trackState === "live" ? (
            <Badge tone="good">Tracking live</Badge>
          ) : trackState === "paused" ? (
            <Badge tone="warn">Tracking paused</Badge>
          ) : (
            <Badge>Not tracked</Badge>
          )}
          {saved ? (
            <Badge tone="warn">
              <Star size={10} className="fill-current" />
              Saved
            </Badge>
          ) : null}
        </InfoTip>

        {lastSearch ? (
          <p className="mt-1.5 text-xs text-faint" title={fmtDateTime(lastSearch.created_at)}>
            Checked {fmtRelative(lastSearch.created_at)}
          </p>
        ) : null}
      </header>

      {/* ------------------------------- actions --------------------------- */}
      <div className="mb-2 flex flex-wrap items-start gap-2">
        <SaveTruckButton truckNumber={truckNumber} saved={saved} />

        <ActionForm action={searchAgain} closeOnSuccess={false} className="max-w-full">
          <input type="hidden" name="truck_number" value={truckNumber} />
          <SubmitButton variant="secondary" size="sm" pendingLabel="Checking…">
            <RefreshCw size={14} />
            Check again · {costLabel}
          </SubmitButton>
        </ActionForm>

        {tracked ? (
          <LinkButton href={`/portal/trucks/${tracked.id}`} variant="primary" size="sm">
            Open tracked truck
          </LinkButton>
        ) : (
          <Modal
            triggerLabel="Track automatically"
            triggerIcon={<Plus size={14} />}
            triggerSize="sm"
            title={`Track ${truckNumber}`}
            description={
              slots === Number.POSITIVE_INFINITY
                ? "Choose an alert and checking starts."
                : `${slots} tracking slot${slots === 1 ? "" : "s"} free on your plan.`
            }
            width="md"
          >
            {/* The same form as My trucks' Add truck, with the number fixed:
                it used to add a truck with no alert and send you back to pick
                one, and a truck with no alert is never checked. */}
            <AddTruckForm
              templates={(templates ?? []) as AlertRuleTemplate[]}
              telegram={delivery}
              truckNumber={truckNumber}
            />
          </Modal>
        )}

        {newest ? (
          <a
            href={whatsappUrl(truckNumber, newest)}
            target="_blank"
            rel="noreferrer noopener"
            className={buttonClass("secondary", "sm")}
          >
            <MessageCircle size={14} className="text-good-500" />
            Share on WhatsApp
          </a>
        ) : null}
      </div>

      {/* Secondary actions: kept small so the row above stays the focus. */}
      {total > 0 || caseList.length > 0 ? (
        <div className="mb-4 flex flex-wrap items-center gap-1">
          <span className="mr-1 text-xs text-faint">More:</span>
          {total > 0 ? (
            // A file download, not a page - so not a Link.
            <a
              href={`/portal/records/export?truck=${encodeURIComponent(truckNumber)}&range=all`}
              className={buttonClass("ghost", "sm")}
            >
              <Download size={14} />
              Download CSV
            </a>
          ) : null}
          {caseList.length > 0 ? (
            <Modal
              triggerLabel="Add to group"
              triggerIcon={<FolderPlus size={14} />}
              triggerVariant="ghost"
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
        </div>
      ) : (
        <div className="mb-4" />
      )}

      {total === 0 ? (
        <NothingYet error={lastSearch?.ok === false ? friendlyError(lastSearch.error) : null} />
      ) : (
        <>
          {newest ? <LastSeenCard event={newest} /> : null}

          {/* ----------------------------- route ----------------------------- */}
          <Panel className="mb-4" bodyClassName="p-0">
            <div className="border-b border-divider px-4 py-3.5 sm:px-5">
              <InfoTip
                label="About these times"
                info={
                  <p>
                    Times are when the truck crossed the plaza, in IST, newest first. Rahdari keeps
                    every crossing it finds, including ones older than the toll network&apos;s
                    one-week window.
                  </p>
                }
              >
                <h2 className="text-base font-bold text-strong">Route</h2>
              </InfoTip>
            </div>
            <div className="p-4 sm:p-5">
              {eventList.length === 0 ? (
                <EmptyState
                  title="Nothing on this page"
                  description="There are no crossings this far back."
                  action={<LinkButton href={`/portal/search/${truckNumber}`}>Back to the newest</LinkButton>}
                />
              ) : (
                <RouteTimeline
                  events={eventList}
                  olderNeighbour={olderNeighbour}
                  isFirstPage={page === 1}
                />
              )}
            </div>
          </Panel>

          <Pager
            page={page}
            total={total}
            pageSize={PAGE_SIZE}
            noun="crossings on record"
            href={{ path: `/portal/search/${truckNumber}` }}
            className="mb-4"
          />

          {/* ----------------------------- stats ----------------------------- */}
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
            <Stat label="Crossings on record">{fmtNumber(total)}</Stat>
            <Stat label="Plazas">{fmtNumber(plazaCount)}</Stat>
            <Stat label="First seen" sub={oldest ? plazaName(oldest) : undefined}>
              {fmtDate(oldest?.event_time)}
            </Stat>
            <Stat label="Days covered">{daysCovered(oldest, newest)}</Stat>
          </dl>
        </>
      )}
    </>
  );
}

/** The answer to "where is it": the newest crossing, big. */
function LastSeenCard({ event }: { event: TruckEvent }) {
  const state = stateFromLocation(event.loc_name);
  const direction = directionLabel(event.direction);
  const map = mapUrl(event);
  const age = event.event_time ? Date.now() - Date.parse(event.event_time) : null;
  const moving = age !== null && age >= 0 && age < MOVING_WITHIN_MS;
  const quietFor = age !== null ? fmtSpan(age) : null;

  return (
    <section className="mb-4 rounded-xl border border-brand-500/25 bg-brand-500/[0.07] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-brand-500">Last seen</p>
        {moving ? (
          <Badge tone="good">
            <Navigation size={10} />
            On the move
          </Badge>
        ) : quietFor ? (
          <Badge>No crossing for {quietFor}</Badge>
        ) : null}
      </div>

      <p className="mt-1 text-xl leading-snug font-bold break-words text-strong sm:text-2xl">
        {plazaName(event)}
      </p>
      {state ? <p className="text-sm text-muted">{state}</p> : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
        <span className="font-medium text-ink">{fmtRelative(event.event_time)}</span>
        <span className="text-faint">·</span>
        <span>{fmtDateTime(event.event_time)}</span>
        {direction ? (
          <>
            <span className="text-faint">·</span>
            <span>{direction}</span>
          </>
        ) : null}
      </div>

      {map ? (
        <a
          href={map}
          target="_blank"
          rel="noreferrer noopener"
          className={buttonClass("secondary", "sm", "mt-3")}
        >
          <MapPin size={14} />
          Map
          <ExternalLink size={11} className="text-faint" />
        </a>
      ) : null}
    </section>
  );
}

function NothingYet({ error }: { error: string | null }) {
  return (
    <Panel>
      <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
        <span
          aria-hidden
          className="pop-in mb-1 inline-flex size-14 items-center justify-center rounded-full bg-mint text-brand-600 ring-8 ring-mint/40"
        >
          <MapPin size={24} strokeWidth={1.9} />
        </span>
        <p className="text-[15px] font-semibold text-strong">No crossings on record yet</p>
        <p className="max-w-md text-sm text-muted">
          {error ??
            "The toll network shares about the last week of crossings, so a truck that has not passed a plaza recently shows nothing."}
        </p>
        <ul className="mt-3 w-full max-w-sm space-y-2 text-left text-sm text-muted">
          <Tip>Check that the number is correct.</Tip>
          <Tip>Save it, then check again later.</Tip>
          <Tip>Track it to have it checked automatically.</Tip>
        </ul>
      </div>
    </Panel>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-2 rounded-lg border border-line bg-raised/60 px-3 py-2">
      <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand-500" />
      <span>{children}</span>
    </li>
  );
}

function Stat({ label, sub, children }: { label: string; sub?: string; children: ReactNode }) {
  return (
    <div className="min-w-0 bg-panel px-4 py-3">
      <dt className="text-xs font-semibold text-muted">{label}</dt>
      <dd className="mt-1 min-w-0">
        <span className={cx("block truncate text-base font-bold tabular-nums text-strong")}>
          {children}
        </span>
        {sub ? <span className="mt-0.5 block truncate text-xs text-muted">{sub}</span> : null}
      </dd>
    </div>
  );
}

/** Calendar days (IST) from the first crossing to the newest, both included. */
function daysCovered(oldest: TruckEvent | null, newest: TruckEvent | null): string {
  if (!oldest || !newest) return "--";
  const a = istDayKey(oldest.event_time);
  const b = istDayKey(newest.event_time);
  if (a === "unknown" || b === "unknown") return "--";
  const span = msBetween(`${b}T00:00:00Z`, `${a}T00:00:00Z`);
  if (span === null) return "--";
  return fmtNumber(Math.round(span / 86_400_000) + 1);
}
