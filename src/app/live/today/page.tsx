import Link from "next/link";
import { Suspense } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  BarChart3,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  Circle,
  FileWarning,
  Flag,
  Gauge,
  Map as MapIcon,
  PackageCheck,
  PauseCircle,
  Play,
  Plus,
  Satellite,
  SignalZero,
  Sparkles,
  Target,
  Truck,
} from "lucide-react";

import { cx } from "@/components/ui";
import { gpsView } from "@/lib/live/insight";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { aiAvailable } from "@/lib/ai";
import { summarizeOperations, summarizeOperationsBasic, type OperationsFacts } from "@/lib/live-ai";
import {
  loadOpenTrips,
  loadPlaces,
  loadRecentEvents,
  logLive,
  placeMap,
  requireLiveSession,
} from "@/lib/live/server";
import {
  DELAY_GRACE_MS,
  EWAY_DASH_MS,
  durationShort,
  agoShort,
  destinationText,
  istDayStart,
  prettyVehicle,
  type LivePlace,
  type LiveTrip,
  type TripEvent,
} from "@/lib/live/shared";

import { BackLink } from "../BackLink";
import { InfoTip, TripCard, tripIssues } from "../parts";
import { AutoRefresh, FleetMap, type MapTruck } from "../widgets";

export const metadata = { title: "Live tracking - Today" };
export const dynamic = "force-dynamic";

/* The AI summary is cached per account for a few minutes: the dashboard
   refreshes every 30 s and nobody needs a new paragraph that often. */
const summaryCache = new Map<string, { at: number; key: string; text: string; ai: boolean }>();
const SUMMARY_TTL_MS = 10 * 60 * 1000;

async function SummaryCard({ ownerId, facts }: { ownerId: string; facts: OperationsFacts }) {
  const key = JSON.stringify(facts.counts);
  const hit = summaryCache.get(ownerId);
  let text: string;
  let ai = false;
  if (hit && hit.key === key && Date.now() - hit.at < SUMMARY_TTL_MS) {
    text = hit.text;
    ai = hit.ai;
  } else {
    const fromAi = aiAvailable() ? await summarizeOperations(facts).catch(() => null) : null;
    ai = Boolean(fromAi);
    text = fromAi ?? summarizeOperationsBasic(facts);
    summaryCache.set(ownerId, { at: Date.now(), key, text, ai });
  }
  return (
    <section className="live-summary">
      <p className="live-summary-head">
        <Sparkles size={15} /> {ai ? "Today in short (AI)" : "Today in short"}
      </p>
      <ul>
        {text
          .split("\n")
          .map((l) => l.replace(/^•\s*/, "").trim())
          .filter(Boolean)
          .map((l) => (
            <li key={l}>{l}</li>
          ))}
      </ul>
    </section>
  );
}

async function loadToday(ownerId: string, dayStart: string): Promise<LiveTrip[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("live_trips")
    .select("*")
    .eq("owner_id", ownerId)
    .or(`delivered_at.gte.${dayStart},arrived_at.gte.${dayStart},started_at.gte.${dayStart}`)
    .limit(300);
  if (error) {
    logLive("today", error);
    return [];
  }
  return (data ?? []) as LiveTrip[];
}

function Setup({ places, hasTrips }: { places: LivePlace[]; hasTrips: boolean }) {
  const hasFactory = places.some((p) => p.kind === "factory" || p.kind === "warehouse" || p.kind === "branch");
  const hasCustomer = places.some((p) => p.kind === "customer");
  const steps = [
    { done: hasFactory, title: "Add your factory / godown", text: "Marks loading and departure automatically.", href: "/live/places?add=factory" },
    { done: hasCustomer, title: "Add a few customers / dealers", text: "Arrival is marked when the truck reaches them.", href: "/live/places?add=customer" },
    { done: hasTrips, title: "Create your first trip", text: "Paste the e-way bill text - the form fills itself.", href: "/live/trips/new" },
  ];
  if (steps.every((s) => s.done)) return null;
  return (
    <section className="panel p-4">
      <h2 className="text-base font-bold text-strong">Get set up in 3 steps</h2>
      <ol className="mt-3 space-y-2">
        {steps.map((s) => (
          <li key={s.title}>
            <Link href={s.href} className="live-setup-step">
              {s.done ? <CheckCircle2 size={20} className="text-good-500" /> : <Circle size={20} className="text-faint" />}
              <span className="min-w-0">
                <strong className={s.done ? "line-through opacity-60" : undefined}>{s.title}</strong>
                <small>{s.text}</small>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

const EVENT_ICON: Record<string, typeof Flag> = {
  stoppage: PauseCircle,
  delay: AlertTriangle,
  eway_expiring: FileWarning,
  eway_expired: FileWarning,
  no_signal: AlertTriangle,
};

async function loadWeekDone(ownerId: string, since: string): Promise<LiveTrip[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("live_trips")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("status", "delivered")
    .gte("delivered_at", since)
    .limit(1000);
  if (error) {
    logLive("today week", error);
    return [];
  }
  return (data ?? []) as LiveTrip[];
}

const GRACE_MIN = DELAY_GRACE_MS / 60000;

/** Delivered on time = delivered no later than promised + the grace window. Null when no promise was set. */
function onTime(t: LiveTrip): boolean | null {
  if (!t.delivered_at || !t.promised_delivery_at) return null;
  return new Date(t.delivered_at).getTime() <= new Date(t.promised_delivery_at).getTime() + DELAY_GRACE_MS;
}

function istHour(iso: string): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(new Date(iso))) % 24;
}

function Kpi({ href, icon: Icon, label, value, tone, hint }: { href: string; icon: typeof Truck; label: string; value: number; tone: string; hint?: string }) {
  return (
    <Link href={href} className={cx("lv-kpi", `lv-t-${tone}`, value === 0 && "is-zero")}>
      <span className="lv-kpi-ic">
        <Icon size={15} />
      </span>
      <strong>{value}</strong>
      <small>{label}</small>
      {hint ? <em>{hint}</em> : null}
    </Link>
  );
}

/**
 * Today (v7): an operations dashboard, exceptions first.
 *   1  problems now (late, no GPS, standing, e-way bill) - each a link to the list
 *   2  the day's flow, planned -> dispatched -> on the road -> arrived -> delivered
 *   3  four small charts: on-time rate (7 days), GPS health, today by hour,
 *      sending vs receiving
 *   4  the lists themselves, one section open at a time
 * Every number is computed here from the same rows the lists show, so a tile
 * and the list it opens always agree.
 */
export default async function LiveDashboard() {
  const { ownerId } = await requireLiveSession();
  const now = Date.now();
  const dayStart = istDayStart(now);
  const weekStart = new Date(now - 7 * 86_400_000).toISOString();

  const [open, places, today, events, week] = await Promise.all([
    loadOpenTrips(ownerId),
    loadPlaces(ownerId),
    loadToday(ownerId, dayStart),
    loadRecentEvents(ownerId, new Date(now - 24 * 3_600_000).toISOString(), 60),
    loadWeekDone(ownerId, weekStart),
  ]);
  const byId = placeMap(places);
  const tripById = new Map([...open, ...today].map((t) => [t.id, t]));

  const inTransit = open.filter((t) => t.status === "in_transit");
  const planned = open.filter((t) => t.status === "planned" || t.status === "loading");
  const arrivedOpen = open.filter((t) => t.status === "arrived");
  const delayed = inTransit.filter((t) => tripIssues(t, now).some((i) => i.key === "late"));
  const noGps = inTransit.filter((t) => t.driver_id && gpsView(t, now)?.tone === "bad");
  const arrivedToday = today.filter((t) => t.arrived_at && t.arrived_at >= dayStart);
  const deliveredToday = today.filter((t) => t.status === "delivered" && t.delivered_at && t.delivered_at >= dayStart);
  const dispatchedToday = today.filter((t) => t.started_at && t.started_at >= dayStart);
  const ewaySoon = open.filter(
    (t) => (t.status === "loading" || t.status === "in_transit") && t.eway_valid_until && new Date(t.eway_valid_until).getTime() - now <= EWAY_DASH_MS,
  );
  const ewayExpired = ewaySoon.filter((t) => new Date(t.eway_valid_until!).getTime() <= now);
  const stopEvents = events.filter(
    (e) => e.kind === "stoppage" && now - new Date(e.created_at).getTime() < 90 * 60 * 1000 && tripById.get(e.trip_id ?? "")?.status === "in_transit",
  );
  const stoppedIds = new Set(stopEvents.map((e) => e.trip_id ?? ""));
  const attention = open.filter((t) => tripIssues(t, now).length > 0 || stoppedIds.has(t.id));

  // On-time rate, 7 days (only trips with a promised time count).
  const judged = week.map(onTime).filter((v): v is boolean => v !== null);
  const onTimeN = judged.filter(Boolean).length;
  const onTimePct = judged.length ? Math.round((onTimeN / judged.length) * 100) : null;
  const lateMins = week
    .filter((t) => onTime(t) === false)
    .map((t) => (new Date(t.delivered_at!).getTime() - new Date(t.promised_delivery_at!).getTime()) / 60000);
  const avgLate = lateMins.length ? lateMins.reduce((a, b) => a + b, 0) / lateMins.length : null;
  const tripHours = week
    .filter((t) => t.started_at && t.delivered_at)
    .map((t) => (new Date(t.delivered_at!).getTime() - new Date(t.started_at!).getTime()) / 3_600_000)
    .filter((h) => h > 0 && h < 24 * 14);
  const avgTripH = tripHours.length ? tripHours.reduce((a, b) => a + b, 0) / tripHours.length : null;

  // GPS health of trucks on the road with a driver.
  const tracked = inTransit.filter((t) => t.driver_id);
  const gpsMix = { good: 0, brand: 0, warn: 0, bad: 0, neutral: 0 } as Record<string, number>;
  for (const t of tracked) gpsMix[gpsView(t, now)?.tone ?? "neutral"] += 1;

  // Today by IST hour: starts vs arrivals.
  const hourNow = istHour(new Date(now).toISOString());
  const starts = Array.from({ length: 24 }, () => 0);
  const ends = Array.from({ length: 24 }, () => 0);
  for (const t of dispatchedToday) starts[istHour(t.started_at!)] += 1;
  for (const t of today) {
    const at = t.arrived_at && t.arrived_at >= dayStart ? t.arrived_at : t.delivered_at && t.delivered_at >= dayStart ? t.delivered_at : null;
    if (at) ends[istHour(at)] += 1;
  }
  const peak = Math.max(1, ...starts, ...ends);

  // Sending vs receiving, open trips by state.
  const split = (["outgoing", "incoming"] as const).map((d) => {
    const mine = open.filter((t) => (t.direction === "incoming" ? "incoming" : "outgoing") === d);
    return {
      d,
      planned: mine.filter((t) => t.status === "planned" || t.status === "loading").length,
      road: mine.filter((t) => t.status === "in_transit").length,
      arrived: mine.filter((t) => t.status === "arrived").length,
      total: mine.length,
    };
  });
  const splitMax = Math.max(1, ...split.map((s) => s.total));

  const mapTrucks: MapTruck[] = open
    .filter((t) => t.last_lat != null && t.last_lng != null)
    .sort((a, b) => (b.last_point_at ?? "").localeCompare(a.last_point_at ?? ""))
    .slice(0, 30)
    .map((t) => {
      const issues = tripIssues(t, now);
      return {
        id: t.id,
        label: prettyVehicle(t.vehicle_no) || "Truck",
        sub: destinationText(t, t.to_place_id ? byId.get(t.to_place_id)?.name : null),
        lat: t.last_lat!,
        lng: t.last_lng!,
        at: t.last_point_at,
        tone: issues.some((i) => i.tone === "bad") ? "bad" : issues.length || stoppedIds.has(t.id) ? "warn" : "good",
      };
    });

  const facts: OperationsFacts = {
    asOf: new Date(now).toISOString(),
    scope: "live",
    counts: {
      inTransit: inTransit.length,
      delayed: delayed.length,
      arrivedToday: arrivedToday.length,
      deliveredToday: deliveredToday.length,
      stoppedNow: stoppedIds.size,
      ewayExpiringSoon: ewaySoon.length - ewayExpired.length,
      ewayExpired: ewayExpired.length,
      dispatchedToday: dispatchedToday.length,
    },
    delayedTrips: delayed.map((t) => ({
      vehicleNo: prettyVehicle(t.vehicle_no),
      toPlace: destinationText(t, t.to_place_id ? byId.get(t.to_place_id)?.name : null),
      delayMinutes:
        t.eta_at && t.promised_delivery_at ? Math.round((new Date(t.eta_at).getTime() - new Date(t.promised_delivery_at).getTime()) / 60000) : undefined,
    })),
    stoppages: stopEvents.map((e) => ({
      vehicleNo: prettyVehicle(tripById.get(e.trip_id ?? "")?.vehicle_no),
      minutes: Number(/(\d+) min/.exec(e.title)?.[1] ?? 30),
    })),
    ewayExpiring: ewaySoon.map((t) => ({ vehicleNo: prettyVehicle(t.vehicle_no), ewayBillNo: t.eway_bill_no ?? undefined, validUntil: t.eway_valid_until ?? undefined })),
    deliveries: deliveredToday.map((t) => ({
      vehicleNo: prettyVehicle(t.vehicle_no),
      toPlace: destinationText(t, t.to_place_id ? byId.get(t.to_place_id)?.name : null),
      onTime: t.promised_delivery_at && t.delivered_at ? t.delivered_at <= t.promised_delivery_at : undefined,
    })),
  };

  const alertsFeed = events.filter((e) => e.actor !== "owner").slice(0, 12);
  const alertKinds = new Map<string, number>();
  for (const e of alertsFeed) alertKinds.set(e.kind, (alertKinds.get(e.kind) ?? 0) + 1);
  const hasAny = open.length > 0 || today.length > 0 || week.length > 0;
  const firstOpen = attention.length ? "attention" : inTransit.length ? "road" : planned.length ? "planned" : "feed";
  const dateText = new Date(now).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="live-page mx-auto max-w-5xl space-y-3">
      <AutoRefresh ms={45_000} />
      <BackLink href="/live/sending" label="Trips" />
      <header className="lv-board-head">
        <span className="lv-board-icon is-in" aria-hidden>
          <Gauge size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h1>Today</h1>
          <p>{dateText} · updates every 45 s</p>
        </div>
        <InfoTip label="How Today is counted">
          Problems are trucks on the road now. Late = live ETA more than 30 min after the promised time. No GPS = no position for 30+ min. Standing = a
          stop of 30+ min in the last 90 min outside a known place. On-time (7 days) counts delivered trips that had a promised time; on time = delivered
          within 30 min of it. Tap any number to open that list.
        </InfoTip>
        <Link href="/live/trips/new" className="live-new-btn" aria-label="New trip">
          <Plus size={20} />
        </Link>
      </header>

      <Setup places={places} hasTrips={hasAny || events.length > 0} />

      {/* 1 PROBLEMS NOW */}
      <section aria-label="Problems now">
        <p className="lv-sec-label">
          <AlertTriangle size={11} /> Needs action now
        </p>
        <div className="lv-kpis">
          <Kpi href="/live/sending?s=active" icon={AlertTriangle} label="Late" value={delayed.length} tone="bad" />
          <Kpi href="/live/sending?s=active" icon={SignalZero} label="No GPS" value={noGps.length} tone="bad" />
          <Kpi href="/live/sending?s=active" icon={PauseCircle} label="Standing" value={stoppedIds.size} tone="warn" />
          <Kpi href="/live/sending?s=active" icon={FileWarning} label="E-way < 12 h" value={ewaySoon.length} tone="warn" hint={ewayExpired.length ? `${ewayExpired.length} expired` : undefined} />
        </div>
      </section>

      {/* 2 THE DAY'S FLOW */}
      <section aria-label="Today's flow">
        <p className="lv-sec-label">
          <Activity size={11} /> Today&apos;s flow
        </p>
        <div className="lv-flow">
          {[
            { href: "/live/sending?s=planned", icon: CalendarClock, label: "Waiting", value: planned.length, tone: "neutral" },
            { href: "/live/sending?d=today", icon: Play, label: "Dispatched", value: dispatchedToday.length, tone: "brand" },
            { href: "/live/sending?s=active", icon: Truck, label: "On road", value: inTransit.length, tone: "brand" },
            { href: "/live/sending?s=active", icon: Flag, label: "Arrived", value: arrivedToday.length + arrivedOpen.filter((t) => !arrivedToday.includes(t)).length, tone: "good" },
            { href: "/live/sending?s=done&d=today", icon: PackageCheck, label: "Delivered", value: deliveredToday.length, tone: "good" },
          ].map((s, i) => (
            <Link key={s.label} href={s.href} className={cx("lv-flow-step", `lv-t-${s.tone}`, s.value === 0 && "is-zero")}>
              {i ? <ChevronRight size={12} className="lv-flow-arrow" aria-hidden /> : null}
              <s.icon size={14} aria-hidden />
              <strong>{s.value}</strong>
              <small>{s.label}</small>
            </Link>
          ))}
        </div>
      </section>

      {/* 3 CHARTS */}
      <div className="lv-viz-grid">
        <section className="lv-viz">
          <p className="lv-viz-title">
            <Target size={12} /> On time · 7 days
          </p>
          <div className="lv-donut-row">
            <span
              className="lv-donut"
              style={{ background: onTimePct == null ? "#e2e8f0" : `conic-gradient(#16a34a ${onTimePct * 3.6}deg, #fca5a5 0)` }}
              role="img"
              aria-label={onTimePct == null ? "No data" : `${onTimePct}% on time`}
            >
              <b>{onTimePct == null ? "-" : `${onTimePct}%`}</b>
            </span>
            <dl className="lv-viz-dl">
              <div>
                <dt>Delivered</dt>
                <dd>{week.length}</dd>
              </div>
              <div>
                <dt>On time</dt>
                <dd>
                  {onTimeN}/{judged.length}
                </dd>
              </div>
              <div>
                <dt>Avg late by</dt>
                <dd>{avgLate != null ? durationShort(avgLate) : "-"}</dd>
              </div>
              <div>
                <dt>Avg trip</dt>
                <dd>{avgTripH != null ? durationShort(avgTripH * 60) : "-"}</dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="lv-viz">
          <p className="lv-viz-title">
            <Satellite size={12} /> GPS health · {tracked.length} on road
          </p>
          <span className="lv-stack" role="img" aria-label="GPS freshness of trucks on the road">
            {(["good", "brand", "warn", "bad"] as const).map((k) =>
              gpsMix[k] ? <span key={k} className={`lv-t-${k}`} style={{ flexGrow: gpsMix[k] }} /> : null,
            )}
            {tracked.length === 0 ? <span className="lv-t-neutral" style={{ flexGrow: 1 }} /> : null}
          </span>
          <ul className="lv-legend">
            <li className="lv-t-good">Live {gpsMix.good}</li>
            <li className="lv-t-brand">&lt; 10 min {gpsMix.brand}</li>
            <li className="lv-t-warn">10-30 min {gpsMix.warn}</li>
            <li className="lv-t-bad">30+ min {gpsMix.bad}</li>
          </ul>
        </section>

        <section className="lv-viz">
          <p className="lv-viz-title">
            <BarChart3 size={12} /> Today by hour
          </p>
          <div className="lv-hours" role="img" aria-label="Dispatches and arrivals per hour today">
            {starts.map((n, h) => (
              <span key={h} className={cx("lv-hour", h === hourNow && "is-now", h > hourNow && "is-future")} title={`${h}:00 · ${n} out, ${ends[h]} in`}>
                <i style={{ height: `${(n / peak) * 100}%` }} />
                <b style={{ height: `${(ends[h] / peak) * 100}%` }} />
              </span>
            ))}
          </div>
          <ul className="lv-legend">
            <li className="lv-t-brand">Dispatched {dispatchedToday.length}</li>
            <li className="lv-t-good">Arrived {arrivedToday.length}</li>
            <li className="lv-legend-axis">0 · 6 · 12 · 18 · 24</li>
          </ul>
        </section>

        <section className="lv-viz">
          <p className="lv-viz-title">
            <ArrowLeftRight size={12} /> Open trips by side
          </p>
          <div className="lv-split">
            {split.map((s) => (
              <Link key={s.d} href={s.d === "outgoing" ? "/live/sending" : "/live/receiving"} className="lv-split-row">
                <span className="lv-split-name">
                  {s.d === "outgoing" ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                  {s.d === "outgoing" ? "Sending" : "Receiving"}
                </span>
                <span className="lv-split-bar" style={{ width: `${(s.total / splitMax) * 100}%` }}>
                  {s.planned ? <span className="lv-t-neutral" style={{ flexGrow: s.planned }} /> : null}
                  {s.road ? <span className="lv-t-brand" style={{ flexGrow: s.road }} /> : null}
                  {s.arrived ? <span className="lv-t-good" style={{ flexGrow: s.arrived }} /> : null}
                </span>
                <b>{s.total}</b>
              </Link>
            ))}
          </div>
          <ul className="lv-legend">
            <li className="lv-t-neutral">Waiting</li>
            <li className="lv-t-brand">On road</li>
            <li className="lv-t-good">Arrived</li>
          </ul>
        </section>
      </div>

      {hasAny ? (
        <Suspense fallback={<section className="live-summary live-summary-loading">Reading today’s trips…</section>}>
          <SummaryCard ownerId={ownerId} facts={facts} />
        </Suspense>
      ) : null}

      {/* 4 LISTS - one open at a time */}
      <div className="live-acc">
        <details name="today" open={firstOpen === "attention" || undefined}>
          <summary>
            <AlertTriangle size={15} className="lv-acc-ic" aria-hidden />
            <strong>Needs attention</strong>
            <small>late, no GPS, standing, e-way bill</small>
            <span className="live-acc-count">{attention.length}</span>
          </summary>
          <div className="live-acc-body">
            {attention.length ? (
              <div className="lv-list">
                {attention.map((t) => (
                  <TripCard key={t.id} trip={t} places={byId} now={now} />
                ))}
              </div>
            ) : (
              <p className="live-empty">All clear. Nothing needs you right now.</p>
            )}
          </div>
        </details>
        <details name="today" open={firstOpen === "road" || undefined}>
          <summary>
            <Truck size={15} className="lv-acc-ic" aria-hidden />
            <strong>On the road</strong>
            <small>moving now, newest position first</small>
            <span className="live-acc-count">{inTransit.length}</span>
          </summary>
          <div className="live-acc-body">
            {inTransit.length ? (
              <div className="lv-list">
                {[...inTransit]
                  .sort((a, b) => (b.last_point_at ?? "").localeCompare(a.last_point_at ?? ""))
                  .map((t) => (
                    <TripCard key={t.id} trip={t} places={byId} now={now} />
                  ))}
              </div>
            ) : (
              <p className="live-empty">No truck on the road right now.</p>
            )}
          </div>
        </details>
        <details name="today" open={firstOpen === "planned" || undefined}>
          <summary>
            <CalendarClock size={15} className="lv-acc-ic" aria-hidden />
            <strong>Waiting to start</strong>
            <small>planned and loading</small>
            <span className="live-acc-count">{planned.length}</span>
          </summary>
          <div className="live-acc-body">
            {planned.length ? (
              <div className="lv-list">
                {planned.map((t) => (
                  <TripCard key={t.id} trip={t} places={byId} now={now} />
                ))}
              </div>
            ) : (
              <p className="live-empty">Nothing waiting.</p>
            )}
          </div>
        </details>
        {mapTrucks.length ? (
          <details name="today">
            <summary>
              <MapIcon size={15} className="lv-acc-ic" aria-hidden />
              <strong>Map</strong>
              <small>where the trucks are</small>
              <span className="live-acc-count">{mapTrucks.length}</span>
            </summary>
            <div className="live-acc-body">
              <FleetMap trucks={mapTrucks} />
            </div>
          </details>
        ) : null}
        <details name="today" open={firstOpen === "feed" || undefined}>
          <summary>
            <BellRing size={15} className="lv-acc-ic" aria-hidden />
            <strong>Alerts · 24 h</strong>
            <small>
              {[...alertKinds.entries()]
                .map(([k, n]) => `${n} ${KIND_LABEL[k] ?? k.replace(/_/g, " ")}`)
                .join(" · ") || "nothing automatic"}
            </small>
            <span className="live-acc-count">{alertsFeed.length}</span>
          </summary>
          <div className="live-acc-body">
            {alertsFeed.length ? (
              <ul className="panel divide-y divide-divider">
                {alertsFeed.map((e: TripEvent) => {
                  const Icon = EVENT_ICON[e.kind] ?? Flag;
                  const trip = tripById.get(e.trip_id ?? "");
                  return (
                    <li key={e.id}>
                      <Link href={`/live/trips/${e.trip_id}`} className="live-feed-row">
                        <Icon size={16} className="mt-0.5 shrink-0 text-muted" />
                        <span className="min-w-0 flex-1">
                          <strong>{e.title}</strong>
                          <small>
                            {trip ? `${prettyVehicle(trip.vehicle_no)} · ` : ""}
                            {agoShort(e.created_at, now)}
                          </small>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="live-empty">No automatic alerts in the last 24 hours.</p>
            )}
          </div>
        </details>
      </div>
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  stoppage: "standing",
  delay: "late",
  eway_expiring: "e-way",
  eway_expired: "e-way expired",
  no_signal: "no GPS",
  geofence_enter: "arrived",
  geofence_exit: "left",
  status: "status",
};
