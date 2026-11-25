import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ExternalLink, History, MessageCircle, Navigation, Phone } from "lucide-react";

import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { Field, Input } from "@/components/form";
import { buttonClass } from "@/components/ui";
import {
  driverLinkText,
  driverShareLink,
  loadDriver,
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
  customFieldsOf,
  destinationText,
  driverSignal,
  fmtIst,
  mapsHref,
  osmEmbed,
  prettyVehicle,
  tripTitle,
} from "@/lib/live/shared";
import { formatIndianMobile, indianMobileDigits } from "@/lib/phone";

import { archiveDriver, deleteDriver, newDriverLink, restoreDriver, resumeDriverSharing, saveDriver, stopDriverSharing } from "../../actions";
import { BackLink } from "../../BackLink";
import { DriverSignalPill, KindChip, TripCard } from "../../parts";
import { CustomFieldsEditor } from "../../ui";
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

  const [{ rows }, places, trips, profile] = await Promise.all([
    loadDriverBoard(live.ownerId),
    loadPlaces(live.ownerId, { includeArchived: true }),
    loadDriverTrips(live.ownerId, driver.id, 10),
    loadLiveProfile(live.ownerId),
  ]);
  const byId = placeMap(places);
  const me = rows.find((r) => r.driver.id === driver.id);
  const vehicle = me?.vehicle ?? null;
  const trip = me?.trip ?? null;
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

      {/* TRIP (assignment happens only inside a trip) */}
      <section className="panel p-3">
        <h2 className="live-h2">Current trip</h2>
        {trip ? (
          <div className="mt-2">
            <TripCard trip={trip} places={byId} now={now} />
            {vehicle ? <p className="mt-1 text-xs text-muted">Truck on this trip: <span className="font-mono">{prettyVehicle(vehicle.number)}</span></p> : null}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted">No open trip. Pick him on a trip; his link is reused.</p>
        )}
      </section>

      <div className="live-acc">
        <details name="driver">
          <summary>
            <strong>Recent trips</strong>
            <span className="live-acc-count">{trips.length}</span>
          </summary>
          <div className="live-acc-body space-y-2">
            {trips.length ? trips.map((t) => <TripCard key={t.id} trip={t} places={byId} now={now} />) : <p className="live-empty">No trips yet.</p>}
          </div>
        </details>

        <Link href={`/portal/profile/live/activity?tab=drivers&id=${driver.id}`} className="live-acc-link">
          <History size={15} /> <strong>Activity by day</strong> <small>in Profile</small> <ChevronRight size={15} />
        </Link>

        <details name="driver">
          <summary>
            <strong>Driver details</strong>
            <small>name, mobile, your fields</small>
          </summary>
          <div className="live-acc-body">
            <ActionForm action={saveDriver} closeOnSuccess={false} refresh={false}>
              <input type="hidden" name="id" value={driver.id} />
              <div className="live-form-grid">
                <Field label="Name" name="name" required>
                  <Input name="name" required defaultValue={driver.name} />
                </Field>
                <Field label="Mobile" name="phone">
                  <Input name="phone" inputMode="tel" defaultValue={indianMobileDigits(driver.phone) ?? ""} />
                </Field>
              </div>
              <p className="field-label mt-3">Your fields</p>
              <CustomFieldsEditor initial={customFieldsOf(driver.custom_fields)} />
              <div className="mt-3">
                <SubmitButton size="sm">Save</SubmitButton>
              </div>
            </ActionForm>
          </div>
        </details>

        <details name="driver">
          <summary>
            <strong>{archived ? "Restore or delete" : "Archive or delete"}</strong>
          </summary>
          <div className="live-acc-body flex flex-wrap items-start gap-2">
            {archived ? (
              <ActionForm action={restoreDriver} closeOnSuccess={false} refresh={false}>
                <input type="hidden" name="id" value={driver.id} />
                <SubmitButton variant="secondary" size="sm">
                  Restore
                </SubmitButton>
              </ActionForm>
            ) : (
              <ActionForm action={archiveDriver} closeOnSuccess={false} refresh={false}>
                <input type="hidden" name="id" value={driver.id} />
                <ConfirmSubmitButton message={`Archive ${driver.name}? His link stops; trips and history stay. You can restore him.`} variant="secondary">
                  Archive
                </ConfirmSubmitButton>
              </ActionForm>
            )}
            <ActionForm action={deleteDriver} closeOnSuccess={false} refresh={false}>
              <input type="hidden" name="id" value={driver.id} />
              <ConfirmSubmitButton message={`Delete ${driver.name} for good? His link stops. Old trips keep his name and mobile. This cannot be undone.`}>
                Delete
              </ConfirmSubmitButton>
            </ActionForm>
            <p className="w-full text-xs text-muted">Not allowed while he is on an Active trip.</p>
          </div>
        </details>
      </div>
    </div>
  );
}
