import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, ListFilter, Plus, Route, Search, X } from "lucide-react";

import { cx } from "@/components/ui";
import { loadPlaces, placeMap, requireLiveSession, searchTrips } from "@/lib/live/server";
import { STATE_LABEL, TRIP_STATES, istDayStart, istDayStartOf, type LivePlace, type TripDirection } from "@/lib/live/shared";

import { TripCard } from "../parts";
import { AutoRefresh } from "../widgets";

export const metadata = { title: "Live tracking - Home" };
export const dynamic = "force-dynamic";

/**
 * Home (v4): "We are sending" | "We are receiving" - side by side on desktop,
 * two tabs on mobile. Each side has its own status / date / search filters,
 * behind icons; one filter panel open at a time. Newest created first, always.
 * Params per side, prefixed o (sending) or i (receiving):
 *   s status (all|planned|active|done|cancelled), d date (today|7|custom),
 *   f / t custom from / to (YYYY-MM-DD, IST), q search, p page.
 */

type SP = Record<string, string | undefined>;
const PAGE = 15;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function href(sp: SP, patch: SP): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
  const s = p.toString();
  return `/live/trips${s ? `?${s}` : ""}`;
}

function Hidden({ sp, except }: { sp: SP; except: string[] }) {
  return (
    <>
      {Object.entries(sp)
        .filter(([k, v]) => v && !except.includes(k))
        .map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
    </>
  );
}

function range(k: string, sp: SP, now: number): { from: string | null; to: string | null; label: string | null } {
  const d = sp[`${k}d`];
  if (d === "today") return { from: istDayStart(now), to: null, label: "Today" };
  if (d === "7") return { from: new Date(now - 7 * 86_400_000).toISOString(), to: null, label: "7 days" };
  if (d === "custom") {
    const f = DAY_RE.test(sp[`${k}f`] ?? "") ? sp[`${k}f`]! : null;
    const t = DAY_RE.test(sp[`${k}t`] ?? "") ? sp[`${k}t`]! : null;
    return {
      from: f ? istDayStartOf(f) : null,
      to: t ? new Date(Date.parse(istDayStartOf(t)) + 86_400_000).toISOString() : null,
      label: f || t ? `${f ?? "…"} → ${t ?? "…"}` : null,
    };
  }
  return { from: null, to: null, label: null };
}

async function Side({ ownerId, k, dir, sp, places, now, mobileHidden }: { ownerId: string; k: "o" | "i"; dir: TripDirection; sp: SP; places: Map<string, LivePlace>; now: number; mobileHidden: boolean }) {
  const status = TRIP_STATES.includes(sp[`${k}s`] as (typeof TRIP_STATES)[number]) ? sp[`${k}s`]! : "all";
  const q = (sp[`${k}q`] ?? "").slice(0, 40);
  const page = Math.max(0, Number(sp[`${k}p`]) || 0);
  const r = range(k, sp, now);
  const { rows, more } = await searchTrips(ownerId, { status, q, from: r.from, to: r.to, direction: dir, page, pageSize: PAGE });
  const reset = { [`${k}p`]: undefined };
  const title = dir === "outgoing" ? "We are sending" : "We are receiving";
  const Icon = dir === "outgoing" ? ArrowUpRight : ArrowDownLeft;
  const group = `f-${k}`;
  const visible: SP = sp;

  return (
    <section className={cx("live-side", mobileHidden && "max-lg:hidden")} aria-label={title}>
      <div className="live-side-head">
        <h2>
          <span className={`live-dir-icon live-dir-${dir}`}>
            <Icon size={14} />
          </span>
          {title}
        </h2>
        <div className="live-filters">
          <details name={group}>
            <summary aria-label="Status filter" data-on={status !== "all" || undefined}>
              <ListFilter size={16} />
            </summary>
            <div className="live-filter-pop">
              <p className="live-filter-label">Status</p>
              <div className="live-chips">
                {(["all", ...TRIP_STATES] as const).map((s) => (
                  <Link key={s} href={href(visible, { [`${k}s`]: s === "all" ? undefined : s, ...reset })} className={cx("live-chip-filter", status === s && "is-on")}>
                    {s === "all" ? "All" : STATE_LABEL[s]}
                  </Link>
                ))}
              </div>
            </div>
          </details>
          <details name={group}>
            <summary aria-label="Date filter" data-on={r.label ? true : undefined}>
              <CalendarDays size={16} />
            </summary>
            <div className="live-filter-pop">
              <p className="live-filter-label">Created</p>
              <div className="live-chips">
                {[
                  { v: undefined, label: "Any time" },
                  { v: "today", label: "Today" },
                  { v: "7", label: "7 days" },
                ].map((d) => (
                  <Link
                    key={d.label}
                    href={href(visible, { [`${k}d`]: d.v, [`${k}f`]: undefined, [`${k}t`]: undefined, ...reset })}
                    className={cx("live-chip-filter", sp[`${k}d`] === d.v && "is-on")}
                  >
                    {d.label}
                  </Link>
                ))}
              </div>
              <form action="/live/trips" className="live-date-range">
                <Hidden sp={visible} except={[`${k}d`, `${k}f`, `${k}t`, `${k}p`]} />
                <input type="hidden" name={`${k}d`} value="custom" />
                <label>
                  <span>From</span>
                  <input type="date" name={`${k}f`} defaultValue={sp[`${k}f`] ?? ""} className="field" />
                </label>
                <label>
                  <span>To</span>
                  <input type="date" name={`${k}t`} defaultValue={sp[`${k}t`] ?? ""} className="field" />
                </label>
                <button type="submit" className="live-btn-sm live-btn-brand">
                  Apply
                </button>
              </form>
            </div>
          </details>
          <details name={group} open={Boolean(q) || undefined}>
            <summary aria-label="Search" data-on={q ? true : undefined}>
              <Search size={16} />
            </summary>
            <div className="live-filter-pop">
              <form action="/live/trips" className="live-search">
                <Hidden sp={visible} except={[`${k}q`, `${k}p`]} />
                <Search size={15} aria-hidden />
                <input name={`${k}q`} defaultValue={q} placeholder="Trip, driver, truck, place, invoice, e-way" aria-label={`Search ${title}`} enterKeyHint="search" />
              </form>
            </div>
          </details>
        </div>
      </div>

      {status !== "all" || r.label || q ? (
        <p className="live-active-filters">
          {status !== "all" ? (
            <Link href={href(visible, { [`${k}s`]: undefined, ...reset })}>
              {STATE_LABEL[status as keyof typeof STATE_LABEL]} <X size={11} />
            </Link>
          ) : null}
          {r.label ? (
            <Link href={href(visible, { [`${k}d`]: undefined, [`${k}f`]: undefined, [`${k}t`]: undefined, ...reset })}>
              {r.label} <X size={11} />
            </Link>
          ) : null}
          {q ? (
            <Link href={href(visible, { [`${k}q`]: undefined, ...reset })}>
              “{q}” <X size={11} />
            </Link>
          ) : null}
        </p>
      ) : null}

      {rows.length ? (
        <div className="live-side-list">
          {rows.map((t) => (
            <TripCard key={t.id} trip={t} places={places} now={now} />
          ))}
        </div>
      ) : (
        <div className="live-side-empty">
          <Route size={18} />
          <p>{q || r.label || status !== "all" ? "Nothing matches these filters." : dir === "outgoing" ? "No trips sent yet." : "No trips coming in yet."}</p>
          <Link href={`/live/trips/new${dir === "incoming" ? "?dir=incoming" : ""}`} className="live-btn-sm">
            <Plus size={13} /> New trip
          </Link>
        </div>
      )}

      {page > 0 || more ? (
        <div className="flex justify-between gap-2">
          {page > 0 ? (
            <Link className="live-chip-filter" href={href(visible, { [`${k}p`]: page > 1 ? String(page - 1) : undefined })}>
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          {more ? (
            <Link className="live-chip-filter" href={href(visible, { [`${k}p`]: String(page + 1) })}>
              View more →
            </Link>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export default async function TripsHome({ searchParams }: { searchParams: Promise<SP> }) {
  const raw = await searchParams;
  const { ownerId } = await requireLiveSession();
  const keep = ["side", "os", "od", "of", "ot", "oq", "op", "is", "id", "if", "it", "iq", "ip"];
  const sp: SP = {};
  for (const k of keep) if (typeof raw[k] === "string" && raw[k]) sp[k] = String(raw[k]).slice(0, 60);
  const side = sp.side === "in" ? "in" : "out";
  const now = Date.now();
  const places = placeMap(await loadPlaces(ownerId, { includeArchived: true }));

  return (
    <div className="live-page mx-auto max-w-6xl space-y-3">
      <AutoRefresh ms={45_000} />
      <header className="live-page-head live-home-head">
        <div>
          <h1>Trips</h1>
          <p>
            Newest first.{" "}
            <Link href="/live/today" className="font-semibold text-brand-600">
              Today
            </Link>
          </p>
        </div>
        <Link href={`/live/trips/new${side === "in" ? "?dir=incoming" : ""}`} className="live-new-btn" aria-label="New trip">
          <Plus size={20} />
          <span className="hidden sm:inline">New trip</span>
        </Link>
      </header>

      <nav className="live-side-tabs lg:hidden" aria-label="Direction">
        <Link href={href(sp, { side: undefined })} aria-current={side === "out" ? "page" : undefined}>
          <ArrowUpRight size={14} /> Sending
        </Link>
        <Link href={href(sp, { side: "in" })} aria-current={side === "in" ? "page" : undefined}>
          <ArrowDownLeft size={14} /> Receiving
        </Link>
      </nav>

      <div className="live-sides">
        <Side ownerId={ownerId} k="o" dir="outgoing" sp={sp} places={places} now={now} mobileHidden={side !== "out"} />
        <Side ownerId={ownerId} k="i" dir="incoming" sp={sp} places={places} now={now} mobileHidden={side !== "in"} />
      </div>
    </div>
  );
}
