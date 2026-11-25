import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Copy, ExternalLink, MessageCircle, Navigation, Pencil, Sparkles } from "lucide-react";

import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { buttonClass, cx } from "@/components/ui";
import { explainDelay, explainDelayBasic, type TripDelayFacts } from "@/lib/live-ai";
import {
  customerShareText,
  destinationPoint,
  driverInviteText,
  driverLink,
  loadPlaces,
  loadTrail,
  loadTrip,
  loadTripEvents,
  ownerLabelOf,
  placeMap,
  requireLiveSession,
  trackLink,
  waHref,
} from "@/lib/live/server";
import {
  NEXT_STATUSES,
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
  untilShort,
  type LiveTrip,
  type TripStatus,
} from "@/lib/live/shared";
import { formatIndianMobile } from "@/lib/phone";

import {
  addTripNote,
  deleteTrip,
  duplicateTrip,
  resetDriverLink,
  setCustomerLink,
  setTripStatus,
  stopDriverLink,
} from "../../actions";
import { BackLink } from "../../BackLink";
import { SignalPill, StatusPill, tripIssues } from "../../parts";
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

  const [places, events, trail] = await Promise.all([loadPlaces(live.ownerId, { includeArchived: true }), loadTripEvents(trip.id), loadTrail(trip.id)]);
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
  const ownerLabel = ownerLabelOf(live.session);

  const driverWa = trip.driver_token ? waHref(trip.driver_phone, driverInviteText(trip, ownerLabel, toText)) : null;
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
            {tripNo(trip.trip_seq)}
            {trip.invoice_no ? ` · Invoice ${trip.invoice_no}` : ""}
          </p>
          <h1 className="font-mono">{prettyVehicle(trip.vehicle_no) || "No vehicle yet"}</h1>
          <p className="live-trip-route-lg">
            {from ? <span>{from.name}</span> : null}
            {from ? <span aria-hidden> → </span> : null}
            <strong>{toText}</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={trip.status} />
          <SignalPill trip={trip} now={now} />
        </div>
      </header>

      {sp.created && trip.driver_token ? (
        <section className="live-callout">
          <strong>Trip created. Now send the tracking link to the driver.</strong>
          <p>He opens it, taps Start sharing - you see the truck here. No app needed.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {driverWa ? (
              <a href={driverWa} target="_blank" rel="noopener noreferrer" className="live-cta live-cta-sm live-cta-wa">
                <MessageCircle size={15} /> Send on WhatsApp
              </a>
            ) : null}
            <CopyButton value={driverLink(trip.driver_token)} />
          </div>
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
                  <ConfirmSubmitButton message="Cancel this trip? The driver link stops working." size="md">
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
        {/* Driver link */}
        <section className="panel p-4">
          <h2 className="live-h2">Driver GPS link</h2>
          <p className="mt-1 text-sm text-muted">
            {trip.driver_name || "Driver"}
            {trip.driver_phone ? ` · ${formatIndianMobile(trip.driver_phone)}` : " · no mobile saved"}
          </p>
          <p className="mt-1 text-sm text-ink">
            {
              {
                live: "Sharing now.",
                recent: `Last heard ${agoShort(trip.share_last_seen_at ?? trip.last_point_at, now)}.`,
                waiting: "Sent, not opened yet.",
                stopped: "The driver stopped sharing. Call him or send the link again.",
                off: "Link is off.",
              }[signal]
            }
          </p>
          {open ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {trip.driver_token && trip.share_status !== "revoked" ? (
                <>
                  {driverWa ? (
                    <a href={driverWa} target="_blank" rel="noopener noreferrer" className="live-cta live-cta-sm live-cta-wa">
                      <MessageCircle size={15} /> WhatsApp
                    </a>
                  ) : null}
                  <CopyButton value={driverLink(trip.driver_token)} />
                  <ActionForm action={stopDriverLink} closeOnSuccess={false}>
                    {hidden(trip)}
                    <ConfirmSubmitButton message="Stop the driver link? It stops working at once." size="sm">
                      Stop link
                    </ConfirmSubmitButton>
                  </ActionForm>
                </>
              ) : null}
              <ActionForm action={resetDriverLink} closeOnSuccess={false}>
                {hidden(trip)}
                <SubmitButton variant="secondary" size="sm">
                  {trip.share_status === "revoked" ? "Turn link back on" : "New link"}
                </SubmitButton>
              </ActionForm>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted">Trip closed - the driver link no longer sends positions.</p>
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
          <Link href={`/live/trips/${trip.id}/edit`} className={buttonClass("secondary", "sm")}>
            <Pencil size={14} /> Edit
          </Link>
        </div>
        <dl className="live-dl mt-2">
          <Row label="From">{from?.name ?? "-"}</Row>
          <Row label="To">{toText}</Row>
          {trip.consignee_name ? <Row label="Customer contact">{trip.consignee_name}{trip.consignee_phone ? ` · ${formatIndianMobile(trip.consignee_phone)}` : ""}</Row> : null}
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
          <Row label="Planned dispatch">{fmtIst(trip.planned_dispatch_at)}</Row>
          <Row label="Promised delivery">{fmtIst(trip.promised_delivery_at)}</Row>
          {trip.started_at ? <Row label="Started">{fmtIst(trip.started_at)}</Row> : null}
          {trip.arrived_at ? <Row label="Arrived">{fmtIst(trip.arrived_at)}</Row> : null}
          {trip.delivered_at ? <Row label="Delivered">{fmtIst(trip.delivered_at)}</Row> : null}
          {trip.notes ? <Row label="Notes">{trip.notes}</Row> : null}
        </dl>
      </section>

      {/* Timeline */}
      <section className="panel p-4">
        <h2 className="live-h2">Timeline</h2>
        <ActionForm action={addTripNote} closeOnSuccess={false} resetOnSuccess className="mt-3">
          {hidden(trip)}
          <div className="flex gap-2">
            <input name="note" maxLength={500} placeholder="Add a note (call with driver, toll, etc.)" className="field min-w-0 flex-1" />
            <SubmitButton variant="secondary">Add</SubmitButton>
          </div>
        </ActionForm>
        <ol className="live-timeline mt-4">
          {events.map((e) => (
            <li key={e.id} className={`live-tl-${e.kind}`}>
              <span className="live-tl-dot" aria-hidden />
              <div className="min-w-0">
                <p className="live-tl-title">{e.title}</p>
                {e.detail ? <p className="live-tl-detail">{e.detail}</p> : null}
                <p className="live-tl-when">
                  {fmtIst(e.created_at)} · {e.actor === "owner" ? "You" : e.actor === "driver" ? "Driver" : "Auto"}
                  {e.lat != null && e.lng != null ? (
                    <>
                      {" · "}
                      <a href={mapsHref(e.lat, e.lng)} target="_blank" rel="noopener noreferrer">
                        map
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
            </li>
          ))}
          {events.length === 0 ? <li className="text-sm text-muted">Nothing yet.</li> : null}
        </ol>
      </section>

      <section className="flex flex-wrap gap-2 pb-4">
        <ActionForm action={duplicateTrip} closeOnSuccess={false}>
          {hidden(trip)}
          <SubmitButton variant="secondary" size="sm">
            Same route again
          </SubmitButton>
        </ActionForm>
        <ActionForm action={deleteTrip} closeOnSuccess={false}>
          {hidden(trip)}
          <ConfirmSubmitButton message={`Delete ${tripNo(trip.trip_seq)} with its positions and timeline? This cannot be undone.`}>
            Delete trip
          </ConfirmSubmitButton>
        </ActionForm>
        <span className="self-center text-xs text-muted">Status now: {STATUS_LABEL[trip.status]}</span>
      </section>
    </div>
  );
}
