import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Archive, Copy, ExternalLink, MessageCircle, Navigation, Pencil, Play, Route, Sparkles, Trash2 } from "lucide-react";

import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { buttonClass, cx } from "@/components/ui";
import { explainDelay, explainDelayBasic, type TripDelayFacts } from "@/lib/live-ai";
import { groupByPhase } from "@/lib/live/activity";
import { roadAhead } from "@/lib/live/route";
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
  PARTY_TYPE_LABEL,
  PURPOSE_LABEL,
  STATE_LABEL,
  agoShort,
  destinationText,
  directionsHref,
  etaBasis,
  fmtIst,
  inr,
  mapsHref,
  osmEmbed,
  prettyEway,
  prettyVehicle,
  recentAvgKmph,
  signalState,
  tripDirection,
  tripNo,
  tripState,
  tripTitle,
  untilShort,
  type LiveTrip,
} from "@/lib/live/shared";
import { formatIndianMobile } from "@/lib/phone";

import { addTripNote, archiveTrip, deleteTrip, setCustomerLink, setTripState } from "../../actions";
import { BackLink } from "../../BackLink";
import { DriverSignalPill, InfoTip, PhaseSections, SignalPill, StatePill, tripIssues } from "../../parts";
import { StateBar } from "../../ui";
import { AutoRefresh, CopyButton } from "../../widgets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live tracking - Trip" };

async function DelayNote({ facts }: { facts: TripDelayFacts }) {
  const text = (await explainDelay(facts).catch(() => null)) ?? explainDelayBasic(facts);
  return (
    <p className="live-delay-note">
      <Sparkles size={15} className="mt-0.5 shrink-0" /> <span>{text}</span>
    </p>
  );
}

async function RoadAheadList({ trip, pos, dest, fromName }: { trip: LiveTrip; pos: { lat: number; lng: number }; dest: { lat: number; lng: number; name: string }; fromName: string | null }) {
  const r = await roadAhead(trip, pos, dest, fromName).catch(() => null);
  if (!r) return null;
  return (
    <div className="live-road">
      <p className="live-road-head">
        <Route size={14} /> Road ahead <small>approximate</small>
        <InfoTip label="About the road ahead">
          Major cities between the truck and the destination, worked out {r.source === "ai" ? "by AI" : "from a list of highway hubs"} from the straight line. Refreshed
          only after the truck moves 25+ km ({fmtIst(r.at)}). Not turn-by-turn.
        </InfoTip>
      </p>
      {r.points.length ? (
        <ol className="live-road-list">
          {r.points.map((p) => (
            <li key={`${p.name}-${p.km}`}>
              <span>{p.name}</span>
              <small>~{p.km} km</small>
            </li>
          ))}
          <li className="is-dest">
            <span>{dest.name}</span>
          </li>
        </ol>
      ) : (
        <p className="text-xs text-muted">Short run - no big city on the way.</p>
      )}
    </div>
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

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; sent?: string }> }) {
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
  const state = tripState(trip);
  const open = state === "planned" || state === "active";
  const pos = trip.last_lat != null && trip.last_lng != null ? { lat: trip.last_lat, lng: trip.last_lng } : null;
  const issues = tripIssues(trip, now);
  const late = issues.some((i) => i.key === "late");
  const signal = signalState(trip, now);
  const ownerLabel = ownerLabelFrom(live.session, profile);
  const direction = tripDirection(trip);
  const fromText = from?.name ?? ([trip.party_name, trip.from_name && trip.from_name !== trip.party_name ? trip.from_name : null].filter(Boolean).join(" · ") || null);
  const temp = Boolean(trip.inline_driver);

  const dLink = driver ? driverShareLink(driver) : null;
  const driverWa =
    driver && dLink ? waHref(driver.phone, driverLinkText(driver, ownerLabel, { title: tripTitle(trip), toText, truck: prettyVehicle(trip.vehicle_no) || null })) : null;
  const customerWa = trip.track_token ? waHref(trip.consignee_phone ?? to?.contact_phone, customerShareText(trip, ownerLabel)) : null;
  const basis = etaBasis(trail, trip.distance_left_km, now);
  const phases = groupByPhase(events, trip);

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
  const hidden = <input type="hidden" name="id" value={trip.id} />;
  const sendLink = (sp.created || sp.sent) && dLink && open;

  return (
    <div className="live-page mx-auto max-w-3xl space-y-3">
      {open ? <AutoRefresh ms={30_000} /> : null}
      <BackLink href="/live/trips" label="Home" />

      <header className="live-trip-head">
        <div className="min-w-0">
          <p className="live-trip-no">
            <span className={`live-dir live-dir-${direction}`}>{DIRECTION_LABEL[direction]}</span> {trip.vehicle_no ? prettyVehicle(trip.vehicle_no) : "No truck"}
            {trip.invoice_no ? ` · Inv ${trip.invoice_no}` : ""}
          </p>
          <h1>{tripTitle(trip)}</h1>
          <p className="live-trip-route-lg">
            {fromText ? <span>{fromText} → </span> : null}
            <strong>{toText}</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <StatePill trip={trip} />
          {open ? <SignalPill trip={trip} now={now} /> : null}
          {trip.archived_at ? <span className="live-kind">Archived</span> : null}
        </div>
      </header>

      {sendLink ? (
        <section className="live-callout">
          <strong>{sp.sent ? `Driver is now ${driver?.name}. Send him his link.` : `Send ${driver?.name ?? "the driver"} his link.`}</strong>
          <p>{sp.sent ? "The old driver's location no longer goes to this trip." : "He opens it and taps Start sharing. No app needed."}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {driverWa ? (
              <a href={driverWa} target="_blank" rel="noopener noreferrer" className="live-cta live-cta-sm live-cta-wa">
                <MessageCircle size={15} /> WhatsApp
              </a>
            ) : null}
            <CopyButton value={dLink} />
          </div>
        </section>
      ) : null}

      {/* STATUS */}
      <section className="panel p-3">
        <ActionForm action={setTripState} closeOnSuccess={false} refresh={false}>
          {hidden}
          {state === "planned" ? (
            <button type="submit" name="state" value="active" className="live-cta live-start" disabled={!trip.driver_id}>
              <Play size={16} /> Start trip
            </button>
          ) : null}
          {state === "planned" && !trip.driver_id ? <p className="mt-1 text-xs text-muted">Add a driver to start (tracking follows his phone).</p> : null}
          <div className="mt-2 flex items-center gap-1">
            <StateBar current={state} labels={STATE_LABEL} />
            <InfoTip label="About trip status">
              Planned: set up, not moving. Active: on the road (Start, the driver&apos;s Started button, or leaving the From place). Done: delivered. Cancelled: kept in
              records. You can switch any time; every change is in the activity.
            </InfoTip>
          </div>
          <input name="note" maxLength={500} placeholder="Note with the change (optional; delivery note when Done)" className="field mt-2 w-full text-sm" />
        </ActionForm>
        {trip.pod_note ? <p className="mt-2 text-xs text-ink">Delivery note: {trip.pod_note}</p> : null}
      </section>

      {issues.length ? (
        <div className="flex flex-wrap gap-1.5">
          {issues.map((i) => (
            <span key={i.key} className={cx("live-issue", i.tone === "bad" ? "live-issue-bad" : "live-issue-warn")}>
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

      {/* WHERE */}
      <section className="panel overflow-hidden">
        {pos ? (
          <div className="live-map-frame live-map-lg">
            <iframe title="Truck position" src={osmEmbed(pos, open ? dest : null)} loading="lazy" referrerPolicy="no-referrer" />
            <a href={mapsHref(pos.lat, pos.lng)} target="_blank" rel="noopener noreferrer" className="live-map-open">
              <ExternalLink size={13} /> Maps
            </a>
          </div>
        ) : (
          <div className="live-map-empty">
            <Navigation size={20} />
            <p>{signal === "waiting" ? "Waiting for the driver to open the link and tap Start sharing." : signal === "off" ? "The driver link is off." : "No position yet."}</p>
          </div>
        )}
        <dl className="live-stats">
          <div>
            <dt>Last position</dt>
            <dd suppressHydrationWarning>{trip.last_point_at ? agoShort(trip.last_point_at, now) : "-"}</dd>
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
            <dt className="flex items-center gap-1">
              ETA
              <InfoTip label="How ETA is worked out">
                <span className="block">Distance left = straight line × {basis.roadFactor} (road factor){basis.distanceLeftKm != null ? ` = ~${Math.round(basis.distanceLeftKm)} km` : ""}.</span>
                <span className="block">
                  Speed = average of the last 2 h ({basis.points2h} positions){basis.fallback ? ": too few, so 40 km/h is used" : ""} = {basis.kmph} km/h (kept within 25-55).
                </span>
                {basis.hoursLeft != null ? <span className="block">Time left ≈ {basis.hoursLeft.toFixed(1)} h. Updates with every position.</span> : null}
              </InfoTip>
            </dt>
            <dd>{state === "active" && trip.eta_at && trip.status !== "arrived" ? fmtIst(trip.eta_at) : trip.status === "arrived" ? "Arrived" : "-"}</dd>
          </div>
        </dl>
        {state === "active" && pos && dest ? (
          <Suspense fallback={<p className="px-3 pb-3 text-xs text-muted">Working out the road ahead…</p>}>
            <RoadAheadList trip={trip} pos={pos} dest={{ ...dest, name: toText }} fromName={fromText} />
          </Suspense>
        ) : null}
        <div className="flex flex-wrap gap-2 border-t border-divider p-2.5">
          {dest ? (
            <a href={directionsHref(dest.lat, dest.lng)} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
              <Navigation size={14} /> Destination
            </a>
          ) : trip.to_maps_url ? (
            <a href={trip.to_maps_url} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "sm")}>
              <Navigation size={14} /> Destination link
            </a>
          ) : (
            <span className="self-center text-xs text-muted">Pin the destination on the map for distance and ETA.</span>
          )}
          {open ? (
            <Link href={`/live/trips/${trip.id}/edit`} className={buttonClass("secondary", "sm")}>
              <Pencil size={14} /> {state === "active" ? "Change" : "Edit"}
            </Link>
          ) : null}
        </div>
      </section>

      {/* SECTIONS (one open at a time) */}
      <div className="live-acc">
        <details name="trip" open={(state === "planned" && !sendLink) || undefined}>
          <summary>
            <strong>Driver &amp; links</strong>
            <small>{driver?.name ?? trip.driver_name ?? "No driver"}{temp ? " · temporary" : ""}</small>
          </summary>
          <div className="live-acc-body space-y-3">
            {driver ? (
              <div>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  {driver.kind === "own" ? (
                    <Link href={`/live/drivers/${driver.id}`} className="font-semibold text-brand-600">
                      {driver.name}
                    </Link>
                  ) : (
                    <strong>{driver.name}</strong>
                  )}
                  {driver.phone ? (
                    <a href={`tel:${driver.phone}`} className="text-muted">
                      {formatIndianMobile(driver.phone)}
                    </a>
                  ) : null}
                  <DriverSignalPill driver={driver} now={now} />
                </p>
                {temp ? <p className="mt-1 text-xs text-muted">Temporary driver: link for this trip only, removed 1 h after the trip ends.</p> : null}
                {open && dLink ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {driverWa ? (
                      <a href={driverWa} target="_blank" rel="noopener noreferrer" className="live-cta live-cta-sm live-cta-wa">
                        <MessageCircle size={15} /> Driver link
                      </a>
                    ) : null}
                    <CopyButton value={dLink} />
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted">
                {trip.driver_name ? `${trip.driver_name}${trip.driver_phone ? ` · ${formatIndianMobile(trip.driver_phone)}` : ""} (link ended)` : "No driver yet."}{" "}
                {open ? (
                  <Link href={`/live/trips/${trip.id}/edit`} className="font-semibold text-brand-600">
                    Add driver
                  </Link>
                ) : null}
              </p>
            )}
            <div className="border-t border-divider pt-3">
              <p className="text-xs font-semibold text-strong">
                Customer link{" "}
                <InfoTip label="About the customer link">Read-only page: truck position, status and ETA. No invoice value, no driver number.</InfoTip>
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {trip.track_token ? (
                  <>
                    {customerWa ? (
                      <a href={customerWa} target="_blank" rel="noopener noreferrer" className="live-cta live-cta-sm live-cta-wa">
                        <MessageCircle size={15} /> WhatsApp
                      </a>
                    ) : null}
                    <CopyButton value={trackLink(trip.track_token)} />
                    <ActionForm action={setCustomerLink} closeOnSuccess={false}>
                      {hidden}
                      <input type="hidden" name="on" value="0" />
                      <SubmitButton variant="ghost" size="sm">
                        Turn off
                      </SubmitButton>
                    </ActionForm>
                  </>
                ) : (
                  <ActionForm action={setCustomerLink} closeOnSuccess={false}>
                    {hidden}
                    <input type="hidden" name="on" value="1" />
                    <SubmitButton variant="secondary" size="sm">
                      <Copy size={14} /> Make customer link
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
          </div>
        </details>

        <details name="trip">
          <summary>
            <strong>Details</strong>
            <small>{[trip.material, trip.invoice_no ? `Inv ${trip.invoice_no}` : null].filter(Boolean).join(" · ") || "route, goods, documents"}</small>
          </summary>
          <div className="live-acc-body">
            <dl className="live-dl">
              <Row label="Trip">{tripTitle(trip)} (fixed)</Row>
              <Row label="Direction">
                {DIRECTION_LABEL[direction]}
                {trip.party_type ? ` · ${PARTY_TYPE_LABEL[trip.party_type]}` : ""}
              </Row>
              <Row label="Purpose">{trip.purpose ? PURPOSE_LABEL[trip.purpose] : "-"}</Row>
              <Row label="Driver">{trip.driver_name ?? "-"}{temp ? " (temporary)" : ""}</Row>
              <Row label="Truck">{trip.vehicle_no ? <span className="font-mono">{prettyVehicle(trip.vehicle_no)}</span> : "-"}{trip.vehicle_no && !trip.vehicle_id ? " (temporary)" : ""}</Row>
              <Row label="From">{fromText ?? "-"}{trip.from_address ? `, ${trip.from_address}` : ""}</Row>
              <Row label="To">
                {toText}
                {trip.to_address ? `, ${trip.to_address}` : ""}
              </Row>
              {trip.consignee_name ? (
                <Row label="Contact">
                  {trip.consignee_name}
                  {trip.consignee_phone ? ` · ${formatIndianMobile(trip.consignee_phone)}` : ""}
                </Row>
              ) : null}
              <Row label="Material">
                {[trip.material, trip.quantity != null ? `${trip.quantity} ${trip.quantity_unit ?? ""}`.trim() : null, trip.weight_kg != null ? `${trip.weight_kg} kg` : null]
                  .filter(Boolean)
                  .join(" · ") || "-"}
              </Row>
              <Row label="Invoice">{[trip.invoice_no, trip.invoice_value_inr != null ? inr(trip.invoice_value_inr) : null].filter(Boolean).join(" · ") || "-"}</Row>
              <Row label="E-way bill">
                {trip.eway_bill_no ? <span className="font-mono">{prettyEway(trip.eway_bill_no)}</span> : "-"}
                {trip.eway_valid_until ? ` · till ${fmtIst(trip.eway_valid_until)} (${untilShort(trip.eway_valid_until, now)})` : ""}
              </Row>
              {trip.lr_no ? <Row label="LR / bilty">{trip.lr_no}</Row> : null}
              {trip.transporter ? <Row label="Transporter">{trip.transporter}</Row> : null}
              {trip.freight_inr != null ? <Row label="Freight">{inr(trip.freight_inr)}</Row> : null}
              <Row label="Planned start">{fmtIst(trip.planned_dispatch_at)}</Row>
              <Row label="Expected arrival">{fmtIst(trip.promised_delivery_at)}</Row>
              {trip.started_at ? <Row label="Started">{fmtIst(trip.started_at)}</Row> : null}
              {trip.arrived_at ? <Row label="Arrived">{fmtIst(trip.arrived_at)}</Row> : null}
              {trip.delivered_at ? <Row label="Done">{fmtIst(trip.delivered_at)}</Row> : null}
              {trip.notes ? <Row label="Notes">{trip.notes}</Row> : null}
            </dl>
          </div>
        </details>

        <details name="trip" open={(state !== "planned" && !sendLink) || undefined}>
          <summary>
            <strong>Activity</strong>
            <small>by phase · who, when, old → new, reason</small>
            <span className="live-acc-count">{events.length}</span>
          </summary>
          <div className="live-acc-body space-y-3">
            <ActionForm action={addTripNote} closeOnSuccess={false} resetOnSuccess>
              {hidden}
              <div className="flex gap-2">
                <input name="note" maxLength={500} placeholder="Add a note (call with driver, toll…)" className="field min-w-0 flex-1 text-sm" />
                <SubmitButton variant="secondary" size="sm">
                  Add
                </SubmitButton>
              </div>
            </ActionForm>
            <PhaseSections groups={phases} group={`trip-${trip.id}-phase`} openPhase={phases.length ? (phases.some((g) => g.phase === state) ? state : null) : null} />
          </div>
        </details>

        <details name="trip">
          <summary>
            <strong>More actions</strong>
            <small>same route, archive, delete</small>
          </summary>
          <div className="live-acc-body flex flex-wrap items-center gap-2">
            <Link href={`/live/trips/new?copy=${trip.id}`} className={buttonClass("secondary", "sm")}>
              <Copy size={14} /> Same route again
            </Link>
            {state !== "active" ? (
              <ActionForm action={archiveTrip} closeOnSuccess={false}>
                {hidden}
                <input type="hidden" name="on" value={trip.archived_at ? "0" : "1"} />
                <ConfirmSubmitButton message={trip.archived_at ? "Bring this trip back to the lists?" : "Archive this trip? It leaves the lists; nothing is deleted."} variant="secondary">
                  <Archive size={14} /> {trip.archived_at ? "Unarchive" : "Archive"}
                </ConfirmSubmitButton>
              </ActionForm>
            ) : null}
            {state !== "active" ? (
              <ActionForm action={deleteTrip} closeOnSuccess={false}>
                {hidden}
                <ConfirmSubmitButton message={`Delete ${tripNo(trip.trip_seq)} for good, with its activity and positions? This cannot be undone.`}>
                  <Trash2 size={14} /> Delete
                </ConfirmSubmitButton>
              </ActionForm>
            ) : (
              <span className="text-xs text-muted">An Active trip cannot be archived or deleted. Mark it Done or Cancelled first.</span>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}
