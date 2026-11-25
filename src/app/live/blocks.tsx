import Link from "next/link";
import { Building2, CalendarDays, MessageCircle, Power, RefreshCw, Search, Truck, UserRound, X } from "lucide-react";

import { ActionForm } from "@/components/ActionForm";
import { cx } from "@/components/ui";
import type { LiveDriver } from "@/lib/live/shared";

import { newDriverLink, resumeDriverSharing, stopDriverSharing } from "./actions";
import { IconSubmit } from "./ui";
import { IconCopy, NavSelect } from "./widgets";

/**
 * v5 building blocks (docs/LIVE-PLAN-v5.md): sheet, driver link actions,
 * history/activity filter bar. Server components that compose small client parts.
 */

/** A card that slides up on phones / sits centred on desktop. Opened by URL (?add=1 / ?edit=id), closed by a link. */
export function Sheet({ title, closeHref, children }: { title: string; closeHref: string; children: React.ReactNode }) {
  return (
    <div className="live-sheet-wrap" role="dialog" aria-modal="true" aria-label={title}>
      <Link href={closeHref} className="live-sheet-backdrop" aria-label="Close" scroll={false} />
      <section className="live-sheet">
        <header className="live-sheet-head">
          <h2>{title}</h2>
          <Link href={closeHref} className="live-ib" aria-label="Close" scroll={false}>
            <X size={16} />
          </Link>
        </header>
        <div className="live-sheet-body">{children}</div>
      </section>
    </div>
  );
}

/**
 * Driver link actions, the same on the trip page and the driver page (v5 §4):
 * WhatsApp from your own phone, copy, new link (old one stops), on / off.
 */
export function DriverLinkActions({ driver, link, wa }: { driver: LiveDriver; link: string | null; wa: string | null }) {
  const off = driver.share_status === "revoked" || driver.share_status === "expired" || Boolean(driver.archived_at);
  const temp = driver.kind === "one_time";
  return (
    <div className="live-ibar" role="group" aria-label="Driver link">
      {!off && link && wa ? (
        <a href={wa} target="_blank" rel="noopener noreferrer" className="live-ib live-ib-wa" aria-label="Send link on WhatsApp" title="Send link on WhatsApp">
          <MessageCircle size={15} />
        </a>
      ) : null}
      {!off && link ? <IconCopy value={link} label="Copy driver link" /> : null}
      <ActionForm action={newDriverLink} closeOnSuccess={false} refresh={false}>
        <input type="hidden" name="driver_id" value={driver.id} />
        <IconSubmit label="New link (old link stops)" confirm={`Make a new link for ${driver.name}? The old link stops at once; send him the new one.`}>
          <RefreshCw size={15} />
        </IconSubmit>
      </ActionForm>
      {driver.share_status !== "expired" ? (
        off ? (
          <ActionForm action={resumeDriverSharing} closeOnSuccess={false} refresh={false}>
            <input type="hidden" name="driver_id" value={driver.id} />
            <IconSubmit label="Switch link on (same link)">
              <Power size={15} />
            </IconSubmit>
          </ActionForm>
        ) : (
          <ActionForm action={stopDriverSharing} closeOnSuccess={false} refresh={false}>
            <input type="hidden" name="driver_id" value={driver.id} />
            <IconSubmit label="Switch link off" tone="bad" confirm={`Switch ${driver.name}'s link off? Nothing more is recorded until it is on again.`}>
              <Power size={15} />
            </IconSubmit>
          </ActionForm>
        )
      ) : null}
      <span className="live-ibar-note">{off ? "Link off" : temp ? "This trip only" : "Personal link, all trips"}</span>
    </div>
  );
}

export type FilterState = { q: string; range: string; driver: string; truck: string; place: string };
type Opt = { v: string; label: string };

const RANGES: Opt[] = [
  { v: "7d", label: "7 days" },
  { v: "30d", label: "30 days" },
  { v: "90d", label: "90 days" },
  { v: "all", label: "All" },
];

/** URL for this filter state with one key changed. */
export function filterHref(base: string, f: FilterState, change: Partial<FilterState> & { view?: string } = {}, view?: string): string {
  const all = { ...f, ...change };
  const p = new URLSearchParams();
  if (all.q) p.set("q", all.q);
  if (all.range && all.range !== "30d") p.set("range", all.range);
  if (all.driver) p.set("driver", all.driver);
  if (all.truck) p.set("truck", all.truck);
  if (all.place) p.set("place", all.place);
  const v = change.view ?? view;
  if (v) p.set("view", v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}

/**
 * Search + time chips + icon filters (driver / truck / warehouse). One icon
 * panel open at a time (details name). Everything lives in the URL.
 */
export function FilterBar({
  base,
  f,
  drivers,
  trucks,
  places,
  view,
  icons = true,
  placeholder = "Trip, driver, truck, place",
}: {
  base: string;
  f: FilterState;
  drivers: Opt[];
  trucks: Opt[];
  places: Opt[];
  view?: string;
  /** v6: entity lists (trucks / drivers / warehouses) show search + time only. */
  icons?: boolean;
  placeholder?: string;
}) {
  const here = filterHref(base, f, {}, view);
  const icon = (key: "driver" | "truck" | "place", Icon: typeof Truck, label: string, opts: Opt[]) => {
    const on = Boolean(f[key]);
    const name = on ? opts.find((o) => o.v === f[key])?.label : null;
    return (
      <details name="live-filter" className="live-fdrop">
        <summary className={cx("live-ib", on && "is-on")} aria-label={`Filter by ${label}`} title={name ? `${label}: ${name}` : `Filter by ${label}`}>
          <Icon size={15} />
        </summary>
        <div className="live-pop">
          <p className="live-mini-label">{label}</p>
          <NavSelect name={key} value={f[key]} base={here} label={label} options={[{ v: "", label: `All ${label.toLowerCase()}s` }, ...opts]} />
        </div>
      </details>
    );
  };
  const chips = [
    f.driver ? { k: "driver" as const, label: drivers.find((o) => o.v === f.driver)?.label ?? "Driver" } : null,
    f.truck ? { k: "truck" as const, label: trucks.find((o) => o.v === f.truck)?.label ?? "Truck" } : null,
    f.place ? { k: "place" as const, label: places.find((o) => o.v === f.place)?.label ?? "Warehouse" } : null,
  ].filter(Boolean) as { k: "driver" | "truck" | "place"; label: string }[];
  return (
    <div className="live-fbar">
      <div className="live-fbar-row">
        <form action={base} className="live-search">
          <Search size={14} aria-hidden />
          <input name="q" defaultValue={f.q} placeholder={placeholder} aria-label="Search" maxLength={40} />
          {f.range !== "30d" ? <input type="hidden" name="range" value={f.range} /> : null}
          {f.driver ? <input type="hidden" name="driver" value={f.driver} /> : null}
          {f.truck ? <input type="hidden" name="truck" value={f.truck} /> : null}
          {f.place ? <input type="hidden" name="place" value={f.place} /> : null}
          {view ? <input type="hidden" name="view" value={view} /> : null}
        </form>
        {icons ? icon("driver", UserRound, "Driver", drivers) : null}
        {icons ? icon("truck", Truck, "Truck", trucks) : null}
        {icons ? icon("place", Building2, "Warehouse", places) : null}
      </div>
      <div className="live-fbar-row">
        <CalendarDays size={14} className="shrink-0 text-faint" aria-hidden />
        {RANGES.map((r) => (
          <Link key={r.v} href={filterHref(base, f, { range: r.v }, view)} className={cx("live-chip-xs", f.range === r.v && "is-on")} aria-current={f.range === r.v ? "true" : undefined}>
            {r.label}
          </Link>
        ))}
        {chips.map((c) => (
          <Link key={c.k} href={filterHref(base, f, { [c.k]: "" }, view)} className="live-chip-xs is-on" aria-label={`Remove filter ${c.label}`}>
            {c.label} <X size={11} />
          </Link>
        ))}
      </div>
    </div>
  );
}

/** Read the filter state from search params. */
export function readFilters(sp: Record<string, string | undefined>): FilterState {
  const id = (v: string | undefined) => (v && /^[0-9a-f-]{36}$/i.test(v) ? v : "");
  const range = ["7d", "30d", "90d", "all"].includes(sp.range ?? "") ? (sp.range as string) : "30d";
  return { q: (sp.q ?? "").slice(0, 40), range, driver: id(sp.driver), truck: id(sp.truck), place: id(sp.place) };
}
