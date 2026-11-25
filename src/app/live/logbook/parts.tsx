import Link from "next/link";
import { Building2, ChevronRight, Route, Truck, UserRound } from "lucide-react";

import { cx } from "@/components/ui";
import type { TripSection } from "@/lib/live/activity";
import type { LogbookTab, Usage } from "@/lib/live/logbook";
import { PURPOSE_LABEL, durationShort, fmtIst, prettyVehicle, tripNo, type LivePlace, type LiveTrip } from "@/lib/live/shared";

import { PhaseSections, StatePill } from "../parts";

/** v6 Logbook building blocks: tabs, usage rows, trip accordions. */

export const TAB_META: Record<LogbookTab, { label: string; icon: typeof Truck; search: string }> = {
  trips: { label: "Trips", icon: Route, search: "Trip, driver, truck, place" },
  trucks: { label: "Trucks", icon: Truck, search: "Truck number or type" },
  drivers: { label: "Drivers", icon: UserRound, search: "Driver name" },
  warehouses: { label: "Warehouses", icon: Building2, search: "Warehouse or city" },
};

export function LogbookTabs({ tab, keep }: { tab: LogbookTab; keep: string }) {
  return (
    <nav className="lb-tabs" aria-label="Logbook sections">
      {(Object.keys(TAB_META) as LogbookTab[]).map((k) => {
        const { label, icon: Icon } = TAB_META[k];
        return (
          <Link key={k} href={`/live/logbook/${k}${keep}`} aria-current={k === tab ? "page" : undefined}>
            <Icon size={14} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/** "12 trips · 9 days · 140 h" (+ out / in for warehouses). */
export function usageText(u: Pick<Usage, "trips" | "days" | "hours" | "out" | "in">): string {
  const parts = [`${u.trips} trip${u.trips === 1 ? "" : "s"}`];
  if (u.out != null || u.in != null) parts.push(`${u.out ?? 0} out · ${u.in ?? 0} in`);
  if (u.days) parts.push(`${u.days} day${u.days === 1 ? "" : "s"}`);
  if (u.hours) parts.push(`${u.hours} h`);
  return parts.join(" · ");
}

export function UsageRow({ u, href, plate = false }: { u: Usage; href: string; plate?: boolean }) {
  return (
    <li>
      <Link href={href} className="lb-row">
        <span className="lb-row-main">
          <span className="lb-row-l1">
            <strong className={cx("truncate", plate && "live-plate live-plate-lg")}>{u.name}</strong>
            {u.sub ? <small className="truncate">{u.sub}</small> : null}
            {u.active ? <span className="live-status live-status-brand live-status-xs">On trip</span> : null}
          </span>
          <span className="lb-row-l2">{u.trips ? usageText(u) : "Not used in this period"}</span>
          {u.last ? (
            <span className="lb-row-l3 truncate">
              Last: {tripNo(u.last.trip_seq)} · {fmtIst(u.last.started_at ?? u.last.created_at)}
            </span>
          ) : null}
        </span>
        <ChevronRight size={15} className="shrink-0 text-faint" aria-hidden />
      </Link>
    </li>
  );
}

/** Where / why / which trip / when, one line each; the activity opens inside (one open at a time). */
export function TripAccordion({ sections, places, show, group }: { sections: TripSection[]; places: Map<string, LivePlace>; show: "driver" | "truck" | "both"; group: string }) {
  if (!sections.length) return <p className="live-empty">No trips in this period.</p>;
  return (
    <div className="live-acc">
      {sections.map(({ trip, phases, count }) => (
        <details key={trip.id} name={group}>
          <summary className="lb-sum">
            <span className="lb-sum-main">
              <span className="lb-row-l1">
                <strong className="truncate">
                  {tripNo(trip.trip_seq)}
                  {trip.trip_name ? <span className="live-trow-name"> {trip.trip_name}</span> : null}
                </strong>
                <StatePill trip={trip} className="live-status-xs" />
              </span>
              <span className="lb-row-l2 truncate">{routeText(trip, places)}</span>
              <span className="lb-row-l3 truncate">{whenWho(trip, show)}</span>
            </span>
            <span className="live-acc-count">{count}</span>
          </summary>
          <div className="live-acc-body space-y-2">
            <Link href={`/live/trips/${trip.id}`} className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600">
              Open trip <ChevronRight size={12} />
            </Link>
            <PhaseSections groups={phases} group={`${group}-${trip.id}`} />
          </div>
        </details>
      ))}
    </div>
  );
}

export function routeText(trip: LiveTrip, places: Map<string, LivePlace>): string {
  const from = (trip.from_place_id ? places.get(trip.from_place_id)?.name : null) ?? trip.party_name ?? trip.from_name ?? "?";
  const to = (trip.to_place_id ? places.get(trip.to_place_id)?.name : null) ?? trip.to_name ?? trip.consignee_name ?? trip.to_city ?? "?";
  return `${from} → ${to}`;
}

export function whenWho(trip: LiveTrip, show: "driver" | "truck" | "both"): string {
  const end = trip.delivered_at ?? trip.arrived_at ?? trip.cancelled_at;
  const when = trip.started_at ? `${fmtIst(trip.started_at)}${end ? ` → ${fmtIst(end)}` : " → now"}` : `Planned ${fmtIst(trip.planned_dispatch_at ?? trip.created_at)}`;
  const span = trip.started_at && end ? durationShort((Date.parse(end) - Date.parse(trip.started_at)) / 60000) : null;
  const why = trip.purpose ? PURPOSE_LABEL[trip.purpose].replace(/ \(.*\)$/, "") : null;
  const who = [show !== "driver" ? (trip.vehicle_no ? prettyVehicle(trip.vehicle_no) : null) : null, show !== "truck" ? trip.driver_name : null].filter(Boolean);
  return [when, span, why, ...who].filter(Boolean).join(" · ");
}
