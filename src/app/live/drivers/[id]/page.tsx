import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, MessageCircle, Navigation, Phone } from "lucide-react";

import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { Field, Input, Select } from "@/components/form";
import { buttonClass } from "@/components/ui";
import {
  driverLinkText,
  driverShareLink,
  loadDriver,
  loadDriverActivity,
  loadDriverBoard,
  loadDriverTrips,
  loadLiveProfile,
  loadPlaces,
  ownerLabelFrom,
  placeMap,
  requireLiveSession,
  waHref,
} from "@/lib/live/server";
import {
  agoShort,
  destinationText,
  driverSignal,
  fmtIst,
  mapsHref,
  osmEmbed,
  prettyVehicle,
  tripTitle,
} from "@/lib/live/shared";
import { formatIndianMobile, indianMobileDigits } from "@/lib/phone";

import {
  archiveDriver,
  assignTruck,
  newDriverLink,
  restoreDriver,
  resumeDriverSharing,
  saveDriver,
  stopDriverSharing,
  unassignTruck,
} from "../../actions";
import { BackLink } from "../../BackLink";
import { ActivityList, DriverSignalPill, KindChip, TripCard } from "../../parts";
import { AutoRefresh, CopyButton } from "../../widgets";

export const metadata = { title: "Live tracking - Driver" };
export const dynamic = "force-dynamic";

export default async function DriverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sent?: string; reused?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const live = await requireLiveSession();
  const driver = await loadDriver(live.ownerId, id);
  if (!driver) notFound();

  const [{ rows, vehicles }, places, activity, trips, profile] = await Promise.all([
    loadDriverBoard(live.ownerId),
    loadPlaces(live.ownerId, { includeArchived: true }),
    loadDriverActivity(driver.id),
    loadDriverTrips(live.ownerId, driver.id),
    loadLiveProfile(live.ownerId),
  ]);
  const byId = placeMap(places);
  const me = rows.find((r) => r.driver.id === driver.id);
  const vehicle = me?.vehicle ?? null;
  const trip = me?.trip ?? null;
  const holder = new Map(rows.filter((r) => r.vehicle).map((r) => [r.vehicle!.id, r.driver.name]));
  const now = Date.now();
  const signal = driverSignal(driver, now);
  const archived = Boolean(driver.archived_at);

  const ownerLabel = ownerLabelFrom(live.session, profile);
  const link = driverShareLink(driver);
  const toText = trip ? destinationText(trip, trip.to_place_id ? byId.get(trip.to_place_id)?.name : null) : null;
  const wa = link
    ? waHref(
        driver.phone,
        driverLinkText(driver, ownerLabel, trip ? { title: tripTitle(trip), toText, truck: prettyVehicle(vehicle?.number ?? trip.vehicle_no) || null } : null),
      )
    : null;
  const pos = driver.last_lat != null && driver.last_lng != null ? { lat: driver.last_lat, lng: driver.last_lng } : null;
  const linkOn = !archived && signal !== "off" && signal !== "expired";

  const emptyText: Record<string, string> = {
    waiting: "Link not opened yet. Send it on WhatsApp; he taps Start sharing.",
    stopped: "The driver stopped sharing. Call him, or send the same link again.",
    expired: "Sharing ended (trip-only driver, trip done).",
    off: "You switched this driver's link off.",
    idle: "No location yet.",
    recent: "No location yet.",
    live: "No location yet.",
  };

  return (
    <div className="live-page mx-auto max-w-3xl space-y-3">
      {linkOn ? <AutoRefresh ms={30_000} /> : null}
      <BackLink href="/live/masters/drivers" label="Drivers" />

      <header className="live-driver-head">
        <div className="min-w-0">
          <h1 className="truncate">{driver.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <KindChip driver={driver} />
            <DriverSignalPill driver={driver} now={now} />
            {archived ? <span className="live-kind">Archived</span> : null}
          </div>
        </div>
        {driver.phone ? (
          <a href={`tel:${driver.phone}`} className={buttonClass("secondary", "sm")} aria-label={`Call ${driver.name}`}>
            <Phone size={15} /> {formatIndianMobile(driver.phone)}
          </a>
        ) : null}
      </header>

      {sp.sent && link && linkOn ? (
        <section className="live-callout">
          <strong>{sp.reused ? "This mobile was already saved - using that driver. " : ""}Now send the link to the driver.</strong>
          <p>He opens it and taps Start sharing. You see his phone&apos;s location here. No app needed.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {wa ? (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="live-cta live-cta-sm live-cta-wa">
                <MessageCircle size={15} /> Send on WhatsApp
              </a>
            ) : null}
            <CopyButton value={link} />
          </div>
        </section>
      ) : null}

      {/* WHERE */}
      <section className="panel overflow-hidden">
        {pos ? (
          <div className="live-map-frame live-map-lg">
            <iframe title={`${driver.name} location`} src={osmEmbed(pos)} loading="lazy" referrerPolicy="no-referrer" />
            <a href={mapsHref(pos.lat, pos.lng)} target="_blank" rel="noopener noreferrer" className="live-map-open">
              <ExternalLink size={13} /> Open in Maps
            </a>
          </div>
        ) : (
          <div className="live-map-empty">
            <Navigation size={22} />
            <p>{emptyText[signal]}</p>
          </div>
        )}
        <dl className="live-stats">
          <div>
            <dt>Last position</dt>
            <dd suppressHydrationWarning>{driver.last_point_at ? agoShort(driver.last_point_at, now) : "-"}</dd>
          </div>
          <div>
            <dt>Last heard</dt>
            <dd suppressHydrationWarning>{driver.share_last_seen_at ? agoShort(driver.share_last_seen_at, now) : "-"}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd>{driver.last_speed_kmh != null && signal === "live" ? `${Math.round(driver.last_speed_kmh)} km/h` : "-"}</dd>
          </div>
          <div>
            <dt>Accuracy</dt>
            <dd>{driver.last_accuracy_m != null ? `± ${Math.round(driver.last_accuracy_m)} m` : "-"}</dd>
          </div>
        </dl>
        {signal === "idle" ? (
          <p className="live-warn m-3">No location for 30+ min - phone off, no network, or the page was closed. Call the driver.</p>
        ) : null}
      </section>

      {/* SHARING */}
      {!archived ? (
        <section className="panel p-4">
          <h2 className="live-h2">Location link</h2>
          <p className="mt-1 text-sm text-muted">
            {driver.kind === "own"
              ? "Our driver: one link for all his trips; shares until he taps Stop."
              : driver.share_expires_at
                ? `Trip-only driver: sharing ends ${fmtIst(driver.share_expires_at)}.`
                : `Trip-only driver: sharing ends ${profile.one_time_expire_hours} h after his trip is done.`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {linkOn && link ? (
              <>
                {wa ? (
                  <a href={wa} target="_blank" rel="noopener noreferrer" className="live-cta live-cta-sm live-cta-wa">
                    <MessageCircle size={15} /> WhatsApp link
                  </a>
                ) : null}
                <CopyButton value={link} />
                <ActionForm action={stopDriverSharing} closeOnSuccess={false} refresh={false}>
                  <input type="hidden" name="driver_id" value={driver.id} />
                  <ConfirmSubmitButton message="Switch this driver's link off? Nothing more is recorded until you switch it on." size="sm">
                    Switch off
                  </ConfirmSubmitButton>
                </ActionForm>
              </>
            ) : (
              <ActionForm action={resumeDriverSharing} closeOnSuccess={false} refresh={false}>
                <input type="hidden" name="driver_id" value={driver.id} />
                <SubmitButton size="sm">Switch link on (same link)</SubmitButton>
              </ActionForm>
            )}
            <ActionForm action={newDriverLink} closeOnSuccess={false} refresh={false}>
              <input type="hidden" name="driver_id" value={driver.id} />
              <ConfirmSubmitButton message="Make a new link? The old link stops working at once." variant="ghost" size="sm">
                New link
              </ConfirmSubmitButton>
            </ActionForm>
          </div>
          <p className="mt-2 text-xs text-muted">Re-invite: send the same link again. Lost phone or link shared by mistake: make a new link.</p>
        </section>
      ) : null}

      {/* TRIP + TRUCK */}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="live-h2">Current trip</h2>

          </div>
          {trip ? (
            <div className="mt-3">
              <TripCard trip={trip} places={byId} now={now} />
            </div>
          ) : (
            <p className="mt-2 text-sm text-muted">No open trip. Pick him on a trip to track a delivery.</p>
          )}
        </section>

        <section className="panel p-4">
          <h2 className="live-h2">Truck</h2>
          <p className="mt-1 text-sm text-ink">
            {vehicle ? <span className="font-mono font-semibold">{prettyVehicle(vehicle.number)}</span> : "No truck assigned."}
          </p>
          {!archived ? (
            <details className="live-more mt-2">
              <summary>{vehicle ? "Change truck" : "Assign a truck"}</summary>
              <ActionForm action={assignTruck} closeOnSuccess={false} refresh={false} className="mt-2 space-y-2">
                <input type="hidden" name="driver_id" value={driver.id} />
                <Select name="vehicle_id" defaultValue="" aria-label="Saved truck">
                  <option value="">Saved truck…</option>
                  {vehicles
                    .filter((v) => v.id !== vehicle?.id)
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {prettyVehicle(v.number)}
                        {holder.get(v.id) ? ` · with ${holder.get(v.id)}` : ""}
                      </option>
                    ))}
                </Select>
                <Link href="/live/masters/trucks?add=1" className="text-xs font-semibold text-brand-600">
                  + Add a new truck in Masters
                </Link>
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" name="force" className="size-4" /> If it is with another driver, move it to {driver.name}
                </label>
                <SubmitButton size="sm">Save truck</SubmitButton>
              </ActionForm>
              {vehicle ? (
                <ActionForm action={unassignTruck} closeOnSuccess={false} refresh={false} className="mt-2">
                  <input type="hidden" name="driver_id" value={driver.id} />
                  <SubmitButton variant="ghost" size="sm">
                    Remove truck
                  </SubmitButton>
                </ActionForm>
              ) : null}
            </details>
          ) : null}
        </section>
      </div>

      {/* ACTIVITY */}
      <section className="panel p-4">
        <h2 className="live-h2">Activity</h2>
        <p className="mb-3 text-xs text-muted">Sharing, location gaps, truck and trip changes, status moves.</p>
        <ActivityList events={activity} showTrip />
      </section>

      {/* HISTORY */}
      {trips.length ? (
        <section className="space-y-2">
          <h2 className="live-h2">Trips ({trips.length})</h2>
          <div className="live-trip-grid">
            {trips.map((t) => (
              <TripCard key={t.id} trip={t} places={byId} now={now} />
            ))}
          </div>
        </section>
      ) : null}

      {/* DETAILS */}
      <details className="panel live-form-block live-more">
        <summary>Driver details</summary>
        <ActionForm action={saveDriver} closeOnSuccess={false} refresh={false} className="mt-3">
          <input type="hidden" name="id" value={driver.id} />
          <div className="live-form-grid">
            <Field label="Name" name="name" required>
              <Input name="name" required defaultValue={driver.name} />
            </Field>
            <Field label="Mobile" name="phone">
              <Input name="phone" inputMode="tel" defaultValue={indianMobileDigits(driver.phone) ?? ""} />
            </Field>
            <Field label="Licence no." name="license_no">
              <Input name="license_no" defaultValue={driver.license_no ?? ""} />
            </Field>
            <Field label="Notes" name="notes">
              <Input name="notes" defaultValue={driver.notes ?? ""} />
            </Field>
          </div>
          <div className="mt-3">
            <SubmitButton size="sm">Save</SubmitButton>
          </div>
        </ActionForm>
        <div className="mt-4 border-t border-divider pt-3">
          {archived ? (
            <ActionForm action={restoreDriver} closeOnSuccess={false} refresh={false}>
              <input type="hidden" name="id" value={driver.id} />
              <SubmitButton variant="secondary" size="sm">
                Restore driver
              </SubmitButton>
            </ActionForm>
          ) : (
            <ActionForm action={archiveDriver} closeOnSuccess={false} refresh={false}>
              <input type="hidden" name="id" value={driver.id} />
              <ConfirmSubmitButton message={`Archive ${driver.name}? His link stops; trips and history stay.`} size="sm">
                Archive driver
              </ConfirmSubmitButton>
              <p className="mt-1 text-xs text-muted">Archived drivers keep all trips and history. You can restore them.</p>
            </ActionForm>
          )}
        </div>
      </details>
    </div>
  );
}
