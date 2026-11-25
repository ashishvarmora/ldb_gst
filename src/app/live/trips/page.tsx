import Link from "next/link";
import { Search } from "lucide-react";

import { cx } from "@/components/ui";
import { loadPlaces, placeMap, requireLiveSession, searchTrips } from "@/lib/live/server";
import { istDayStart } from "@/lib/live/shared";

import { TripCard } from "../parts";

export const metadata = { title: "Live tracking - Trips" };
export const dynamic = "force-dynamic";

const TABS = [
  { key: "open", label: "Active" },
  { key: "in_transit", label: "In transit" },
  { key: "planned", label: "Planned" },
  { key: "arrived", label: "Arrived" },
  { key: "delivered", label: "Delivered" },
  { key: "cancelled", label: "Cancelled" },
  { key: "all", label: "All" },
];

const DAYS = [
  { key: "", label: "Any date" },
  { key: "today", label: "Today" },
  { key: "7", label: "7 days" },
  { key: "30", label: "30 days" },
];

type Search = { status?: string; q?: string; days?: string; place?: string; page?: string };

function href(base: Search, patch: Partial<Search>) {
  const p = new URLSearchParams();
  const merged = { ...base, ...patch };
  for (const [k, v] of Object.entries(merged)) if (v) p.set(k, String(v));
  const s = p.toString();
  return `/live/trips${s ? `?${s}` : ""}`;
}

export default async function TripsPage({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const { ownerId } = await requireLiveSession();
  const status = TABS.some((t) => t.key === sp.status) ? sp.status! : "open";
  const now = Date.now();
  const from =
    sp.days === "today" ? istDayStart(now) : sp.days === "7" || sp.days === "30" ? new Date(now - Number(sp.days) * 86_400_000).toISOString() : null;
  const page = Math.max(0, Number(sp.page) || 0);

  const [{ rows, more }, places] = await Promise.all([
    searchTrips(ownerId, { status, q: sp.q, from, place: sp.place, page }),
    loadPlaces(ownerId),
  ]);
  const byId = placeMap(places);
  const base: Search = { status, q: sp.q, days: sp.days, place: sp.place };

  return (
    <div className="live-page mx-auto max-w-5xl space-y-4">
      <header className="live-page-head">
        <div>
          <h1>Trips</h1>
          <p>
            Optional jobs on top of driver tracking. Closed trips stay here.{" "}
            <Link href="/live/today" className="font-semibold text-brand-600">
              Today&apos;s summary
            </Link>
          </p>
        </div>
        <Link href="/live/new?trip=1" className="live-cta live-cta-sm hidden lg:inline-flex">
          + New trip
        </Link>
      </header>

      <form action="/live/trips" className="live-search">
        <input type="hidden" name="status" value={status} />
        {sp.days ? <input type="hidden" name="days" value={sp.days} /> : null}
        <Search size={17} aria-hidden />
        <input
          name="q"
          defaultValue={sp.q ?? ""}
          placeholder="Vehicle, invoice, e-way bill, customer…"
          aria-label="Search trips"
          enterKeyHint="search"
        />
      </form>

      <nav className="live-tabs" aria-label="Status">
        {TABS.map((t) => (
          <Link key={t.key} href={href(base, { status: t.key, page: undefined })} aria-current={t.key === status ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="flex flex-wrap items-center gap-2">
        {DAYS.map((d) => (
          <Link
            key={d.key || "any"}
            href={href(base, { days: d.key || undefined, page: undefined })}
            className={cx("live-chip-filter", (sp.days ?? "") === d.key && "is-on")}
          >
            {d.label}
          </Link>
        ))}
        {places.length ? (
          <form action="/live/trips" className="ml-auto flex items-center gap-1.5">
            <input type="hidden" name="status" value={status} />
            {sp.q ? <input type="hidden" name="q" value={sp.q} /> : null}
            {sp.days ? <input type="hidden" name="days" value={sp.days} /> : null}
            <select name="place" defaultValue={sp.place ?? ""} className="field live-place-select" aria-label="Filter by place">
              <option value="">All places</option>
              {places.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <button type="submit" className="live-chip-filter">
              Go
            </button>
          </form>
        ) : null}
      </div>

      {rows.length ? (
        <div className="live-trip-grid">
          {rows.map((t) => (
            <TripCard key={t.id} trip={t} places={byId} now={now} />
          ))}
        </div>
      ) : (
        <div className="panel p-8 text-center">
          <p className="font-semibold text-strong">No trips here</p>
          <p className="mt-1 text-sm text-muted">{sp.q ? "Nothing matches that search." : "Create a trip for each truck you dispatch."}</p>
          <Link href="/live/trips/new" className="live-cta mt-4 inline-flex">
            + New trip
          </Link>
        </div>
      )}

      {page > 0 || more ? (
        <div className="flex justify-between gap-2">
          {page > 0 ? <Link className="live-chip-filter" href={href(base, { page: String(page - 1) })}>← Newer</Link> : <span />}
          {more ? <Link className="live-chip-filter" href={href(base, { page: String(page + 1) })}>Older →</Link> : null}
        </div>
      ) : null}
    </div>
  );
}
