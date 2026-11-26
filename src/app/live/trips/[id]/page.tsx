import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowDownLeft,
  ArrowUpRight,
  BellRing,
  Clock,
  Copy,
  ExternalLink,
  Flag,
  Gauge,
  FileText,
  History,
  Link2,
  MapPin,
  MoreHorizontal,
  Package,
  MessageCircle,
  Navigation,
  Pencil,
  Phone,
  Play,
  Power,
  ReceiptText,
  Route,
  Satellite,
  Share2,
  Sparkles,
  Timer,
  Trash2,
  Truck,
  UserRound,
} from "lucide-react";

import { ActionForm, ConfirmSubmitButton, SubmitButton } from "@/components/ActionForm";
import { buttonClass, cx } from "@/components/ui";
import { explainDelayBasic, explainDelayCached, type TripDelayFacts } from "@/lib/live-ai";
import { groupByPhase } from "@/lib/live/activity";
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
  liveSchema84,
  ownerLabelFrom,
  placeMap,
  requireLiveSession,
  trackLink,
  waHref,
} from "@/lib/live/server";
import {
  ALERT_KEYS,
  ALERT_META,
  standingFor,
  toLocalInput,
  tripAlerts,
  variance,
  DIRECTION_LABEL,
  PARTY_TYPE_LABEL,
  PURPOSE_LABEL,
  STATE_LABEL,
  STATE_TONE,
  agoShort,
  durationShort,
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
  tripDirection,
  tripNo,
  tripState,
  tripTitle,
  untilShort,
  type LiveTrip,
} from "@/lib/live/shared";
import { etaView, gpsView, progressPct, speedView, tripHeading } from "@/lib/live/insight";
import { formatIndianMobile } from "@/lib/phone";

import { addTripNote, archiveTrip, deleteTrip, saveTripAlerts, setActualStart, setCustomerLink, setTripState } from "../../actions";
import { BackLink } from "../../BackLink";
import { BOARD_PATH } from "../../TripBoard";
import { DriverSignalPill, InfoTip, PhaseSections, SignalPill, StatePill, tripIssues } from "../../parts";
import { DriverLinkActions } from "../../blocks";
import { RouteTimeline } from "../../RouteTimeline";
import { IconSubmit, StatusControl } from "../../ui";
import { AutoRefresh, CopyButton, IconCopy } from "../../widgets";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live tracking - Trip" };

async function DelayNote({ tripId, facts }: { tripId: string; facts: TripDelayFacts }) {
  // Cached: this page refreshes every 30 s and must not ask the model each time.
  const text = (await explainDelayCached(tripId, facts).catch(() => null)) ?? explainDelayBasic(facts);
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

export default async function TripPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; sent?: string }> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const live = await requireLiveSession();
  const trip = await loadTrip(live.ownerId, id);
  if (!trip) notFound();

  const [places, events, trail, driver, profile, has84] = await Promise.all([
    loadPlaces(live.ownerId, { includeArchived: true }),
    loadTripEvents(trip.id),
    loadTrail(trip.id),
    trip.driver_id ? loadDriver(live.ownerId, trip.driver_id) : Promise.resolve(null),
    loadLiveProfile(live.ownerId),
    liveSchema84(),
  ]);
  const byId = placeMap(places);
  const from = trip.from_place_id ? byId.get(trip.from_place_id) : null;
  const to = trip.to_place_id ? byId.get(trip.to_place_id) : null;
  const toText = destinationText(trip, to?.name);
  const dest = destinationPoint(trip, to);
  const originPt =
    trip.from_lat != null && trip.from_lng != null ? { lat: trip.from_lat, lng: trip.from_lng } : from?.lat != null && from?.lng != null ? { lat: from.lat, lng: from.lng } : null;
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
  const phases = groupByPhase(events, trip);
  const standing = state === "active" && trip.status !== "arrived" && trail[0] && now - new Date(trail[0].recorded_at).getTime() < 30 * 60_000 ? standingFor(trail) : null;
  const alerts = tripAlerts(profile.alert_settings, trip.alert_overrides);
  const ovr = trip.alert_overrides ?? {};
  const changedAlerts = (ovr.off?.length ?? 0) + (ovr.on?.length ?? 0) + (ovr.late_min ? 1 : 0);
  // Planned vs actual / live (docs/LIVE-PLAN-v5.md section 3).
  const arrivalLive = trip.arrived_at ?? trip.delivered_at ?? (state === "active" ? trip.eta_at : null);
  const startVar = variance(trip.started_at, trip.planned_dispatch_at);
  const arriveVar = variance(arrivalLive, trip.promised_delivery_at);

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
    stoppedMinutes: standing?.minutes,
    stoppedSince: standing?.since,
    notes: issues.filter((i) => i.key.startsWith("eway")).map((i) => i.text),
  };
  const hidden = <input type="hidden" name="id" value={trip.id} />;
  const sendLink = (sp.created || sp.sent) && dLink && open;

  const heading = tripHeading(trip, fromText, toText);
  const gps = open && trip.driver_id ? gpsView(trip, now) : null;
  const speed = speedView(trip, standing?.minutes ?? null, now);
  const eta = etaView(trip, now);
  const pct = progressPct(originPt, dest, trip);
  const DirIcon = direction === "incoming" ? ArrowDownLeft : ArrowUpRight;
  const callPhone = driver?.phone ?? trip.driver_phone ?? null;
  const kmLeft = state === "active" && trip.distance_left_km != null && trip.status !== "arrived" ? Math.round(trip.distance_left_km) : null;
  const endAt = trip.delivered_at ?? trip.arrived_at;
  const tiles: { key: string; icon: typeof Gauge; label: string; text: string; sub?: string; tone: string }[] = open
    ? [
        { key: "speed", icon: Gauge, label: "Speed", text: speed?.text ?? "-", sub: speed?.sub, tone: speed?.tone ?? "neutral" },
        { key: "km", icon: Route, label: "Km left", text: kmLeft != null ? String(kmLeft) : "-", sub: kmLeft != null ? "km approx" : dest ? "after start" : "pin destination", tone: "brand" },
        { key: "eta", icon: Clock, label: eta?.sub ?? "ETA", text: eta?.text ?? "-", tone: eta?.tone ?? "neutral" },
        { key: "gps", icon: Satellite, label: "GPS", text: gps?.text ?? (trip.driver_id ? "-" : "No driver"), tone: gps?.tone ?? "neutral" },
      ]
    : [
        { key: "start", icon: Play, label: "Started", text: trip.started_at ? fmtIst(trip.started_at) : "-", tone: "neutral" },
        { key: "end", icon: Flag, label: trip.status === "delivered" ? "Delivered" : "Closed", text: fmtIst(endAt), tone: state === "done" ? "good" : "bad" },
        { key: "plan", icon: Clock, label: "Planned arrival", text: fmtIst(trip.promised_delivery_at), sub: arriveVar?.text, tone: arriveVar?.tone ?? "neutral" },
        {
          key: "dur",
          icon: Timer,
          label: "Trip time",
          text: trip.started_at && endAt ? durationShort((new Date(endAt).getTime() - new Date(trip.started_at).getTime()) / 60000) : "-",
          tone: "neutral",
        },
      ];

  return (
    <div className="live-page mx-auto max-w-3xl space-y-3">
      {open ? <AutoRefresh ms={30_000} /> : null}
      <BackLink href={BOARD_PATH[direction]} label={DIRECTION_LABEL[direction]} />

      {/* HERO (v7): name, status, where the truck is between From and To */}
      <section className={cx("lv-hero", `lv-edge-${STATE_TONE[state]}`)}>
        <div className="lv-hero-tags">
          <span className={`lv-tag lv-tag-${direction}`}>
            <DirIcon size={12} /> {DIRECTION_LABEL[direction]}
          </span>
          <span className={cx("lv-chip", `lv-t-${STATE_TONE[state]}`)}>{trip.status === "arrived" ? "Arrived" : STATE_LABEL[state]}</span>
          {trip.archived_at ? <span className="lv-chip lv-t-neutral">Archived</span> : null}
          <span className="lv-ref" title="Trip number, for records">
            {tripNo(trip.trip_seq)}
          </span>
        </div>
        <h1 className="lv-hero-title">{heading}</h1>
        <div className="lv-route" aria-label={`From ${fromText ?? "start"} to ${toText}`}>
          <span className="lv-route-end">
            <span className="lv-route-pin" aria-hidden />
            <span className="truncate">{fromText ?? "Start"}</span>
          </span>
          <span className="lv-route-track" aria-hidden>
            <span className="lv-route-fill" style={{ width: `${pct ?? (state === "active" ? 50 : 0)}%` }} />
            {state === "active" && trip.status !== "arrived" ? (
              <span className="lv-route-truck" style={{ left: `${pct ?? 50}%` }}>
                <Truck size={12} />
              </span>
            ) : null}
          </span>
          <span className="lv-route-end is-to">
            <MapPin size={13} className="shrink-0" aria-hidden />
            <span className="truncate">{toText}</span>
          </span>
        </div>
        <div className="lv-card-meta">
          {trip.vehicle_no ? (
            <span className="lv-m lv-plate">
              <Truck size={11} aria-hidden /> {prettyVehicle(trip.vehicle_no)}
            </span>
          ) : null}
          <span className={cx("lv-m min-w-0", !trip.driver_name && "is-faint")}>
            <UserRound size={11} aria-hidden /> <span className="truncate">{trip.driver_name ?? "No driver"}</span>
          </span>
          {trip.invoice_no ? (
            <span className="lv-m min-w-0">
              <ReceiptText size={11} aria-hidden /> <span className="truncate">{trip.invoice_no}</span>
            </span>
          ) : null}
        </div>
      </section>

      {/* AT A GLANCE (v7): four tiles; colour = on time / at risk / late */}
      <div className="lv-tiles">
        {tiles.map((t) => (
          <div key={t.key} className={cx("lv-tile", `lv-t-${t.tone}`)} suppressHydrationWarning>
            <span className="lv-tile-label">
              <t.icon size={12} aria-hidden /> {t.label}
            </span>
            <strong>{t.text}</strong>
            {t.sub ? <small>{t.sub}</small> : null}
          </div>
        ))}
      </div>

      {/* ACTIONS (v7): icon + one word; the long explanation is behind (i) */}
      <nav className="lv-actions" aria-label="Trip actions">
        {state === "planned" && trip.driver_id ? (
          <ActionForm action={setTripState} closeOnSuccess={false}>
            {hidden}
            <input type="hidden" name="state" value="active" />
            <button type="submit" className="lv-act lv-act-primary" aria-label="Start trip">
              <Play size={17} />
              <span>Start</span>
            </button>
          </ActionForm>
        ) : null}
        <StatusControl tripId={trip.id} current={state} labels={STATE_LABEL} canStart={Boolean(trip.driver_id)} asAction />
        {callPhone && open ? (
          <a href={`tel:${callPhone}`} className="lv-act" aria-label="Call driver">
            <Phone size={17} />
            <span>Call</span>
          </a>
        ) : null}
        {driverWa && open ? (
          <a href={driverWa} target="_blank" rel="noopener noreferrer" className="lv-act lv-act-wa" aria-label="Send driver link on WhatsApp">
            <MessageCircle size={17} />
            <span>Driver</span>
          </a>
        ) : null}
        {customerWa && open ? (
          <a href={customerWa} target="_blank" rel="noopener noreferrer" className="lv-act" aria-label="Send customer link on WhatsApp">
            <Share2 size={17} />
            <span>Customer</span>
          </a>
        ) : null}
        {dest || trip.to_maps_url ? (
          <a href={dest ? directionsHref(dest.lat, dest.lng) : trip.to_maps_url!} target="_blank" rel="noopener noreferrer" className="lv-act" aria-label="Directions to destination">
            <Navigation size={17} />
            <span>Navigate</span>
          </a>
        ) : null}
        {open ? (
          <Link href={`/live/trips/${trip.id}/edit`} className="lv-act" aria-label={state === "active" ? "Change trip" : "Edit trip"}>
            <Pencil size={17} />
            <span>Edit</span>
          </Link>
        ) : (
          <Link href={`/live/trips/new?copy=${trip.id}`} className="lv-act" aria-label="Same route again">
            <Copy size={17} />
            <span>Repeat</span>
          </Link>
        )}
        <InfoTip label="How to read this trip">
          Planned: set up, not moving. Active: on the road (Start, the driver&apos;s Started button, or leaving the From place). Done: delivered.
          Cancelled: kept in records. Change it with Status; every change is in Activity. Speed under 4 km/h counts as stopped. Km left is the
          straight line × 1.25. ETA uses the truck&apos;s average speed over the last 2 hours, plus halt time on trips longer than about 12 hours of driving: green on time, amber up to 30 min late, red later. GPS turns amber after
          10 min without a position and red after 30 min.
        </InfoTip>
      </nav>
      {state === "planned" && !trip.driver_id ? <p className="lv-note">Add a driver to start: tracking follows his phone.</p> : null}
      {trip.pod_note ? <p className="lv-note">Delivery note: {trip.pod_note}</p> : null}

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

      {/* Late and no-GPS already show in the tiles; only what has no tile is repeated here. */}
      {issues.some((i) => i.key.startsWith("eway")) ? (
        <div className="flex flex-wrap gap-1.5">
          {issues.filter((i) => i.key.startsWith("eway")).map((i) => (
            <span key={i.key} className={cx("lv-chip", i.tone === "bad" ? "lv-t-bad" : "lv-t-warn")}>
              <AlertTriangle size={11} /> {i.text}
            </span>
          ))}
        </div>
      ) : null}
      {late ? (
        <Suspense fallback={null}>
          <DelayNote tripId={trip.id} facts={delayFacts} />
        </Suspense>
      ) : null}

      {/* MAP */}
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
        {pos && trip.last_point_at ? (
          <p className="lv-map-foot" suppressHydrationWarning>
            <Satellite size={11} /> Updated {agoShort(trip.last_point_at, now)} · from the driver&apos;s phone
          </p>
        ) : null}
        {!dest && open ? <p className="lv-map-foot">Pin the destination (Edit) to get km left and ETA.</p> : null}
      </section>

      {/* WHERE IS MY TRUCK (v6): stops with scheduled vs actual / expected; replaces the v5 Times card and Road ahead */}
      <Suspense fallback={<section className="panel rt"><p className="rt-empty">Working out the route…</p></section>}>
        <RouteTimeline
          trip={trip}
          from={originPt ? { ...originPt, name: fromText ?? "Start" } : null}
          to={dest ? { ...dest, name: toText } : null}
          footer={
            <div className="rt-foot">
              <span>
                Start: planned {fmtIst(trip.planned_dispatch_at)}
                {trip.started_at ? <> · actual {fmtIst(trip.started_at)}</> : null}
                {startVar ? <em className={`live-var live-var-${startVar.tone}`}>{startVar.text}</em> : null}
              </span>
              <span>
                Arrival: planned {fmtIst(trip.promised_delivery_at)}
                {arrivalLive ? <> · {trip.arrived_at || trip.delivered_at ? "actual" : "live"} {fmtIst(arrivalLive)}</> : null}
                {arriveVar ? <em className={`live-var live-var-${arriveVar.tone}`}>{arriveVar.text}</em> : null}
              </span>
              {state !== "planned" ? (
                <details className="live-times-edit">
                  <summary>Correct actual start</summary>
                  <ActionForm action={setActualStart} closeOnSuccess={false}>
                    {hidden}
                    <div className="live-form-row">
                      <input type="datetime-local" name="started_at" defaultValue={toLocalInput(trip.started_at)} className="field live-field-sm" aria-label="Actual start" required />
                      <input name="reason" maxLength={300} placeholder="Reason (required)" className="field live-field-sm min-w-0 flex-1" required />
                      <SubmitButton size="sm">Save</SubmitButton>
                    </div>
                  </ActionForm>
                </details>
              ) : null}
            </div>
          }
        />
      </Suspense>

      {/* SECTIONS (one open at a time) */}
      <div className="live-acc">
        <details name="trip" open={(state === "planned" && !sendLink) || undefined}>
          <summary>
            <Link2 size={15} className="lv-acc-ic" aria-hidden />
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
                {temp ? <p className="mt-1 text-xs text-muted">Temporary driver: link for this trip only; it stops {profile.one_time_expire_hours} h after the trip ends.</p> : null}
                {open ? (
                  <div className="mt-2">
                    <DriverLinkActions driver={driver} link={dLink} wa={driverWa} />
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
                <InfoTip label="About the customer link">Read-only page for your customer: route, status, map, planned arrival and live ETA, truck, goods. Never invoice value, freight or e-way bill. Driver name / call button: Profile &gt; Business settings.</InfoTip>
              </p>
              <div className="mt-1.5 live-ibar">
                {trip.track_token ? (
                  <>
                    {customerWa ? (
                      <a href={customerWa} target="_blank" rel="noopener noreferrer" className="live-ib live-ib-wa" aria-label="Send customer link on WhatsApp" title="WhatsApp">
                        <MessageCircle size={15} />
                      </a>
                    ) : null}
                    <IconCopy value={trackLink(trip.track_token)} label="Copy customer link" />
                    <a href={trackLink(trip.track_token)} target="_blank" rel="noopener noreferrer" className="live-ib" aria-label="Open customer page" title="Open customer page">
                      <ExternalLink size={15} />
                    </a>
                    <ActionForm action={setCustomerLink} closeOnSuccess={false}>
                      {hidden}
                      <input type="hidden" name="on" value="0" />
                      <IconSubmit label="Turn customer link off" tone="bad" confirm="Turn the customer link off? The customer page stops working.">
                        <Power size={15} />
                      </IconSubmit>
                    </ActionForm>
                    <span className="live-ibar-note">On</span>
                  </>
                ) : (
                  <ActionForm action={setCustomerLink} closeOnSuccess={false}>
                    {hidden}
                    <input type="hidden" name="on" value="1" />
                    <SubmitButton variant="secondary" size="sm">
                      <Copy size={13} /> Make link
                    </SubmitButton>
                  </ActionForm>
                )}
              </div>
            </div>
          </div>
        </details>

        <details name="trip">
          <summary>
            <FileText size={15} className="lv-acc-ic" aria-hidden />
            <strong>Details</strong>
            <small>{[trip.material, trip.invoice_no ? `Inv ${trip.invoice_no}` : null].filter(Boolean).join(" · ") || "route, goods, documents"}</small>
          </summary>
          <div className="live-acc-body">
            <dl className="live-dl">
              <p className="lv-dl-head">
                <MapPin size={11} /> Who &amp; where
              </p>
              <Row label="Trip no.">{tripNo(trip.trip_seq)}{trip.trip_name ? ` · ${trip.trip_name}` : ""}</Row>
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
              <p className="lv-dl-head">
                <Package size={11} /> Goods &amp; papers
              </p>
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
              <p className="lv-dl-head">
                <Clock size={11} /> Times
              </p>
              <Row label="Planned start">{fmtIst(trip.planned_dispatch_at)}</Row>
              <Row label="Expected arrival">{fmtIst(trip.promised_delivery_at)}</Row>
              {trip.started_at ? <Row label="Started">{fmtIst(trip.started_at)}</Row> : null}
              {trip.arrived_at ? <Row label="Arrived">{fmtIst(trip.arrived_at)}</Row> : null}
              {trip.delivered_at ? <Row label="Done">{fmtIst(trip.delivered_at)}</Row> : null}
              {trip.notes ? <Row label="Notes">{trip.notes}</Row> : null}
            </dl>
          </div>
        </details>

        <details name="trip">
          <summary>
            <BellRing size={15} className="lv-acc-ic" aria-hidden />
            <strong>Alerts</strong>
            <small>{changedAlerts ? `${changedAlerts} change${changedAlerts === 1 ? "" : "s"} for this trip` : "account defaults"}</small>
          </summary>
          <div className="live-acc-body">
            {has84 ? (
              <ActionForm action={saveTripAlerts} closeOnSuccess={false}>
                {hidden}
                <ul className="live-toggles">
                  {ALERT_KEYS.map((k) => (
                    <li key={k}>
                      <label>
                        <input type="checkbox" name={`a_${k}`} defaultChecked={alerts[k].on} className="live-switch" />
                        <span>{ALERT_META[k].label}</span>
                      </label>
                      {k === "late" ? (
                        <span className="live-toggles-x">
                          after
                          <input name="late_min" inputMode="numeric" defaultValue={String(alerts.late.min)} className="field live-field-xs" aria-label="Late after minutes" />
                          min
                        </span>
                      ) : ALERT_META[k].min ? (
                        <small>
                          {alerts[k].min} {ALERT_META[k].min!.unit}
                        </small>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center justify-between gap-2">
                  <Link href="/live/profile/alerts" className="text-xs font-semibold text-brand-600">
                    Edit defaults
                  </Link>
                  <SubmitButton size="sm">Save</SubmitButton>
                </div>
              </ActionForm>
            ) : (
              <p className="text-xs text-muted">Trip alerts need database update 0084.</p>
            )}
          </div>
        </details>

        <details name="trip" open={(state !== "planned" && !sendLink) || undefined}>
          <summary>
            <History size={15} className="lv-acc-ic" aria-hidden />
            <strong>Activity</strong>
            <small>who, when, what changed</small>
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
            <Link href={`/live/logbook/trips/${trip.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
              <History size={12} /> Activity page
            </Link>
          </div>
        </details>

        <details name="trip">
          <summary>
            <MoreHorizontal size={15} className="lv-acc-ic" aria-hidden />
            <strong>More</strong>
            <small>repeat, archive, delete</small>
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
