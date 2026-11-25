import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Copy, ExternalLink, MessageCircle, Navigation, Pencil, Sparkles, UserRound } from "lucide-react";

import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { buttonClass, cx } from "@/components/ui";
import { explainDelay, explainDelayBasic, type TripDelayFacts } from "@/lib/live-ai";
import {
  customerShareText,
  destinationPoint,
  driverLinkText,
  driverShareLink,
  loadDriver,
  loadLiveProfile,
  loadPlaces,
  loadTrail,
  loadTrip,
  loadTripEvents,
  ownerLabelFrom,
  placeMap,
  requireLiveSession,
  trackLink,
  waHref,
} from "@/lib/live/server";
import {
  DIRECTION_LABEL,
  NEXT_STATUSES,
  PARTY_TYPE_LABEL,
  PURPOSE_LABEL,
  tripDirection,
  STATUS_LABEL,
  agoShort,
  destinationText,
  directionsHref,
  fmtIst,
  inr,
  mapsHref,
  osmEmbed,
  prettyEway,
  prettyVehicle,
  recentAvgKmph,
  signalState,
  tripNo,
  tripPhase,
  tripTitle,
  untilShort,
  type LiveTrip,
  type TripStatus,
} from "@/lib/live/shared";
import { formatIndianMobile } from "@/lib/phone";

import { addTripNote, deleteTrip, setCustomerLink, setTripStatus } from "../../actions";
import { BackLink } from "../../BackLink";
import { ActivityList, DriverSignalPill, KindChip, SignalPill, StatusPill, tripIssues } from "../../parts";
import { AutoRefresh, CopyButton } from "../../widgets";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  void params;
  return { title: "Live tracking - Trip" };
}

const ACTION_LABEL: Record<TripStatus, string> = {
  planned: "Back to planned",
  loading: "Loading",
  in_transit: "Start trip / in transit",
  arrived: "Arrived",
  delivered: "Delivered",
  cancelled: "Cancel trip",
};

async function DelayNote({ facts }: { facts: TripDelayFacts }) {
  const text = (await explainDelay(facts).catch(() => null)) ?? explainDelayBasic(facts);
  return (
    <p className="live-delay-note">
      <Sparkles size={15} className="mt-0.5 shrink-0" /> <span>{text}</span>
    </p>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="live-dl-row">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function hidden(trip: LiveTrip) {
  return <input type="hidden" name="id" value={trip.id} />;
}

export default async function TripPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const live = await requireLiveSession();
  const trip = await loadTrip(live.ownerId, id);
  if (!trip) notFound();

  const [places, events, trail, driver, profile] = await Promise.all([
    loadPlaces(live.ownerId, { includeArchived: true }),
    loadTripEvents(trip.id),
    loadTrail(trip.id),
    trip.driver_id ? loadDriver(live.ownerId, trip.driver_id) : Promise.resolve(null),
    loadLiveProfile(live.ownerId),
  ]);
  const byId = placeMap(places);
  const from = trip.from_place_id ? byId.get(trip.from_place_id) : null;
  const to = trip.to_place_id ? byId.get(trip.to_place_id) : null;
  const toText = destinationText(trip, to?.name);
  const dest = destinationPoint(trip, to);
  const now = Date.now();
  const open = !["delivered", "cancelled"].includes(trip.status);
  const pos = trip.last_lat != null && trip.last_lng != null ? { lat: trip.last_lat, lng: trip.last_lng } : null;
  const issues = tripIssues(trip, now);
  const late = issues.some((i) => i.key === "late");
  const signal = signalState(trip, now);
  const ownerLabel = ownerLabelFrom(live.session, profile);
  const direction = tripDirection(trip);
  const fromText =
    from?.name ??
    ([trip.party_name, trip.from_name && trip.from_name !== trip.party_name ? trip.from_name : null].filter(Boolean).join(" · ") || null);
  const phase = tripPhase(trip.status);

  // Driver-first (0081): the trip uses the DRIVER's own link.
  const dLink = driver ? driverShareLink(driver) : null;
  const driverWa =
    driver && dLink
      ? waHref(driver.phone, driverLinkText(driver, ownerLabel, { title: tripTitle(trip), toText, truck: prettyVehicle(trip.vehicle_no) || null }))
      : null;
  const customerWa = trip.track_token ? waHref(trip.consignee_phone ?? to?.contact_phone, customerShareText(trip, ownerLabel)) : null;

  const delayFacts: TripDelayFacts = {
    vehicleNo: prettyVehicle(trip.vehicle_no),
    fromPlace: from?.name,
    toPlace: toText,
    promisedAt: trip.promised_delivery_at ?? undefined,
    etaAt: trip.eta_at ?? undefined,
    distanceLeftKm: trip.distance_left_km ?? undefined,
    avgSpeedKmph: recentAvgKmph(trail, now),
    recentSpeedsKmph: trail
      .slice(0, 16)
      .reverse()
      .map((p) => p.speed_kmh ?? 0),
    lastSeenMinutesAgo: trip.last_point_at ? Math.round((now - new Date(trip.last_point_at).getTime()) / 60000) : undefined,
    notes: issues.filter((i) => i.key.startsWith("eway")).map((i) => i.text),
  };

  return (
    <div className="live-page mx-auto max-w-4xl space-y-4">
      {open ? <AutoRefresh ms={30_000} /> : null}
      <BackLink href="/live/trips" label="Trips" />

      <header className="live-trip-head">
        <div className="min-w-0">
          <p className="live-trip-no">
            <span className={`live-dir live-dir-${direction}`}>{DIRECTION_LABEL[direction]}</span>{" "}
            {trip.purpose ? `${PURPOSE_LABEL[trip.purpose].split(" (")[0]} · ` : ""}
            {trip.vehicle_no ? prettyVehicle(trip.vehicle_no) : "No truck"}
            {trip.invoice_no ? ` · Invoice ${trip.invoice_no}` : ""}
          </p>
          <h1>{tripTitle(trip)}</h1>
          <p className="live-trip-route-lg">
            {fromText ? <span>{fromText}</span> : null}
            {fromText ? <span aria-hidden> → </span> : null}
            <strong>{toText}</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={trip.status} />
          <SignalPill trip={trip} now={now} />
        </div>
      </header>

      {sp.created && dLink ? (
        <section className="live-callout">
          <strong>Trip created. Send {driver?.name ?? "the driver"} his link.</strong>
          <p>He opens it and taps Start sharing - you see the truck here. No app needed.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {driverWa ? (
              <a href={driverWa} target="_blank" rel="noopener noreferrer" className="live-cta live-cta-sm live-cta-wa">
                <MessageCircle size={15} /> Send on WhatsApp
              </a>
            ) : null}
            <CopyButton value={dLink} />
          </div>
        </section>
      ) : null}

      {!trip.driver_id && open ? (
        <section className="live-callout">
          <strong>Add the driver to start tracking.</strong>
          <p>
            {direction === "incoming"
              ? "Type the supplier's driver name and mobile. He gets a link on WhatsApp - no app needed."
              : "Pick your driver. He gets his link on WhatsApp, taps Start sharing, and you see the truck here."}
          </p>
          <Link href={`/live/trips/${trip.id}/edit`} className="live-cta live-cta-sm mt-2 inline-flex">
            <UserRound size={14} /> Add driver
          </Link>
        </section>
      ) : null}

      {issues.length ? (
        <div className="flex flex-wrap gap-2">
          {issues.map((i) => (
            <span key={i.key} className={cx("live-issue live-issue-lg", i.tone === "bad" ? "live-issue-bad" : "live-issue-warn")}>
              {i.text}
            </span>
          ))}
        </div>
      ) : null}
      {late ? (
        <Suspense fallback={null}>
          <DelayNote facts={delayFacts} />
        </Suspense>
      ) : null}

      {/* Where is it */}
      <section className="panel overflow-hidden">
        {pos ? (
          <div className="live-map-frame live-map-lg">
            <iframe title="Truck position" src={osmEmbed(pos, open ? dest : null)} loading="lazy" referrerPolicy="no-referrer" />
          </div>
        ) : (
          <div className="live-map-empty">
            <Navigation size={22} />
            <p>
              {signal === "waiting"
                ? "Waiting for the driver to open the link and tap Start sharing."
                : signal === "off"
                  ? "The driver link is off."
                  : "No position yet."}
            </p>
          </div>
        )}
        <dl className="live-stats">
          <div>
            <dt>Last position</dt>
            <dd>{trip.last_point_at ? agoShort(trip.last_point_at, now) : "-"}</dd>
          </div>
          <div>
            <dt>Speed</dt>
            <dd>{trip.last_speed_kmh != null && open ? `${Math.round(trip.last_speed_kmh)} km/h` : "-"}</dd>
          </div>
          <div>
            <dt>Distance left</dt>
            <dd>{open && trip.distance_left_km != null ? `~${Math.round(trip.distance_left_km)} km` : "-"}</dd>
          </div>
          <div>
            <dt>ETA</dt>
            <dd>{open && trip.eta_at && trip.status === "in_transit" ? fmtIst(trip.eta_at) : trip.status === "arrived" ? "Arrived" : "-"}</dd>
          </div>
        </dl>
        {pos || dest ? (
          <div className="flex flex-wrap gap-2 border-t border-divider p-3">
            {pos ? (
              <a href={mapsHref(pos.lat, pos.lng)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                <ExternalLink size={15} /> Open in Maps
              </a>
            ) : null}
            {dest ? (
              <a href={directionsHref(dest.lat, dest.lng)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
                <Navigation size={15} /> Destination
              </a>
            ) : (
              <span className="self-center text-xs text-muted">Add the destination's location for distance and ETA.</span>
            )}
          </div>
        ) : null}
        {open && !dest ? <p className="px-4 pb-3 text-xs text-muted">Distance and ETA need the destination's location (edit the trip or the customer place).</p> : null}
      </section>

      {/* Status */}
      <section className="panel p-4">
        <h2 className="live-h2">Update status</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {NEXT_STATUSES[trip.status]
            .filter((s) => s !== "delivered")
            .map((s) => (
              <ActionForm key={s} action={setTripStatus} closeOnSuccess={false}>
                {hidden(trip)}
                <input type="hidden" name="status" value={s} />
                {s === "cancelled" ? (
                  <ConfirmSubmitButton message="Cancel this trip? It stays in your records. Your own drivers keep their link; a receiving-trip driver's link stops after the set hours." size="md">
                    {ACTION_LABEL[s]}
                  </ConfirmSubmitButton>
                ) : (
                  <SubmitButton variant={s === "in_transit" || s === "arrived" ? "primary" : "secondary"}>{ACTION_LABEL[s]}</SubmitButton>
                )}
              </ActionForm>
            ))}
        </div>
        {NEXT_STATUSES[trip.status].includes("delivered") ? (
          <ActionForm action={setTripStatus} closeOnSuccess={false} className="mt-3">
            {hidden(trip)}
            <input type="hidden" name="status" value="delivered" />
            <div className="flex flex-col gap-2 sm:flex-row">
              <input name="note" maxLength={500} placeholder="Delivery note (received by, shortage, damage) - optional" className="field flex-1" />
              <SubmitButton>Mark delivered</SubmitButton>
            </div>
          </ActionForm>
        ) : null}
        {trip.pod_note ? <p className="mt-3 text-sm text-ink">Delivery note: {trip.pod_note}</p> : null}
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        {/* Driver (the phone that is tracked) */}
        <section className="panel p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="live-h2">Driver</h2>
            {driver && driver.kind === "own" ? (
              <Link href={`/live/drivers/${driver.id}`} className="text-xs font-semibold text-brand-600">
                Driver page
              </Link>
            ) : driver ? (
              <span className="text-[11px] text-muted">Trip-only driver</span>
            ) : null}
          </div>
          {driver ? (
            <>
              <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink">
                <strong>{driver.name}</strong>
                {driver.kind === "own" ? <KindChip driver={driver} /> : null}
                {driver.phone ? <a href={`tel:${driver.phone}`} className="text-muted">{formatIndianMobile(driver.phone)}</a> : null}
              </p>
              <p className="mt-1">
                <DriverSignalPill driver={driver} now={now} />
              </p>
              {open && dLink ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {driverWa ? (
                    <a href={driverWa} target="_blank" rel="noopener noreferrer" className="live-cta live-cta-sm live-cta-wa">
                      <MessageCircle size={15} /> WhatsApp link
                    </a>
                  ) : null}
                  <CopyButton value={dLink} />
                </div>
              ) : null}
            </>
          ) : (
            <p className="mt-1 text-sm text-muted">{trip.driver_name || "No driver"} · {signal === "off" ? "link off" : "no driver record"}</p>
          )}
        </section>

        {/* Customer link */}
        <section className="panel p-4">
          <h2 className="live-h2">Customer tracking link</h2>
          <p className="mt-1 text-sm text-muted">Read-only: truck position, status and ETA. No invoice value, no driver number.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {trip.track_token ? (
              <>
                {customerWa ? (
                  <a href={customerWa} target="_blank" rel="noopener noreferrer" className="live-cta live-cta-sm live-cta-wa">
                    <MessageCircle size={15} /> WhatsApp
                  </a>
                ) : null}
                <CopyButton value={trackLink(trip.track_token)} />
                <Link href={`/track/${trip.track_token}`} target="_blank" className={buttonClass("ghost", "sm")}>
                  Preview
                </Link>
                <ActionForm action={setCustomerLink} closeOnSuccess={false}>
                  {hidden(trip)}
                  <input type="hidden" name="on" value="0" />
                  <SubmitButton variant="ghost" size="sm">
                    Turn off
                  </SubmitButton>
                </ActionForm>
              </>
            ) : (
              <ActionForm action={setCustomerLink} closeOnSuccess={false}>
                {hidden(trip)}
                <input type="hidden" name="on" value="1" />
                <SubmitButton variant="secondary" size="sm">
                  <Copy size={14} /> Make customer link
                </SubmitButton>
              </ActionForm>
            )}
          </div>
        </section>
      </div>

      {/* Details */}
      <section className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="live-h2">Details</h2>
          {phase !== "closed" ? (
            <Link href={`/live/trips/${trip.id}/edit`} className={buttonClass("secondary", "sm")}>
              <Pencil size={14} /> {phase === "started" ? "Change" : "Edit"}
            </Link>
          ) : null}
        </div>
        <dl className="live-dl mt-2">
          <Row label="Trip">{tripNo(trip.trip_seq)}{trip.trip_name ? ` · ${trip.trip_name}` : ""} (fixed)</Row>
          <Row label="Direction">
            {DIRECTION_LABEL[direction]}
            {trip.party_type ? ` · ${PARTY_TYPE_LABEL[trip.party_type]}` : ""}
          </Row>
          <Row label="Purpose">{trip.purpose ? PURPOSE_LABEL[trip.purpose] : "-"}</Row>
          <Row label="Driver">{trip.driver_name ?? "-"}</Row>
          <Row label="Truck">{trip.vehicle_no ? <span className="font-mono">{prettyVehicle(trip.vehicle_no)}</span> : "-"}</Row>
          <Row label="From">{fromText ?? "-"}</Row>
          <Row label="To">{toText}</Row>
          {trip.from_address ? <Row label="From address">{trip.from_address}</Row> : null}
          {trip.to_address ? <Row label="To address">{trip.to_address}</Row> : null}
          {trip.consignee_name ? <Row label="Contact">{trip.consignee_name}{trip.consignee_phone ? ` · ${formatIndianMobile(trip.consignee_phone)}` : ""}</Row> : null}
          <Row label="Material">
            {[trip.material, trip.quantity != null ? `${trip.quantity} ${trip.quantity_unit ?? ""}`.trim() : null, trip.weight_kg != null ? `${trip.weight_kg} kg` : null]
              .filter(Boolean)
              .join(" · ") || "-"}
          </Row>
          <Row label="Invoice">{[trip.invoice_no, trip.invoice_value_inr != null ? inr(trip.invoice_value_inr) : null].filter(Boolean).join(" · ") || "-"}</Row>
          <Row label="E-way bill">
            {trip.eway_bill_no ? <span className="font-mono">{prettyEway(trip.eway_bill_no)}</span> : "-"}
            {trip.eway_valid_until ? ` · valid till ${fmtIst(trip.eway_valid_until)} (${untilShort(trip.eway_valid_until, now)})` : ""}
          </Row>
          <Row label="LR / bilty">{trip.lr_no ?? "-"}</Row>
          <Row label="Transporter">{trip.transporter ?? "-"}</Row>
          {trip.freight_inr != null ? <Row label="Freight">{inr(trip.freight_inr)}</Row> : null}
          <Row label="Planned start">{fmtIst(trip.planned_dispatch_at)}</Row>
          <Row label="Expected arrival">{fmtIst(trip.promised_delivery_at)}</Row>
          {trip.started_at ? <Row label="Started">{fmtIst(trip.started_at)}</Row> : null}
          {trip.arrived_at ? <Row label="Arrived">{fmtIst(trip.arrived_at)}</Row> : null}
          {trip.delivered_at ? <Row label="Delivered">{fmtIst(trip.delivered_at)}</Row> : null}
          {trip.notes ? <Row label="Notes">{trip.notes}</Row> : null}
        </dl>
      </section>

      {/* Timeline */}
      <section className="panel p-4">
        <h2 className="live-h2">Activity log</h2>
        <p className="text-xs text-muted">Every change: who, when, old → new. Kept after the trip closes.</p>
        <ActionForm action={addTripNote} closeOnSuccess={false} resetOnSuccess className="mt-3">
          {hidden(trip)}
          <div className="flex gap-2">
            <input name="note" maxLength={500} placeholder="Add a note (call with driver, toll, etc.)" className="field min-w-0 flex-1" />
            <SubmitButton variant="secondary">Add</SubmitButton>
          </div>
        </ActionForm>
        <div className="mt-4">
          <ActivityList events={events} />
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-2 pb-4">
        <Link href={`/live/trips/new?copy=${trip.id}`} className={buttonClass("secondary", "sm")}>
          Same route again
        </Link>
        {trip.status === "planned" && !trip.started_at && !trip.last_point_at ? (
          <ActionForm action={deleteTrip} closeOnSuccess={false}>
            {hidden(trip)}
            <ConfirmSubmitButton message={`Delete ${tripNo(trip.trip_seq)}? It never started. This cannot be undone.`}>Delete trip</ConfirmSubmitButton>
          </ActionForm>
        ) : null}
        <span className="text-xs text-muted">Status now: {STATUS_LABEL[trip.status]}</span>
      </section>
    </div>
  );
}
