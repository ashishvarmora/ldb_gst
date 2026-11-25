import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, History, ListChecks, Navigation, Pencil, Phone } from "lucide-react";

import {
  driverLinkText,
  driverShareLink,
  loadDriver,
  loadDriverOpenTrip,
  loadLiveProfile,
  loadPlaces,
  ownerLabelFrom,
  placeMap,
  requireLiveSession,
  waHref,
} from "@/lib/live/server";
import { agoShort, customFieldsOf, destinationText, driverSignal, fmtIst, mapsHref, osmEmbed, prettyVehicle, tripTitle } from "@/lib/live/shared";
import { formatIndianMobile } from "@/lib/phone";

import { BackLink } from "../../BackLink";
import { DriverLinkActions } from "../../blocks";
import { DriverSignalPill, InfoTip, KindChip, TripCard } from "../../parts";
import { AutoRefresh, CopyButton } from "../../widgets";

export const metadata = { title: "Live tracking - Driver" };
export const dynamic = "force-dynamic";

/**
 * v5 driver page: who he is and where he is now. Nothing else.
 * Trips -> /live/history?driver=, events -> /live/activity?driver=, edit / archive / delete -> Masters.
 */
export default async function DriverPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string; reused?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const live = await requireLiveSession();
  const driver = await loadDriver(live.ownerId, id);
  if (!driver) notFound();

  const [places, trip, profile] = await Promise.all([
    loadPlaces(live.ownerId, { includeArchived: true }),
    loadDriverOpenTrip(live.ownerId, driver.id),
    loadLiveProfile(live.ownerId),
  ]);
  const byId = placeMap(places);
  const now = Date.now();
  const signal = driverSignal(driver, now);
  const archived = Boolean(driver.archived_at);
  const link = driverShareLink(driver);
  const toText = trip ? destinationText(trip, trip.to_place_id ? byId.get(trip.to_place_id)?.name : null) : null;
  const wa = link
    ? waHref(driver.phone, driverLinkText(driver, ownerLabelFrom(live.session, profile), trip ? { title: tripTitle(trip), toText, truck: prettyVehicle(trip.vehicle_no) || null } : null))
    : null;
  const pos = driver.last_lat != null && driver.last_lng != null ? { lat: driver.last_lat, lng: driver.last_lng } : null;
  const linkOn = !archived && signal !== "off" && signal !== "expired";
  const cf = customFieldsOf(driver.custom_fields);

  const emptyText: Record<string, string> = {
    waiting: "Link not opened yet. Send it on WhatsApp; he taps Start sharing.",
    stopped: "He stopped sharing. Call him, or send the same link again.",
    expired: "Sharing ended (temporary driver, trip done).",
    off: "His link is switched off.",
  };

  return (
    <div className="live-page mx-auto max-w-2xl space-y-3">
      {linkOn ? <AutoRefresh ms={30_000} /> : null}
      <BackLink href="/live/masters/drivers" label="Drivers" />

      <header className="live-driver-head">
        <div className="min-w-0">
          <h1 className="truncate">{driver.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <KindChip driver={driver} />
            <DriverSignalPill driver={driver} now={now} />
            {archived ? <span className="live-kind">Archived</span> : null}
          </div>
        </div>
        <div className="live-ibar">
          {driver.phone ? (
            <a href={`tel:${driver.phone}`} className="live-ib" aria-label={`Call ${driver.name}`} title={formatIndianMobile(driver.phone)}>
              <Phone size={15} />
            </a>
          ) : null}
          {driver.kind === "own" ? (
            <Link href={`/live/masters/drivers?edit=${driver.id}`} className="live-ib" aria-label="Edit driver" title="Edit driver">
              <Pencil size={15} />
            </Link>
          ) : null}
        </div>
      </header>

      {sp.sent && link && linkOn ? (
        <section className="live-callout">
          <strong>{sp.reused ? "This mobile was already saved - using that driver. " : ""}Now send him his link.</strong>
          <p>He opens it and taps Start sharing. No app needed.</p>
          <div className="mt-2">
            <CopyButton value={link} />
          </div>
        </section>
      ) : null}

      {/* INFO + STATUS */}
      <section className="panel overflow-hidden">
        {pos ? (
          <div className="live-map-frame">
            <iframe title={`${driver.name} location`} src={osmEmbed(pos)} loading="lazy" referrerPolicy="no-referrer" />
            <a href={mapsHref(pos.lat, pos.lng)} target="_blank" rel="noopener noreferrer" className="live-map-open">
              <ExternalLink size={13} /> Maps
            </a>
          </div>
        ) : (
          <div className="live-map-empty">
            <Navigation size={20} />
            <p>{emptyText[signal] ?? "No location yet."}</p>
          </div>
        )}
        <dl className="live-dl live-dl-tight px-3 py-2">
          <div className="live-dl-row">
            <dt>Mobile</dt>
            <dd>{driver.phone ? formatIndianMobile(driver.phone) : "-"}</dd>
          </div>
          <div className="live-dl-row">
            <dt>Last seen</dt>
            <dd suppressHydrationWarning>
              {driver.share_last_seen_at ? agoShort(driver.share_last_seen_at, now) : "-"}
              {driver.last_speed_kmh != null && signal === "live" ? ` · ${Math.round(driver.last_speed_kmh)} km/h` : ""}
            </dd>
          </div>
          {driver.kind === "one_time" ? (
            <div className="live-dl-row">
              <dt>Link ends</dt>
              <dd>{driver.share_expires_at ? fmtIst(driver.share_expires_at) : `${profile.one_time_expire_hours} h after his trip is done`}</dd>
            </div>
          ) : null}
          {cf.map(([k, v]) => (
            <div key={k} className="live-dl-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
        {signal === "idle" ? <p className="live-warn mx-3 mb-3">No location for 30+ min: phone off, no network, or the page was closed. Call him.</p> : null}
      </section>

      {/* LINK */}
      {!archived ? (
        <section className="panel p-3">
          <p className="live-mini-label flex items-center gap-1">
            Tracking link
            <InfoTip label="About the driver link">
              {driver.kind === "own"
                ? "His personal link, the same for all his trips. Positions go to his Active trip (else his oldest Planned one). A new link stops the old one at once."
                : "A temporary driver's link works for this one trip and stops after the trip ends."}
            </InfoTip>
          </p>
          <div className="mt-1.5">
            <DriverLinkActions driver={driver} link={link} wa={wa} />
          </div>
        </section>
      ) : null}

      {/* CURRENT TRIP */}
      <section className="space-y-1.5">
        <p className="live-mini-label">Current trip</p>
        {trip ? <TripCard trip={trip} places={byId} now={now} /> : <p className="live-empty">No open trip. Pick him on a trip; his link is reused.</p>}
      </section>

      <nav className="live-linkrow" aria-label="More about this driver">
        <Link href={`/live/history?driver=${driver.id}&range=all`}>
          <ListChecks size={14} /> Past trips
        </Link>
        <Link href={`/live/activity?driver=${driver.id}`}>
          <History size={14} /> Activity
        </Link>
        <Link href={`/live/activity?driver=${driver.id}&view=day`}>
          <History size={14} /> By day
        </Link>
      </nav>
    </div>
  );
}
